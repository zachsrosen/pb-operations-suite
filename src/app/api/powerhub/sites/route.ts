import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveDealSummaries } from "@/lib/powerhub-site-context";
import { getOpenTicketsByDeal, buildSiteTicketsFromDeals } from "@/lib/powerhub-tickets";

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
      property: {
        select: {
          fullAddress: true,
          streetAddress: true,
          city: true,
          state: true,
          systemSizeKwDc: true,
          mostRecentInstallDate: true,
        },
      },
    },
  });

  // Nearly the whole fleet is GEO-linked to a *property* with no direct dealId
  // (only a handful of sites carry one) — customer + tickets resolve through
  // PropertyDealLink: site → property → deals.
  //
  // All deals per linked property, newest-first. propertyDealMap keeps the most
  // recent deal (customer resolution); propertyAllDeals keeps every deal (ticket
  // resolution — an open ticket can hang off any of a property's deals).
  const linkedPropertyIdsForDeals = [
    ...new Set(sites.map((s) => s.propertyId).filter((id): id is string => Boolean(id))),
  ];
  const propertyDealMap = new Map<string, string>();
  const propertyAllDeals = new Map<string, string[]>();
  if (linkedPropertyIdsForDeals.length > 0) {
    const links = await prisma.propertyDealLink.findMany({
      where: { propertyId: { in: linkedPropertyIdsForDeals } },
      orderBy: { associatedAt: "desc" },
      select: { propertyId: true, dealId: true },
    });
    for (const link of links) {
      // Ordered newest-first; keep the first (most recent) deal per property
      if (!propertyDealMap.has(link.propertyId)) {
        propertyDealMap.set(link.propertyId, link.dealId);
      }
      const arr = propertyAllDeals.get(link.propertyId) || [];
      arr.push(link.dealId);
      propertyAllDeals.set(link.propertyId, arr);
    }
  }

  const effectiveDealId = (s: { dealId: string | null; propertyId: string | null }) =>
    s.dealId ?? (s.propertyId ? propertyDealMap.get(s.propertyId) ?? null : null);

  const allDealIds = [
    ...new Set(sites.map(effectiveDealId).filter((id): id is string => Boolean(id))),
  ];
  const dealMap = await resolveDealSummaries(allDealIds);

  // Open service tickets keyed by deal — the reliable source (tickets hang off
  // deals; PropertyTicketLink is a lossy rollup that missed open tickets). A
  // site's open tickets = union across all its deals (direct + property-linked).
  // Best-effort: returns {} on any failure and never throws.
  const openTicketsByDeal = await getOpenTicketsByDeal();
  const siteDealIds = (s: { dealId: string | null; propertyId: string | null }): string[] => {
    const ids = new Set<string>();
    if (s.dealId) ids.add(s.dealId);
    if (s.propertyId) for (const d of propertyAllDeals.get(s.propertyId) ?? []) ids.add(d);
    return [...ids];
  };

  const enrichedSites = sites.map((s) => {
    const resolvedDealId = effectiveDealId(s);
    const deal = resolvedDealId ? dealMap.get(resolvedDealId) : undefined;
    const usePropertyAddress = !s.address && s.property?.fullAddress;
    return {
      ...s,
      customerName: null,
      dealName: deal?.dealName ?? null,
      resolvedDealId,
      tickets: buildSiteTicketsFromDeals(siteDealIds(s), openTicketsByDeal),
      systemSizeKwDc: s.property?.systemSizeKwDc ?? null,
      installDate: s.property?.mostRecentInstallDate ?? null,
      ...(usePropertyAddress
        ? {
            address: s.property?.streetAddress || s.property?.fullAddress || "",
            city: s.property?.city || "",
            state: s.property?.state || "",
          }
        : {}),
      // Trim the joined property payload back out of the response
      property: undefined,
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
