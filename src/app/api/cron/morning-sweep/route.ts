// src/app/api/cron/morning-sweep/route.ts
//
// GET /api/cron/morning-sweep
//
// Vercel cron — emails Zach his proactive "get ahead of my tasks and tickets"
// sweep: HubSpot tasks, Freshservice tickets waiting on him, PE action-required
// docs, and (when his Gmail is connected) email/meeting follow-ups, with
// Claude-drafted ticket replies and a ranked priority list.
//
// Schedule: weekdays at 13:00 UTC (7:00 AM Mountain Daylight Time), matching
// the existing daily-focus job. Read-only: it never sends or mutates anything
// except the digest email to Zach.
//
// Protected by CRON_SECRET.
//
// Query params:
//   ?dryRun=true  — prefixes the subject with [DRY RUN] (delivery is unchanged
//                   since Zach is the sole recipient either way).

import { NextRequest, NextResponse } from "next/server";
import { runMorningSweep } from "@/lib/morning-sweep/run";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";

  try {
    const result = await runMorningSweep({ dryRun });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[morning-sweep] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
