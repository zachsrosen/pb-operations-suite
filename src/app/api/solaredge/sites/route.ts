import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveDealSummaries } from "@/lib/powerhub-site-context";
import { getTicketSummaries, buildSiteTickets } from "@/lib/powerhub-tickets";

export const dynamic = "force-dynamic";

/**
 * GET /api/solaredge/sites — the SolarEdge fleet for the monitor dashboard.
 * Ordered worst-alert-first. Flag-gated by SOLAREDGE_ENABLED.
 *
 * Enriched (mirrors the PowerHub fleet): each linked site resolves its
 * customer/deal name (HubSpot batch-read for the name) and any open service
 * tickets (via the property's PropertyTicketLink rows). Both enrichments are
 * best-effort — a HubSpot failure yields empty names/tickets, never a failed
 * response.
 */
export async function GET(request: Request) {
  if (process.env.SOLAREDGE_ENABLED !== "true") {
    return NextResponse.json({ error: "SolarEdge disabled" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") || "active"; // "active" | "all"

  // "active" = everything except explicitly Inactive. activationStatus is
  // nullable, and Prisma's `{ not: "Inactive" }` evaluates to NULL (excluded)
  // for null rows — so OR in the nulls to keep freshly-synced, not-yet-statused
  // sites visible.
  const where =
    filter === "active"
      ? { OR: [{ activationStatus: null }, { activationStatus: { not: "Inactive" } }] }
      : undefined;

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
      propertyId: true,
      inverterCount: true,
      optimizerCount: true,
      batteryCount: true,
      hasStorage: true,
      highestAlertImpact: true,
      openAlertCount: true,
      portalUrl: true,
      lastSyncAt: true,
    },
    orderBy: [{ highestAlertImpact: "desc" }, { openAlertCount: "desc" }, { siteName: "asc" }],
  });

  // Deal-name enrichment: one HubSpot batch-read across all linked deals.
  const dealIds = [...new Set(sites.map((s) => s.dealId).filter((id): id is string => Boolean(id)))];
  const dealMap = await resolveDealSummaries(dealIds);

  // Open-ticket enrichment: PropertyTicketLink rows → HubSpot subjects/stages.
  const propertyIds = [
    ...new Set(sites.map((s) => s.propertyId).filter((id): id is string => Boolean(id))),
  ];
  const propertyTicketIds = new Map<string, string[]>();
  if (propertyIds.length > 0) {
    const ticketLinks = await prisma.propertyTicketLink.findMany({
      where: { propertyId: { in: propertyIds } },
      orderBy: { associatedAt: "desc" },
      select: { propertyId: true, ticketId: true },
    });
    for (const link of ticketLinks) {
      const arr = propertyTicketIds.get(link.propertyId) || [];
      arr.push(link.ticketId);
      propertyTicketIds.set(link.propertyId, arr);
    }
  }
  const ticketSummaries = await getTicketSummaries([...propertyTicketIds.values()].flat());

  const enriched = sites.map((s) => ({
    ...s,
    dealName: s.dealId ? dealMap.get(s.dealId)?.dealName ?? null : null,
    stageLabel: s.dealId ? dealMap.get(s.dealId)?.stageLabel ?? null : null,
    tickets: s.propertyId
      ? buildSiteTickets(propertyTicketIds.get(s.propertyId) || [], ticketSummaries)
      : [],
  }));

  const fleet = {
    totalSites: enriched.length,
    withOpenAlerts: enriched.filter((s) => s.openAlertCount > 0).length,
    criticalSites: enriched.filter((s) => s.highestAlertImpact >= 7).length,
    linkedSites: enriched.filter((s) => s.dealId).length,
    openTickets: enriched.reduce((n, s) => n + s.tickets.length, 0),
    lastUpdated: enriched[0]?.lastSyncAt ?? null,
  };

  return NextResponse.json({ sites: enriched, fleet, meta: { total: enriched.length, filter } });
}
