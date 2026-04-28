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

  // Optional kill switch — set PM_FLAG_RULES_ENABLED=false to stop firing
  // without removing the cron entry. Defaults to enabled.
  if (process.env.PM_FLAG_RULES_ENABLED === "false") {
    return NextResponse.json({ status: "disabled" });
  }

  const start = Date.now();
  try {
    const summary = await runAllRules();
    return NextResponse.json({
      status: "ok",
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
