/**
 * GET /api/cron/adders-sync
 *
 * Nightly adder catalog → OpenSolar sync.
 *
 * Auth mirrors `src/app/api/cron/property-reconcile/route.ts` — bearer
 * compare against `CRON_SECRET`. When the kill switch is off, the
 * orchestrator itself short-circuits, so this endpoint is always safe to
 * call — it simply records a zero-op run.
 */
import { NextRequest, NextResponse } from "next/server";
import { syncAll } from "@/lib/adders/sync";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncAll({ trigger: "CRON" });
    // Rename sync status so the HTTP-level ok indicator doesn't collide
    // with the run-level SUCCESS/PARTIAL/FAILED enum from AdderSyncRun.
    const { status: runStatus, ...rest } = result;
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      runStatus,
      ...rest,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
