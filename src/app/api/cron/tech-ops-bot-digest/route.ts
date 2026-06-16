import { NextRequest, NextResponse } from "next/server";
import { runDailyDigest, runRoomDigests } from "@/lib/tech-ops-bot-proactive";

/**
 * GET /api/cron/tech-ops-bot-digest
 *
 * Vercel cron — builds the daily Tech Ops digest (stuck deals, milestones in
 * the last 24h, escalation queue) and DMs it to the owner, then posts each
 * configured team-room route its own location-scoped digest. No-ops safely
 * until the owner's DM space is captured / the bot is added to a room, and
 * only posts when there's something to report. Protected by CRON_SECRET.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ?preview=1 renders every digest without posting — for reviewing copy.
  const preview = request.nextUrl.searchParams.get("preview") === "1";

  try {
    const [owner, rooms] = await Promise.all([
      runDailyDigest(undefined, { preview }),
      runRoomDigests(undefined, { preview }),
    ]);
    return NextResponse.json({ preview, owner, rooms });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[tech-ops-bot-digest] failed:", message);
    return NextResponse.json({ posted: false, reason: message }, { status: 500 });
  }
}
