/**
 * Metric E — Stage hygiene.
 *
 * Scope: PM-owned active deals (excluded: closedwon/closedlost).
 *
 * Phase 1 required-fields list (5 fields — project_type dropped because it's
 * not on the Deal cache per Appendix A; installScheduleDate only required if
 * the deal is past DA stage as marked by isLayoutApproved):
 *   - closeDate
 *   - installScheduleDate (only if isLayoutApproved)
 *   - systemSizeKwdc
 *   - address
 *   - projectManager
 *
 * Outputs:
 *   - fieldPopulationScore: avg(% required fields filled) across portfolio
 *   - staleDataCount: deals where closeDate is in past with no close, OR
 *     installScheduleDate >30d past with no constructionCompleteDate
 */

import { prisma } from "@/lib/db";
import { rawNamesFor, type PmName } from "../owners";

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STAGES = ["closedwon", "closedlost"];

export interface HygieneMetricResult {
  fieldPopulationScore: number;
  staleDataCount: number;
  portfolioCount: number;
}

export async function computeHygieneForPM(pmName: PmName): Promise<HygieneMetricResult> {
  const variants = rawNamesFor(pmName);
  const now = new Date();

  const deals = await prisma.deal.findMany({
    where: {
      projectManager: { in: variants, mode: "insensitive" },
      stageId: { notIn: TERMINAL_STAGES },
    },
    select: {
      closeDate: true,
      installScheduleDate: true,
      systemSizeKwdc: true,
      address: true,
      projectManager: true,
      isLayoutApproved: true,
      constructionCompleteDate: true,
    },
  });

  if (deals.length === 0) {
    return { fieldPopulationScore: 1, staleDataCount: 0, portfolioCount: 0 };
  }

  let totalFilledRatio = 0;
  let staleCount = 0;
  const thirtyDaysAgo = now.getTime() - 30 * DAY_MS;

  for (const d of deals) {
    const required: boolean[] = [
      d.closeDate != null,
      d.systemSizeKwdc != null,
      !!d.address && d.address.trim().length > 0,
      !!d.projectManager && d.projectManager.trim().length > 0,
    ];
    if (d.isLayoutApproved) {
      required.push(d.installScheduleDate != null);
    }
    const filled = required.filter(Boolean).length;
    totalFilledRatio += filled / required.length;

    const stale =
      (d.closeDate != null && d.closeDate < now) ||
      (d.installScheduleDate != null &&
        d.installScheduleDate.getTime() < thirtyDaysAgo &&
        d.constructionCompleteDate == null);
    if (stale) staleCount += 1;
  }

  return {
    fieldPopulationScore: totalFilledRatio / deals.length,
    staleDataCount: staleCount,
    portfolioCount: deals.length,
  };
}
