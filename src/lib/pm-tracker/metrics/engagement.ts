/**
 * Metric B — Customer engagement.
 *
 * Scope: PM-owned deals in pre-install stages (no install date set, OR install
 * date in the future, AND not a closed deal).
 *
 * Phase 1 simplification: counts ANY engagement signal (email/call/meeting)
 * on the deal in the lookback window. Notes are excluded (internal). True
 * "outbound only" filtering would require surfacing `hs_email_direction` and
 * `hs_call_direction` through the Engagement type — deferred to Phase 2.
 *
 * Outputs:
 *   - ghostRate: fraction of portfolio with no engagement in last 14d
 *   - medianDaysSinceLastTouch: median across portfolio
 *   - touchFrequency30d: total engagements / portfolio size
 */

import { prisma } from "@/lib/db";
import { getDealEngagements } from "@/lib/hubspot-engagements";
import { rawNamesFor, type PmName } from "../owners";
import { THRESHOLDS } from "../thresholds";

const COMMUNICATION_TYPES = new Set(["email", "call", "meeting"]);

export interface EngagementMetricResult {
  ghostRate: number;
  medianDaysSinceLastTouch: number;
  touchFrequency30d: number;
  portfolioCount: number;
}

const TERMINAL_STAGES = ["closedwon", "closedlost"];
const PRE_INSTALL_WINDOW_DAYS = 30; // lookback for touchFrequency30d

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export async function computeEngagementForPM(
  pmName: PmName,
): Promise<EngagementMetricResult> {
  const variants = rawNamesFor(pmName);

  // Pre-install deals: no construction-complete date AND either no install
  // scheduled or install scheduled in the future. Exclude closed-out deals.
  const now = new Date();
  const deals = await prisma.deal.findMany({
    where: {
      projectManager: { in: variants, mode: "insensitive" },
      stageId: { notIn: TERMINAL_STAGES },
      constructionCompleteDate: null,
      OR: [
        { installScheduleDate: null },
        { installScheduleDate: { gt: now } },
      ],
    },
    select: { hubspotDealId: true },
  });

  if (deals.length === 0) {
    return { ghostRate: 0, medianDaysSinceLastTouch: 0, touchFrequency30d: 0, portfolioCount: 0 };
  }

  const ghostThresholdMs = THRESHOLDS.ghostDays * 24 * 60 * 60 * 1000;
  const freqWindowMs = PRE_INSTALL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  let ghostedCount = 0;
  let totalEngagements30d = 0;
  const daysSinceLastTouch: number[] = [];

  // Sequential fetch to avoid hammering HubSpot rate limits — typical
  // portfolio is 25-100 deals; ~1-3s per PM, fine for nightly cron.
  for (const deal of deals) {
    let engagements = [];
    try {
      engagements = await getDealEngagements(deal.hubspotDealId, false);
    } catch (err) {
      console.warn(`[pm-tracker:engagement] fetch failed for deal ${deal.hubspotDealId}:`, err);
      // Treat as ghosted (conservative — flag what we can't verify)
      ghostedCount += 1;
      daysSinceLastTouch.push(365);
      continue;
    }

    const communications = engagements.filter((e) => COMMUNICATION_TYPES.has(e.type));
    if (communications.length === 0) {
      ghostedCount += 1;
      daysSinceLastTouch.push(365);
      continue;
    }

    const latest = new Date(communications[0].timestamp).getTime(); // pre-sorted desc
    const ageMs = now.getTime() - latest;
    if (ageMs > ghostThresholdMs) ghostedCount += 1;
    daysSinceLastTouch.push(ageMs / (24 * 60 * 60 * 1000));

    // Count communications in last 30 days
    const cutoff = now.getTime() - freqWindowMs;
    totalEngagements30d += communications.filter(
      (e) => new Date(e.timestamp).getTime() >= cutoff,
    ).length;
  }

  return {
    ghostRate: ghostedCount / deals.length,
    medianDaysSinceLastTouch: median(daysSinceLastTouch),
    touchFrequency30d: totalEngagements30d / deals.length,
    portfolioCount: deals.length,
  };
}
