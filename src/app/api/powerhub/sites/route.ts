import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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

  // Fetch the deal cache for all linked sites: customer/deal names for the
  // table, plus address backfill (Tesla API never returns addresses; they
  // come from deal linkage).
  const linkedDealIds = [
    ...new Set(sites.filter((s) => s.dealId).map((s) => s.dealId as string)),
  ];

  const dealMap: Record<
    string,
    {
      dealName: string | null;
      customerName: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
    }
  > = {};
  if (linkedDealIds.length > 0) {
    const dealCaches = await prisma.hubSpotProjectCache.findMany({
      where: { dealId: { in: linkedDealIds } },
      select: {
        dealId: true,
        dealName: true,
        customerName: true,
        address: true,
        city: true,
        state: true,
      },
    });
    for (const d of dealCaches) {
      dealMap[d.dealId] = {
        dealName: d.dealName,
        customerName: d.customerName,
        address: d.address,
        city: d.city,
        state: d.state,
      };
    }
  }

  // Attach customer/deal names; backfill address when the site has none
  const enrichedSites = sites.map((s) => {
    const deal = s.dealId ? dealMap[s.dealId] : undefined;
    const useDealAddress = !s.address && deal?.address;
    return {
      ...s,
      customerName: deal?.customerName ?? null,
      dealName: deal?.dealName ?? null,
      ...(useDealAddress
        ? {
            address: deal.address || "",
            city: deal.city || "",
            state: deal.state || "",
          }
        : {}),
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
