/**
 * PowerHub enrichment for the Service Priority Queue.
 *
 * Given a list of deal IDs + ticket IDs, returns a per-item summary of:
 *   - teslaPortalUrl  (from HubSpotPropertyCache.teslaPortalUrl)
 *   - activeAlertCount (count of PowerhubAlert.isActive=true on linked sites)
 *   - highestAlertSeverity (max severity, computed in JS — see POWERHUB_SEVERITY_RANK)
 *
 * One deal can map to multiple properties (rare, but possible if a customer has
 * multiple addresses associated). We aggregate alerts across all linked
 * properties and surface a single portal URL (first non-null seen).
 */

import { prisma } from "@/lib/db";
import {
  POWERHUB_SEVERITY_RANK,
  type PowerhubItemSummary,
} from "@/lib/service-priority";

type Severity = "INFORMATIONAL" | "PERFORMANCE" | "CRITICAL";

export interface PowerhubEnrichmentInput {
  dealIds: string[];
  ticketIds: string[];
}

export interface PowerhubEnrichmentResult {
  /** keyed by deal ID */
  byDealId: Map<string, PowerhubItemSummary>;
  /** keyed by ticket ID */
  byTicketId: Map<string, PowerhubItemSummary>;
}

export async function fetchPowerhubItemSummaries(
  input: PowerhubEnrichmentInput
): Promise<PowerhubEnrichmentResult> {
  const byDealId = new Map<string, PowerhubItemSummary>();
  const byTicketId = new Map<string, PowerhubItemSummary>();

  if (!prisma) return { byDealId, byTicketId };

  const { dealIds, ticketIds } = input;
  if (dealIds.length === 0 && ticketIds.length === 0) {
    return { byDealId, byTicketId };
  }

  // 1. Resolve deal/ticket → propertyId via link tables.
  const [dealLinks, ticketLinks] = await Promise.all([
    dealIds.length > 0
      ? prisma.propertyDealLink.findMany({
          where: { dealId: { in: dealIds } },
          select: {
            dealId: true,
            propertyId: true,
            property: { select: { teslaPortalUrl: true } },
          },
        })
      : Promise.resolve([] as Array<{
          dealId: string;
          propertyId: string;
          property: { teslaPortalUrl: string | null };
        }>),
    ticketIds.length > 0
      ? prisma.propertyTicketLink.findMany({
          where: { ticketId: { in: ticketIds } },
          select: {
            ticketId: true,
            propertyId: true,
            property: { select: { teslaPortalUrl: true } },
          },
        })
      : Promise.resolve([] as Array<{
          ticketId: string;
          propertyId: string;
          property: { teslaPortalUrl: string | null };
        }>),
  ]);

  // 2. Map property → list of (kind, itemId) pairs and collect property IDs.
  const propertyToDeals = new Map<string, string[]>();
  const propertyToTickets = new Map<string, string[]>();
  const portalUrlByDeal = new Map<string, string | null>();
  const portalUrlByTicket = new Map<string, string | null>();

  for (const l of dealLinks) {
    const list = propertyToDeals.get(l.propertyId) ?? [];
    list.push(l.dealId);
    propertyToDeals.set(l.propertyId, list);
    // First non-null portal URL wins per deal.
    if (l.property.teslaPortalUrl && !portalUrlByDeal.get(l.dealId)) {
      portalUrlByDeal.set(l.dealId, l.property.teslaPortalUrl);
    } else if (!portalUrlByDeal.has(l.dealId)) {
      portalUrlByDeal.set(l.dealId, l.property.teslaPortalUrl ?? null);
    }
  }
  for (const l of ticketLinks) {
    const list = propertyToTickets.get(l.propertyId) ?? [];
    list.push(l.ticketId);
    propertyToTickets.set(l.propertyId, list);
    if (l.property.teslaPortalUrl && !portalUrlByTicket.get(l.ticketId)) {
      portalUrlByTicket.set(l.ticketId, l.property.teslaPortalUrl);
    } else if (!portalUrlByTicket.has(l.ticketId)) {
      portalUrlByTicket.set(l.ticketId, l.property.teslaPortalUrl ?? null);
    }
  }

  const propertyIds = new Set<string>([
    ...propertyToDeals.keys(),
    ...propertyToTickets.keys(),
  ]);

  // 3. Fetch active PowerHub alerts joined to those properties (via site.propertyId).
  let alertByProperty = new Map<string, { count: number; highest: Severity }>();
  if (propertyIds.size > 0) {
    const alerts = await prisma.powerhubAlert.findMany({
      where: {
        isActive: true,
        site: { propertyId: { in: [...propertyIds] } },
      },
      select: {
        severity: true,
        site: { select: { propertyId: true } },
      },
    });
    alertByProperty = aggregateAlertsByProperty(alerts);
  }

  // 4. Roll up per deal / per ticket.
  for (const dealId of dealIds) {
    const portalUrl = portalUrlByDeal.get(dealId) ?? null;
    const linkedProps: string[] = [];
    for (const [pid, deals] of propertyToDeals) {
      if (deals.includes(dealId)) linkedProps.push(pid);
    }
    const summary = combinePropertySummaries(linkedProps.map((p) => alertByProperty.get(p)));
    byDealId.set(dealId, { ...summary, teslaPortalUrl: portalUrl });
  }

  for (const ticketId of ticketIds) {
    const portalUrl = portalUrlByTicket.get(ticketId) ?? null;
    const linkedProps: string[] = [];
    for (const [pid, tickets] of propertyToTickets) {
      if (tickets.includes(ticketId)) linkedProps.push(pid);
    }
    const summary = combinePropertySummaries(linkedProps.map((p) => alertByProperty.get(p)));
    byTicketId.set(ticketId, { ...summary, teslaPortalUrl: portalUrl });
  }

  return { byDealId, byTicketId };
}

function aggregateAlertsByProperty(
  alerts: Array<{ severity: Severity; site: { propertyId: string | null } }>
): Map<string, { count: number; highest: Severity }> {
  const out = new Map<string, { count: number; highest: Severity }>();
  for (const a of alerts) {
    const pid = a.site.propertyId;
    if (!pid) continue;
    const existing = out.get(pid);
    if (!existing) {
      out.set(pid, { count: 1, highest: a.severity });
    } else {
      existing.count++;
      if (POWERHUB_SEVERITY_RANK[a.severity] > POWERHUB_SEVERITY_RANK[existing.highest]) {
        existing.highest = a.severity;
      }
    }
  }
  return out;
}

function combinePropertySummaries(
  summaries: Array<{ count: number; highest: Severity } | undefined>
): Omit<PowerhubItemSummary, "teslaPortalUrl"> {
  let count = 0;
  let highest: Severity | null = null;
  for (const s of summaries) {
    if (!s) continue;
    count += s.count;
    if (!highest || POWERHUB_SEVERITY_RANK[s.highest] > POWERHUB_SEVERITY_RANK[highest]) {
      highest = s.highest;
    }
  }
  return { activeAlertCount: count, highestAlertSeverity: highest };
}
