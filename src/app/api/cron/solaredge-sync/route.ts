import { NextResponse } from "next/server";
import { syncSolarEdgeSites } from "@/lib/solaredge-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily SolarEdge asset sync. sites/list is ~27 account-quota calls for the
 * ~2,635-site fleet — well under the 300/day cap.
 */
export async function GET() {
  if (process.env.SOLAREDGE_ENABLED !== "true") {
    return NextResponse.json({ skipped: true, reason: "SOLAREDGE_ENABLED != true" });
  }
  try {
    const result = await syncSolarEdgeSites();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/solaredge-sync]", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
