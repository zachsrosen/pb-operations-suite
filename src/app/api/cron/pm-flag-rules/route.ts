/**
 * GET /api/cron/pm-flag-rules
 *
 * Background reconciliation for the PM queue.
 *
 * Behavior:
 * - Default authenticated request: runs `evaluateLiveFlags()` and returns the
 *   reconciliation summary. This is what Vercel Cron calls.
 * - `?status=1`: cheap no-op status response for forensic checks.
 *
 * Auth: bearer-token compare against `process.env.CRON_SECRET`.
 */

import { NextRequest, NextResponse } from "next/server";
import { evaluateLiveFlags } from "@/lib/pm-flag-rules";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statusOnly = request.nextUrl.searchParams.get("status") === "1";

  if (statusOnly) {
    return NextResponse.json({
      status: "ok",
      mode: "background-reconciliation",
      message: "PM flag evaluation runs in the cron route, not during page render.",
      timestamp: new Date().toISOString(),
    });
  }

  const start = Date.now();
  try {
    const summary = await evaluateLiveFlags();
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      ...summary,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
        durationMs: Date.now() - start,
      },
      { status: 500 }
    );
  }
}
