import { NextRequest, NextResponse } from "next/server";
import { advancePeRejections } from "@/lib/pe-rejection-advance";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/pe-rejection-advance
 *
 * Poller (schedule in vercel.json). HubSpot can't re-enroll on tasks or trigger
 * on "all associated tasks complete", so this advances a deal's PE milestone
 * status from "Rejected" → "Ready to Resubmit" once all of that milestone's
 * rejection tasks are completed (and at least one existed). HubSpot-only; no PE
 * API calls. CRON_SECRET validated here.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await advancePeRejections();
    if (result.advanced.length > 0) {
      console.warn(
        "[pe-rejection-advance] advanced:",
        result.advanced.map((a) => `${a.dealName} ${JSON.stringify(a.changes)}`).join(" | "),
      );
    }
    return NextResponse.json({
      ok: true,
      scanned: result.scanned,
      advanced: result.advanced.length,
      deals: result.advanced,
    });
  } catch (err) {
    console.error("[pe-rejection-advance] failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
