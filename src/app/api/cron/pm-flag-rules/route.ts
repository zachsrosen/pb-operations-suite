/**
 * GET /api/cron/pm-flag-rules
 *
 * Daily cron that evaluates all PM flag rules against the local Deal mirror
 * and creates flags for matches. Idempotent on `(source, externalRef)` —
 * stuck deals re-fire weekly via the `isoWeekKey()` component in externalRef
 * patterns, surfacing flags PMs ignored.
 *
 * Auth: bearer-token compare against `process.env.CRON_SECRET` (Vercel Cron
 * convention). Mirrors `src/app/api/cron/property-reconcile/route.ts`.
 *
 * Schedule: see vercel.json crons section.
 */

import { NextRequest, NextResponse } from "next/server";
import { runAllRules } from "@/lib/pm-flag-rules";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Kill switch — defaults to DISABLED. Must explicitly opt in via
  // PM_FLAG_RULES_ENABLED=true in Vercel env. This protects against
  // accidental mass-fire (each match raises a flag → triggers email,
  // and on first run that's hundreds of emails at once).
  //
  // Before flipping this on for real:
  //   1. Confirm thresholds are right (run with PM_FLAG_RULES_DRY_RUN=true
  //      first to log matches without creating flags / sending emails).
  //   2. Notify PMs that the system is going live.
  //   3. Consider a digest-style email instead of per-flag (TODO).
  if (process.env.PM_FLAG_RULES_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled", reason: "PM_FLAG_RULES_ENABLED not set to 'true'" });
  }
  const dryRun = process.env.PM_FLAG_RULES_DRY_RUN === "true";

  const start = Date.now();
  try {
    const summary = await runAllRules({ dryRun });
    return NextResponse.json({
      status: dryRun ? "dry-run" : "ok",
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - start,
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
