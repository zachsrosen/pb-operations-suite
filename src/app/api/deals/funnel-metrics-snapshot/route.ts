import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import {
  getFunnelSnapshots,
  recordFunnelSnapshot,
  type FunnelMetricsInput,
} from "@/lib/funnel-metrics-snapshots";

// GET — the recorded daily snapshot history (for the trend lookup).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ snapshots: await getFunnelSnapshots() });
}

// POST — record today's snapshot (idempotent per day). Posted by the funnel
// page with the bucket counts it computed, so the history matches the UI.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as Partial<FunnelMetricsInput>;
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "Missing or invalid date" }, { status: 400 });
    }
    const raw = body.counts && typeof body.counts === "object" ? body.counts : {};
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "number" && Number.isFinite(v)) counts[k] = v;
    }
    // Guard against recording an empty/half-loaded page (no real numbers).
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (Object.keys(counts).length === 0 || total === 0) {
      return NextResponse.json({ recorded: false, reason: "empty" });
    }
    const result = await recordFunnelSnapshot({ date: body.date, counts });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[funnel-metrics-snapshot] record error:", err);
    return NextResponse.json({ error: "Failed to record snapshot" }, { status: 500 });
  }
}
