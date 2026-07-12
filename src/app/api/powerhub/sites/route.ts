import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveDealSummaries } from "@/lib/powerhub-site-context";
import { getTicketSummaries, buildSiteTickets } from "@/lib/powerhub-tickets";

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
        },
      },
    },
  });

  // Nearly the whole fleet is GEO-linked to a *property* with no direct
  // dealId (only a handful of sites carry one) — the customer must be
  // resolved through PropertyDealLink: site → property → most recent deal.
  const propertyIdsNeedingDeal = [
    ...new Set(
      sites
        .filter((s) => !s.dealId && s.propertyId)
        .map((s) => s.propertyId as string)
    ),
  ];
  const propertyDealMap = new Map<string, string>();
  if (propertyIdsNeedingDeal.length > 0) {
    const links = await prisma.propertyDealLink.findMany({
      where: { propertyId: { in: propertyIdsNeedingDeal } },
      orderBy: { associatedAt: "desc" },
      select: { propertyId: true, dealId: true },
    });
    for (const link of links) {
      // Ordered newest-first; keep the first (most recent) deal per property
      if (!propertyDealMap.has(link.propertyId)) {
        propertyDealMap.set(link.propertyId, link.dealId);
      }
    }
  }

  const effectiveDealId = (s: { dealId: string | null; propertyId: string | null }) =>
    s.dealId ?? (s.propertyId ? propertyDealMap.get(s.propertyId) ?? null : null);

  const allDealIds = [
    ...new Set(sites.map(effectiveDealId).filter((id): id is string => Boolean(id))),
  ];
  const dealMap = await resolveDealSummaries(allDealIds);

  // Open service tickets per property (best-effort HubSpot enrichment —
  // getTicketSummaries returns {} on any failure and never throws).
  const linkedPropertyIds = [
    ...new Set(sites.map((s) => s.propertyId).filter((id): id is string => Boolean(id))),
  ];
  const propertyTicketIds = new Map<string, string[]>();
  if (linkedPropertyIds.length > 0) {
    const ticketLinks = await prisma.propertyTicketLink.findMany({
      where: { propertyId: { in: linkedPropertyIds } },
      orderBy: { associatedAt: "desc" },
      select: { propertyId: true, ticketId: true },
    });
    for (const link of ticketLinks) {
      const arr = propertyTicketIds.get(link.propertyId) || [];
      arr.push(link.ticketId);
      propertyTicketIds.set(link.propertyId, arr);
    }
  }
  const ticketSummaries = await getTicketSummaries(
    [...propertyTicketIds.values()].flat()
  );

  const enrichedSites = sites.map((s) => {
    const resolvedDealId = effectiveDealId(s);
    const deal = resolvedDealId ? dealMap.get(resolvedDealId) : undefined;
    const usePropertyAddress = !s.address && s.property?.fullAddress;
    return {
      ...s,
      customerName: null,
      dealName: deal?.dealName ?? null,
      resolvedDealId,
      tickets: s.propertyId
        ? buildSiteTickets(propertyTicketIds.get(s.propertyId) || [], ticketSummaries)
        : [],
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
