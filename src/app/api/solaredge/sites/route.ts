import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/solaredge/sites — the SolarEdge fleet for the monitor dashboard.
 * Ordered worst-alert-first. Flag-gated by SOLAREDGE_ENABLED.
 */
export async function GET(request: Request) {
  if (process.env.SOLAREDGE_ENABLED !== "true") {
    return NextResponse.json({ error: "SolarEdge disabled" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") || "active"; // "active" | "all"

  const where =
    filter === "active" ? { activationStatus: { not: "Inactive" } } : undefined;

  const sites = await prisma.solarEdgeSite.findMany({
    where,
    select: {
      siteId: true,
      siteName: true,
      activationStatus: true,
      peakPowerKw: true,
      city: true,
      state: true,
      installDate: true,
      projNumber: true,
      dealId: true,
      highestAlertImpact: true,
      openAlertCount: true,
      portalUrl: true,
      lastSyncAt: true,
    },
    orderBy: [{ highestAlertImpact: "desc" }, { openAlertCount: "desc" }, { siteName: "asc" }],
  });

  const fleet = {
    totalSites: sites.length,
    withOpenAlerts: sites.filter((s) => s.openAlertCount > 0).length,
    criticalSites: sites.filter((s) => s.highestAlertImpact >= 7).length,
    lastUpdated: sites[0]?.lastSyncAt ?? null,
  };

  return NextResponse.json({ sites, fleet, meta: { total: sites.length, filter } });
}
