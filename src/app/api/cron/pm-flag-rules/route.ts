/**
 * GET /api/cron/pm-flag-rules
 *
 * **Live mode** — evaluation now runs on `/dashboards/pm-action-queue` page
 * load (server component calls `evaluateLiveFlags()` from
 * `src/lib/pm-flag-rules.ts`). This route is no longer scheduled by Vercel
 * Cron; it survives only as a forensic / manual-trigger endpoint.
 *
 * Behavior:
 * - Default: returns `{status: "live-mode-active"}` describing the new model.
 * - If `?force=1` query param AND auth is valid: runs `evaluateLiveFlags()`
 *   and returns the reconciliation summary. Useful for debugging without
 *   needing a logged-in PM session.
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

  const force = request.nextUrl.searchParams.get("force") === "1";

  if (!force) {
    return NextResponse.json({
      status: "live-mode-active",
      message:
        "PM flag evaluation runs on /dashboards/pm-action-queue page load. " +
        "This route is forensic-only — append ?force=1 to trigger a manual eval.",
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
