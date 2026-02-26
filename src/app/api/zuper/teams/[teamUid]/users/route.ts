import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper } from "@/lib/zuper";

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
    const teamDetail = await zuper.getTeamDetail(normalizedTeamUid);
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
          .filter((user) => !!user.userUid && !!`${user.firstName || ""} ${user.lastName || ""}`.trim())
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
