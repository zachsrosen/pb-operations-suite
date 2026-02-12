import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail, logActivity, upsertCrewMember } from "@/lib/db";
import { zuper } from "@/lib/zuper";
import type { ZuperUserFull, ZuperTeamDetail } from "@/lib/zuper";

/**
 * POST /api/admin/sync-zuper
 * Sync users and teams from Zuper into the app's User and CrewMember tables.
 *
 * Fetches:
 * - GET /user/all — all Zuper users
 * - GET /teams/summary — all teams
 * - GET /team/{team_uid} — team detail with members
 *
 * For each Zuper user:
 * - Creates/updates a User record (by email) with role TECH_OPS if new
 * - Creates/updates a CrewMember record (by name) with Zuper UIDs
 */
export async function POST() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!zuper.isConfigured()) {
    return NextResponse.json(
      { error: "Zuper integration not configured" },
      { status: 503 }
    );
  }

  try {
    // 1. Fetch all Zuper users
    const usersResult = await zuper.getAllUsers();
    if (usersResult.type === "error") {
      return NextResponse.json(
        { error: `Failed to fetch Zuper users: ${usersResult.error}` },
        { status: 500 }
      );
    }
    const zuperUsers: ZuperUserFull[] = usersResult.data || [];

    // 2. Fetch all teams summary
    const teamsResult = await zuper.getTeams();
    if (teamsResult.type === "error") {
      return NextResponse.json(
        { error: `Failed to fetch Zuper teams: ${teamsResult.error}` },
        { status: 500 }
      );
    }
    const teamsSummary = teamsResult.data || [];

    // 3. Fetch team details (members) for each team
    const teamDetails: ZuperTeamDetail[] = [];
    for (const team of teamsSummary) {
      const detailResult = await zuper.getTeamDetail(team.team_uid);
      if (detailResult.type === "success" && detailResult.data) {
        teamDetails.push(detailResult.data);
      }
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 100));
    }

    // 4. Build a map: user_uid → team info
    const userTeamMap = new Map<string, { teamUid: string; teamName: string }>();
    for (const team of teamDetails) {
      if (team.users) {
        for (const member of team.users) {
          // First team found wins (a user may appear in multiple teams)
          if (!userTeamMap.has(member.user_uid)) {
            userTeamMap.set(member.user_uid, {
              teamUid: team.team_uid,
              teamName: team.team_name,
            });
          }
        }
      }
    }

    // 5. Sync each Zuper user
    const results = {
      usersCreated: 0,
      usersUpdated: 0,
      usersSkipped: 0,
      crewCreated: 0,
      crewUpdated: 0,
      errors: [] as string[],
      totalZuperUsers: zuperUsers.length,
      totalTeams: teamsSummary.length,
    };

    for (const zUser of zuperUsers) {
      const fullName = `${zUser.first_name || ""} ${zUser.last_name || ""}`.trim();
      if (!fullName) {
        results.usersSkipped++;
        continue;
      }

      const email = zUser.email?.trim().toLowerCase();
      const teamInfo = userTeamMap.get(zUser.user_uid);

      // Upsert User record (by email) if they have an email
      if (email) {
        try {
          const existingUser = await prisma.user.findUnique({
            where: { email },
          });

          if (existingUser) {
            // Update name if it was missing
            if (!existingUser.name && fullName) {
              await prisma.user.update({
                where: { email },
                data: { name: fullName },
              });
            }
            results.usersUpdated++;
          } else {
            await prisma.user.create({
              data: {
                email,
                name: fullName,
                role: "TECH_OPS",
              },
            });
            results.usersCreated++;
          }
        } catch (err) {
          results.errors.push(`User ${fullName} (${email}): ${String(err)}`);
        }
      } else {
        results.usersSkipped++;
      }

      // Upsert CrewMember record (by name)
      try {
        const existingCrew = await prisma.crewMember.findUnique({
          where: { name: fullName },
        });

        await upsertCrewMember({
          name: fullName,
          email: email || undefined,
          zuperUserUid: zUser.user_uid,
          zuperTeamUid: teamInfo?.teamUid,
          teamName: teamInfo?.teamName,
          role: zUser.designation || zUser.role?.role_name || "technician",
          isActive: zUser.is_active !== false,
        });

        if (existingCrew) {
          results.crewUpdated++;
        } else {
          results.crewCreated++;
        }
      } catch (err) {
        results.errors.push(`Crew ${fullName}: ${String(err)}`);
      }
    }

    // Log the sync activity
    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `Synced ${zuperUsers.length} users from Zuper (${results.usersCreated} created, ${results.usersUpdated} updated, ${results.crewCreated} crew created, ${results.crewUpdated} crew updated)`,
      userEmail: session.user.email,
      userName: session.user.name || undefined,
      entityType: "zuper_sync",
      metadata: {
        totalZuperUsers: results.totalZuperUsers,
        totalTeams: results.totalTeams,
        usersCreated: results.usersCreated,
        usersUpdated: results.usersUpdated,
        usersSkipped: results.usersSkipped,
        crewCreated: results.crewCreated,
        crewUpdated: results.crewUpdated,
        errorCount: results.errors.length,
      },
    });

    return NextResponse.json({
      success: true,
      results,
      teams: teamsSummary.map((t) => ({
        team_uid: t.team_uid,
        team_name: t.team_name,
        memberCount: teamDetails.find((d) => d.team_uid === t.team_uid)?.users?.length || 0,
      })),
    });
  } catch (error) {
    console.error("[sync-zuper] Error:", error);
    return NextResponse.json(
      { error: "Failed to sync Zuper users", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/sync-zuper
 * Preview what would be synced (dry run) — shows Zuper users and teams
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!zuper.isConfigured()) {
    return NextResponse.json(
      { error: "Zuper integration not configured" },
      { status: 503 }
    );
  }

  try {
    // Fetch Zuper data
    const [usersResult, teamsResult] = await Promise.all([
      zuper.getAllUsers(),
      zuper.getTeams(),
    ]);

    const zuperUsers = usersResult.data || [];
    const teams = teamsResult.data || [];

    // Check existing records
    const existingEmails = new Set(
      (await prisma.user.findMany({ select: { email: true } })).map((u) => u.email)
    );
    const existingCrew = new Set(
      (await prisma.crewMember.findMany({ select: { name: true } })).map((c) => c.name)
    );

    const preview = zuperUsers.map((u) => {
      const fullName = `${u.first_name || ""} ${u.last_name || ""}`.trim();
      const email = u.email?.trim().toLowerCase();
      return {
        user_uid: u.user_uid,
        name: fullName,
        email: email || null,
        designation: u.designation || null,
        role: u.role?.role_name || null,
        is_active: u.is_active !== false,
        userExists: email ? existingEmails.has(email) : false,
        crewExists: existingCrew.has(fullName),
      };
    });

    return NextResponse.json({
      users: preview,
      teams: teams.map((t) => ({ team_uid: t.team_uid, team_name: t.team_name })),
      summary: {
        totalZuperUsers: zuperUsers.length,
        totalTeams: teams.length,
        newUsers: preview.filter((p) => p.email && !p.userExists).length,
        existingUsers: preview.filter((p) => p.email && p.userExists).length,
        noEmail: preview.filter((p) => !p.email).length,
        newCrew: preview.filter((p) => !p.crewExists).length,
        existingCrew: preview.filter((p) => p.crewExists).length,
      },
    });
  } catch (error) {
    console.error("[sync-zuper] Preview error:", error);
    return NextResponse.json(
      { error: "Failed to preview Zuper sync", details: String(error) },
      { status: 500 }
    );
  }
}
