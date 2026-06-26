import { NextRequest, NextResponse } from "next/server";
import { syncPeAvgTiming } from "@/lib/pe-avg-timing";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/pe-avg-timing
 *
 * Nightly poller (schedule in vercel.json). Computes the fleet-wide average
 * days from submission → payment for M1 and M2, then writes those numbers onto
 * every PE deal so a HubSpot calc property can forecast an expected payment date
 * that self-updates:
 *   add_time(pe_m1_submission_date, pe_m1_avg_submission_to_payment_days, "day")
 *
 * HubSpot can't average across deals inside a per-record formula, so we maintain
 * the number here. Only deals whose stored value drifted get written, so a
 * steady-state run touches nothing. HubSpot-only; no PE API calls. Supports
 * ?dryRun=1 to compute without writing. CRON_SECRET validated here.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    const result = await syncPeAvgTiming({ dryRun });
    if (result.updated > 0) {
      console.warn(
        `[pe-avg-timing] M1 avg ${result.m1Avg}d (n=${result.m1Count}), ` +
          `M2 avg ${result.m2Avg}d (n=${result.m2Count}); wrote ${result.updated}/${result.examined} deals`,
      );
    }
    return NextResponse.json({ ok: true, dryRun, ...result });
  } catch (err) {
    console.error("[pe-avg-timing] failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
