import { NextRequest, NextResponse } from "next/server";
import { syncPeAvgTiming } from "@/lib/pe-avg-timing";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/pe-avg-timing
 *
 * Nightly poller (schedule in vercel.json). Computes the fleet-wide forecast lag
 * (mean+median)/2 for both legs — submission → payment and approval → payment,
 * M1 and M2 — then writes those numbers onto every PE deal so HubSpot calc
 * properties can forecast an expected payment date that self-updates:
 *   add_time(pe_m1_submission_date, pe_m1_avg_submission_to_payment_days, "day")
 *   add_time(pe_m1_approval_date,   pe_m1_avg_approval_to_payment_days,   "day")
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
        `[pe-avg-timing] submit→pay M1 ${result.subM1}d (n=${result.subM1Count}) M2 ${result.subM2}d (n=${result.subM2Count}); ` +
          `approve→pay M1 ${result.appM1}d (n=${result.appM1Count}) M2 ${result.appM2}d (n=${result.appM2Count}); ` +
          `wrote ${result.updated}/${result.examined} deals`,
      );
    }
    return NextResponse.json({ ok: true, dryRun, ...result });
  } catch (err) {
    console.error("[pe-avg-timing] failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
