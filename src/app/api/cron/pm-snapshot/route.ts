/**
 * GET /api/cron/pm-snapshot
 *
 * Nightly cron — recomputes a 90-day-window snapshot per PM and writes to
 * PMSnapshot via upsert. Idempotent: re-running for the same UTC day
 * overwrites the prior row.
 *
 * Phase 2: this is also where the saves-detector pipeline will be invoked
 * inline, before the metric snapshot computation.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildAllSnapshots } from "@/lib/pm-tracker/snapshot";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await buildAllSnapshots();
    const status = result.failed.length === 0 ? 200 : 207; // 207 = partial success
    return NextResponse.json(
      {
        succeeded: result.succeeded,
        failed: result.failed,
        succeededCount: result.succeeded.length,
        failedCount: result.failed.length,
      },
      { status },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[pm-snapshot] fatal:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
