/**
 * Metric D — Pre-install readiness.
 *
 * Scope: PM-owned deals with installScheduleDate in the next 14 days.
 *
 * Phase 1 readiness checklist (3 boxes — equipment-delivered dropped because
 * no source field exists per Appendix A):
 *   1. Permit obtained: Deal.isPermitIssued === true
 *   2. BOM pushed: BomHubSpotPushLog has SUCCESS row in last 30d
 *   3. Customer install-confirmation: outbound call or meeting in last 7d
 *      (engagement-only signal; no install_confirmation_sent field exists)
 *
 * Outputs:
 *   - readinessScore: fraction of upcoming installs with all 3 boxes ticked
 *   - dayOfFailures90d: count of installs in last 90d rescheduled within
 *     48h of original date
 */

import { prisma } from "@/lib/db";
import { getDealEngagements } from "@/lib/hubspot-engagements";
import { rawNamesFor, type PmName } from "../owners";
import { THRESHOLDS } from "../thresholds";

const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIRMATION_TYPES = new Set(["call", "meeting"]);
const TERMINAL_STAGES = ["closedwon", "closedlost"];

export interface ReadinessMetricResult {
  readinessScore: number;
  dayOfFailures90d: number;
  upcomingInstallCount: number;
}

export async function computeReadinessForPM(
  pmName: PmName,
): Promise<ReadinessMetricResult> {
  const variants = rawNamesFor(pmName);
  const now = new Date();
  const upcomingCutoff = new Date(now.getTime() + 14 * DAY_MS);

  const upcoming = await prisma.deal.findMany({
    where: {
      projectManager: { in: variants, mode: "insensitive" },
      stageId: { notIn: TERMINAL_STAGES },
      installScheduleDate: { gte: now, lte: upcomingCutoff },
    },
    select: {
      hubspotDealId: true,
      isPermitIssued: true,
      installScheduleDate: true,
    },
  });

  let allReady = 0;
  if (upcoming.length > 0) {
    const bomCutoff = new Date(now.getTime() - 30 * DAY_MS);
    const confirmCutoff = now.getTime() - THRESHOLDS.customerConfirmationLookbackDays * DAY_MS;

    // Batch-load BOM push status across the upcoming portfolio
    const bomPushes = await prisma.bomHubSpotPushLog.findMany({
      where: {
        dealId: { in: upcoming.map((d) => d.hubspotDealId) },
        status: "SUCCESS",
        createdAt: { gte: bomCutoff },
      },
      select: { dealId: true },
    });
    const bomPushedSet = new Set(bomPushes.map((b) => b.dealId));

    for (const deal of upcoming) {
      const permit = deal.isPermitIssued === true;
      const bom = bomPushedSet.has(deal.hubspotDealId);

      let confirmed = false;
      try {
        const engagements = await getDealEngagements(deal.hubspotDealId, false);
        confirmed = engagements.some(
          (e) =>
            CONFIRMATION_TYPES.has(e.type) &&
            new Date(e.timestamp).getTime() >= confirmCutoff,
        );
      } catch (err) {
        console.warn(`[pm-tracker:readiness] engagement fetch failed for ${deal.hubspotDealId}:`, err);
      }

      if (permit && bom && confirmed) allReady += 1;
    }
  }

  // Phase 1 simplification: true "day-of failure" detection (install rescheduled
  // within 48h of original date due to a readiness gap) requires deal-history
  // tracking that lands in Phase 2 alongside the saves detector. For Phase 1 we
  // report the conservative proxy: deals whose installScheduleDate is in the
  // last 90d AND construction never completed AND deal isn't closed.
  //
  // This over-counts in-flight installs (install date passed but construction
  // genuinely still in progress and just not marked complete yet). The dashboard
  // labels this metric "Past-due installs (90d, proxy)" rather than the spec's
  // "day-of failures" framing.
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS);
  const dayOfFailures90d = await prisma.deal.count({
    where: {
      projectManager: { in: variants, mode: "insensitive" },
      installScheduleDate: { gte: ninetyDaysAgo, lte: now },
      constructionCompleteDate: null,
      stageId: { notIn: TERMINAL_STAGES },
    },
  });

  return {
    readinessScore: upcoming.length === 0 ? 1 : allReady / upcoming.length,
    dayOfFailures90d,
    upcomingInstallCount: upcoming.length,
  };
}
