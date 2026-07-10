import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveDealSummaries } from "@/lib/powerhub-site-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") || "provisioned"; // "all" | "provisioned"

  // Build where clause: "provisioned" = has at least one device OR has telemetry
  const where =
    filter === "provisioned"
      ? {
          OR: [
            { totalGateways: { gt: 0 } },
            { totalBatteries: { gt: 0 } },
            { totalInverters: { gt: 0 } },
            { telemetrySnapshot: { isNot: null } },
          ],
        }
      : undefined;

  const sites = await prisma.powerhubSite.findMany({
    where,
    orderBy: [
      // Sites with alerts first, then by name
      { siteName: "asc" },
    ],
    include: {
      telemetrySnapshot: true,
      alerts: {
        where: { isActive: true },
        select: { id: true, severity: true, alertName: true },
      },
    },
  });

  // Resolve deal names live from HubSpot (server-cached, 10 min). The
  // HubSpotProjectCache table this route previously read has no writer and
  // sits empty in prod, so live resolution is the only working source.
  const linkedDealIds = [
    ...new Set(sites.filter((s) => s.dealId).map((s) => s.dealId as string)),
  ];
  const dealMap = await resolveDealSummaries(linkedDealIds);

  const enrichedSites = sites.map((s) => {
    const deal = s.dealId ? dealMap.get(s.dealId) : undefined;
    return {
      ...s,
      // FleetTable compat: customerName was never populated by the dead
      // cache; the deal name ("Smith, Jane - PROJ-1234") is the human label.
      customerName: null,
      dealName: deal?.dealName ?? null,
    };
  });

  // Sort: sites with alerts first, then sites with telemetry, then rest
  enrichedSites.sort((a, b) => {
    // Alert count descending
    const aAlerts = a.alerts.length;
    const bAlerts = b.alerts.length;
    if (aAlerts !== bAlerts) return bAlerts - aAlerts;

    // Has telemetry
    const aTel = a.telemetrySnapshot ? 1 : 0;
    const bTel = b.telemetrySnapshot ? 1 : 0;
    if (aTel !== bTel) return bTel - aTel;

    // Has devices
    const aDev = (a.totalGateways || 0) + (a.totalBatteries || 0) + (a.totalInverters || 0);
    const bDev = (b.totalGateways || 0) + (b.totalBatteries || 0) + (b.totalInverters || 0);
    if (aDev !== bDev) return bDev - aDev;

    // Name alphabetical
    return (a.siteName || "").localeCompare(b.siteName || "");
  });

  return NextResponse.json({
    sites: enrichedSites,
    meta: {
      total: sites.length,
      filter,
    },
  });
}
