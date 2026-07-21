import { NextRequest, NextResponse } from "next/server";
import { stampFirstConsultDates } from "@/lib/consult-date";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/consult-stamp
 *
 * Nightly (schedule in vercel.json). Stamps `first_consult_date` on Project-
 * pipeline deals created in the last 21 days that are missing it — the walk is
 * deal → primary contact → consult meetings (see src/lib/consult-date.ts).
 * History was backfilled by scripts/backfill-first-consult-date.ts. Supports
 * ?dryRun=1. CRON_SECRET validated here.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  try {
    const result = await stampFirstConsultDates({ createdInLastDays: 21, max: 300, dryRun });
    if (result.stamped > 0 || result.errors > 0) {
      console.warn(
        `[consult-stamp] examined ${result.examined}, stamped ${result.stamped}, ` +
          `no-contact ${result.noContact}, no-consult ${result.noConsult}, errors ${result.errors}`
      );
    }
    return NextResponse.json({ ok: true, dryRun, ...result });
  } catch (err) {
    console.error("[consult-stamp] failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
