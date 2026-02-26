import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper } from "@/lib/zuper";

const EXCLUDED_TEAM_PREFIXES = ["backoffice", "back office", "admin", "office", "sales"];
const EXCLUDED_USERS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let excludedUsersCache: { fetchedAt: number; userUids: Set<string> } | null = null;
let excludedUsersInFlight: Promise<Set<string>> | null = null;

function isExcludedTeamName(teamName: string | null | undefined): boolean {
  if (!teamName) return false;
  const lower = teamName.toLowerCase().trim();
  if (!lower) return false;
  return EXCLUDED_TEAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

async function getExcludedUserUidsFromNonFieldTeams(): Promise<Set<string>> {
  const now = Date.now();
  if (excludedUsersCache && now - excludedUsersCache.fetchedAt < EXCLUDED_USERS_CACHE_TTL_MS) {
    return excludedUsersCache.userUids;
  }
  if (excludedUsersInFlight) return excludedUsersInFlight;

  excludedUsersInFlight = (async () => {
    const excludedUserUids = new Set<string>();

    const teamsResult = await zuper.getTeams();
    if (teamsResult.type === "error" || !Array.isArray(teamsResult.data)) {
      console.warn("[Zuper Team Users] Failed to load team summary for exclusion:", teamsResult.error);
      return excludedUserUids;
    }

    const excludedTeams = teamsResult.data.filter((team) => isExcludedTeamName(team.team_name));
    if (excludedTeams.length === 0) return excludedUserUids;

    const teamDetails = await Promise.all(excludedTeams.map((team) => zuper.getTeamDetail(team.team_uid)));
    for (const teamDetail of teamDetails) {
      if (teamDetail.type === "error" || !teamDetail.data) continue;
      for (const user of teamDetail.data.users || []) {
        const userUid = String(user.user_uid || "").trim();
        if (userUid) excludedUserUids.add(userUid);
      }
    }

    excludedUsersCache = { fetchedAt: Date.now(), userUids: excludedUserUids };
    return excludedUserUids;
  })();

  try {
    return await excludedUsersInFlight;
  } finally {
    excludedUsersInFlight = null;
  }
}

/**
 * GET /api/zuper/teams/[teamUid]/users
 *
 * Returns active users for a Zuper team.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamUid: string }> }
) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured", configured: false },
        { status: 503 }
      );
    }

    const { teamUid } = await params;
    const normalizedTeamUid = String(teamUid || "").trim();
    if (!normalizedTeamUid) {
      return NextResponse.json({ error: "Missing teamUid" }, { status: 400 });
    }

    // Prefer team detail because it consistently includes the team's users.
    // Also remove users who belong to non-field teams (backoffice/admin/sales/etc.),
    // even if they are also listed in a field team.
    const [teamDetail, excludedUserUids] = await Promise.all([
      zuper.getTeamDetail(normalizedTeamUid),
      getExcludedUserUidsFromNonFieldTeams(),
    ]);

    if (teamDetail.type === "error" || !teamDetail.data) {
      return NextResponse.json(
        { error: teamDetail.error || "Failed to fetch team users" },
        { status: 500 }
      );
    }

    const users = Array.isArray(teamDetail.data.users)
      ? teamDetail.data.users
          .map((user) => ({
            userUid: user.user_uid,
            firstName: user.first_name,
            lastName: user.last_name,
            email: user.email || null,
          }))
          .filter((user) => {
            if (!user.userUid) return false;
            if (excludedUserUids.has(user.userUid)) return false;
            return !!`${user.firstName || ""} ${user.lastName || ""}`.trim();
          })
      : [];

    return NextResponse.json({
      success: true,
      teamUid: normalizedTeamUid,
      teamName: teamDetail.data.team_name,
      users,
    });
  } catch (error) {
    console.error("Error fetching Zuper team users:", error);
    return NextResponse.json(
      { error: "Failed to fetch team users" },
      { status: 500 }
    );
  }
}
