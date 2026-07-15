/**
 * SolarEdge → HubSpot linkage resolution.
 *
 * Each SolarEdgeSite carries a PROJ number extracted from its name. The Deal
 * mirror table (10k+ rows) has dealName carrying the same PROJ number, and
 * PropertyDealLink maps deal → property. So we resolve entirely from local
 * data (no HubSpot calls): build PROJ → deal(s), pick the primary deal, and
 * link the site to that deal + its property.
 */

import { prisma } from "@/lib/db";
import { extractProjNumber } from "@/lib/solaredge-linkage";

/** Pipeline preference — the project/sales deal is the one the property hangs off. */
const PIPELINE_RANK: Record<string, number> = {
  PROJECT: 0,
  SALES: 1,
  DNR: 2,
  ROOFING: 3,
  SERVICE: 4,
};

export interface SolarEdgeResolveResult {
  sitesWithProj: number;
  linkedToDeal: number;
  linkedToProperty: number;
}

export async function resolveSolarEdgeLinks(): Promise<SolarEdgeResolveResult> {
  // 1. PROJ number → best deal id (lowest pipeline rank wins). Ordered by
  //    hubspotDealId so that ties within a pipeline resolve deterministically
  //    across runs (newer HubSpot ids sort higher numerically → win the tie).
  const deals = await prisma.deal.findMany({
    select: { hubspotDealId: true, dealName: true, pipeline: true },
    orderBy: { hubspotDealId: "asc" },
  });
  const projToDeal = new Map<string, { dealId: string; rank: number }>();
  for (const d of deals) {
    const proj = extractProjNumber(d.dealName);
    if (!proj) continue;
    const rank = PIPELINE_RANK[d.pipeline] ?? 9;
    const cur = projToDeal.get(proj);
    // <= so that, among equal-rank deals, the last one seen (highest id, most
    // recent) wins — stable given the id ordering above.
    if (!cur || rank <= cur.rank) projToDeal.set(proj, { dealId: d.hubspotDealId, rank });
  }

  // 2. deal id → property id (most recent association).
  const dealIds = [...new Set([...projToDeal.values()].map((v) => v.dealId))];
  const dealToProperty = new Map<string, string>();
  for (let i = 0; i < dealIds.length; i += 1000) {
    const chunk = dealIds.slice(i, i + 1000);
    const links = await prisma.propertyDealLink.findMany({
      where: { dealId: { in: chunk } },
      orderBy: { associatedAt: "desc" },
      select: { dealId: true, propertyId: true },
    });
    for (const l of links) if (!dealToProperty.has(l.dealId)) dealToProperty.set(l.dealId, l.propertyId);
  }

  // 3. Update each SolarEdge site with a PROJ number. Only PROJ-resolved links
  //    are managed here — MANUAL links (a human pointed the site at a deal) are
  //    left untouched even if the name also carries a PROJ. Writes happen only
  //    when the resolved linkage differs from what's stored, so repeat daily
  //    runs are near-free instead of 1k+ no-op writes.
  const sites = await prisma.solarEdgeSite.findMany({
    where: { projNumber: { not: null }, linkMethod: { not: "MANUAL" } },
    select: { siteId: true, projNumber: true, dealId: true, propertyId: true, linkMethod: true },
  });
  const result: SolarEdgeResolveResult = { sitesWithProj: sites.length, linkedToDeal: 0, linkedToProperty: 0 };
  for (const s of sites) {
    const deal = s.projNumber ? projToDeal.get(s.projNumber) : undefined;

    // No deal resolves: clear a previously PROJ-linked site back to UNLINKED so
    // the fleet never shows a link that no longer holds. Sites that were never
    // linked (still UNLINKED) need no write.
    if (!deal) {
      if (s.linkMethod === "PROJ") {
        await prisma.solarEdgeSite.update({
          where: { siteId: s.siteId },
          data: { dealId: null, propertyId: null, linkMethod: "UNLINKED" },
        });
      }
      continue;
    }

    const propertyId = dealToProperty.get(deal.dealId) ?? null;
    result.linkedToDeal++;
    if (propertyId) result.linkedToProperty++;
    if (s.dealId === deal.dealId && s.propertyId === propertyId && s.linkMethod === "PROJ") continue;
    await prisma.solarEdgeSite.update({
      where: { siteId: s.siteId },
      data: { dealId: deal.dealId, propertyId, linkMethod: "PROJ" },
    });
  }
  return result;
}
