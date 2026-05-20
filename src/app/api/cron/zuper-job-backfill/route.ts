/**
 * GET /api/cron/zuper-job-backfill
 *
 * Syncs recently-modified Zuper jobs into ZuperJobCache so that jobs
 * created directly in Zuper (not via PB Suite) appear in the master
 * schedule and downstream features.
 *
 * Unlike the full `/api/zuper/sync-cache` sweep (which pages through
 * every job), this cron uses a 7-day lookback window + 90-day forward
 * window to limit API calls and runs within a 120s time budget.
 *
 * Auth: CRON_SECRET bearer token.
 * Feature flag: ZUPER_JOB_BACKFILL_ENABLED must be "true".
 */

import { NextRequest, NextResponse } from "next/server";
import { syncRecentZuperJobs } from "@/lib/zuper-sync";

export const maxDuration = 120;

const TIME_BUDGET_MS = 100_000; // Stop processing 20s before maxDuration
const LOOKBACK_DAYS = 7;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.ZUPER_JOB_BACKFILL_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  const startTime = Date.now();

  try {
    const result = await syncRecentZuperJobs({
      lookbackDays: LOOKBACK_DAYS,
      timeBudgetMs: TIME_BUDGET_MS,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return NextResponse.json({
      status: "ok",
      ...result,
      lookbackDays: LOOKBACK_DAYS,
      elapsed: `${elapsed}s`,
    });
  } catch (error) {
    console.error("[zuper-job-backfill] Sync failed:", error);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    return NextResponse.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        elapsed: `${elapsed}s`,
      },
      { status: 500 },
    );
  }
}
