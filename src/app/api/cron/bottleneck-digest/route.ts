import { NextRequest, NextResponse } from "next/server";
import { runBottleneckDigest } from "@/lib/bottleneck-digest";
import { runTeamDigest, TEAM_DIGEST_LABELS, type TeamDigestKey } from "@/lib/bottleneck-team-digest";

/**
 * GET /api/cron/bottleneck-digest
 * Weekday-morning bottleneck digest to the owner DM (change-driven; Mondays
 * always send with flow trends + refresh derived thresholds).
 * ?preview=1 renders without posting. Protected by CRON_SECRET.
 * ?team=design|permitting|ic|ops|sales|pm|compliance — that team's
 * funnel-bucket WORKLIST digest, sent to the owner DM (test/review sends
 * until bot visibility widens). Always sends; never touches the daily
 * digest's change-detection snapshot.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const preview = request.nextUrl.searchParams.get("preview") === "1";
  const teamParam = request.nextUrl.searchParams.get("team");
  if (teamParam && !(teamParam in TEAM_DIGEST_LABELS)) {
    return NextResponse.json(
      { error: `unknown team "${teamParam}" — expected one of: ${Object.keys(TEAM_DIGEST_LABELS).join(", ")}` },
      { status: 400 }
    );
  }
  try {
    const result = teamParam
      ? await runTeamDigest(teamParam as TeamDigestKey, { preview })
      : await runBottleneckDigest({ preview });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[bottleneck-digest] failed:", message);
    return NextResponse.json({ posted: false, reason: message }, { status: 500 });
  }
}
