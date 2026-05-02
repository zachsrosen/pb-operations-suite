/**
 * GET /api/cron/aircall-sync
 *
 * Daily drift correction: pulls last 24h of Aircall calls and refreshes the
 * full user roster. Runs at 04:00 UTC via Vercel Cron.
 * Auth: Authorization: Bearer ${CRON_SECRET}
 */

import { NextRequest, NextResponse } from "next/server";

import { syncCallsRange, syncUsers } from "@/lib/aircall-sync";
import { aircall } from "@/lib/aircall";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!aircall.isConfigured()) {
    return NextResponse.json({ skipped: true, reason: "Aircall API not configured" });
  }

  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    const [calls, users] = await Promise.all([
      syncCallsRange(from, now, { pageDelayMs: 1100 }),
      syncUsers(),
    ]);
    void prisma.activityLog
      .create({
        data: {
          type: "AIRCALL_SYNC_RUN",
          description: `Aircall drift sync: ${calls.upserted} calls, ${users.upserted} users`,
          metadata: { calls, users } as object,
        },
      })
      .catch(() => {});
    return NextResponse.json({ ok: true, calls, users });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    void prisma.activityLog
      .create({
        data: {
          type: "AIRCALL_SYNC_RUN",
          description: `Aircall drift sync failed: ${message}`,
          metadata: { error: message },
        },
      })
      .catch(() => {});
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
