import { NextRequest, NextResponse } from "next/server";
import { runDailyDigest } from "@/lib/tech-ops-bot-proactive";

/**
 * GET /api/cron/tech-ops-bot-digest
 *
 * Vercel cron — builds the daily Tech Ops digest (stuck deals, milestones in
 * the last 24h, escalation queue) and DMs it to the owner. No-ops safely until
 * the owner's DM space has been captured (they message the bot once) and only
 * posts when there's something to report. Protected by CRON_SECRET.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDailyDigest();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[tech-ops-bot-digest] failed:", message);
    return NextResponse.json({ posted: false, reason: message }, { status: 500 });
  }
}
