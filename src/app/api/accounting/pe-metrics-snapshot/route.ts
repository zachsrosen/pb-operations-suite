import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { getMetricsSnapshots, recordMetricsSnapshot, type PeMetricsInput } from "@/lib/pe-metrics-snapshots";

// GET — the recorded daily snapshot history (for the trend lookup).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ snapshots: await getMetricsSnapshots() });
}

// POST — record today's snapshot (idempotent per day). Posted by the Documents
// tab with the exact card numbers it computed, so the history matches the UI.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as Partial<PeMetricsInput>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "Missing or invalid date" }, { status: 400 });
    }
    const input: PeMetricsInput = {
      date: body.date,
      peDeals: num(body.peDeals),
      actionable: num(body.actionable),
      inReview: num(body.inReview),
      allDocsApproved: num(body.allDocsApproved),
      approvalRate: body.approvalRate == null ? null : num(body.approvalRate),
      approved: num(body.approved),
      notUploaded: num(body.notUploaded),
      actionRequired: num(body.actionRequired),
    };
    // Guard against recording an empty/half-loaded page (all zeros).
    if (input.peDeals === 0 && input.approved === 0 && input.inReview === 0) {
      return NextResponse.json({ recorded: false, reason: "empty" });
    }
    const result = await recordMetricsSnapshot(input);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[pe-metrics-snapshot] record error:", err);
    return NextResponse.json({ error: "Failed to record snapshot" }, { status: 500 });
  }
}
