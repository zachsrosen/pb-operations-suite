import { NextResponse } from "next/server";
import { syncSolarEdgeSites } from "@/lib/solaredge-sync";
import { resolveSolarEdgeLinks } from "@/lib/solaredge-linkage-resolve";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily SolarEdge asset sync. sites/list is ~27 account-quota calls for the
 * ~2,635-site fleet — well under the 300/day cap. After the sync we re-run the
 * HubSpot linkage pass (local-only: PROJ → Deal mirror → property) so newly
 * created deals pick up their SolarEdge site without waiting for a backfill.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.SOLAREDGE_ENABLED !== "true") {
    return NextResponse.json({ skipped: true, reason: "SOLAREDGE_ENABLED != true" });
  }
  try {
    const result = await syncSolarEdgeSites();
    const linkage = await resolveSolarEdgeLinks();
    return NextResponse.json({ success: true, ...result, linkage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/solaredge-sync]", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
