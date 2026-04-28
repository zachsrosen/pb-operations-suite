/**
 * Metric G — Customer satisfaction.
 *
 * Scope: PM-owned deals at INSTALLED stage or later.
 *
 * Phase 1 implementation: returns zeros with a console note for review/ticket
 * fields. Full integration requires:
 *   - Reviews: fetching from FiveStarReviews HubSpot custom object across a
 *     90-day window and matching to deals via association type 274
 *   - Complaints: ticket-to-deal-to-PM resolution via hubspot-tickets.ts
 *
 * Both are mechanical Phase 2 work; deferred so Phase 1 can ship the
 * dashboard infrastructure. The dashboard UI labels these "(Phase 2)" until
 * they're wired up.
 *
 * Output:
 *   - reviewRate: 0 in Phase 1
 *   - avgReviewScore: 0 in Phase 1
 *   - complaintRatePer100: 0 in Phase 1
 */

import { prisma } from "@/lib/db";
import { rawNamesFor, type PmName } from "../owners";

export interface CsatMetricResult {
  reviewRate: number;
  avgReviewScore: number;
  complaintRatePer100: number;
  installedCount: number;
}

export async function computeCsatForPM(pmName: PmName): Promise<CsatMetricResult> {
  const variants = rawNamesFor(pmName);

  const installedCount = await prisma.deal.count({
    where: {
      projectManager: { in: variants, mode: "insensitive" },
      constructionCompleteDate: { not: null },
    },
  });

  // Phase 2: integrate FiveStarReviews + service tickets per the module
  // header above. Returning zeros keeps the snapshot writable.
  return {
    reviewRate: 0,
    avgReviewScore: 0,
    complaintRatePer100: 0,
    installedCount,
  };
}
