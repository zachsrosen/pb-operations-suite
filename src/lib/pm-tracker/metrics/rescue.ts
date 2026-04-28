/**
 * Metric F — Stalled-deal rescue.
 *
 * Scope: PM-owned active deals.
 *
 * Phase 1 implementation: only stuckCountNow is computed. medianTimeToUnstick90d
 * and recoveryRate90d require deal-stage history tracking, which lands with
 * Phase 2 alongside the saves detector. Phase 1 returns null for those.
 *
 * Stuck detection: read `hs_date_entered_<stageId>` from Deal.rawProperties
 * (HubSpot caches this on every deal; we already have it in the JSON blob).
 * If `(now - that timestamp) > THRESHOLDS.stuckDays`, the deal is stuck.
 *
 * Output:
 *   - stuckCountNow: number of currently-stuck deals on portfolio
 *   - medianTimeToUnstick90d: null (Phase 2)
 *   - recoveryRate90d: null (Phase 2)
 */

import { prisma } from "@/lib/db";
import { rawNamesFor, type PmName } from "../owners";
import { THRESHOLDS } from "../thresholds";
import { getStageEnteredAt } from "../stage-entry";

export { getStageEnteredAt };

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STAGES = ["closedwon", "closedlost"];

export interface RescueMetricResult {
  stuckCountNow: number;
  medianTimeToUnstick90d: number | null;
  recoveryRate90d: number | null;
  portfolioCount: number;
}

export async function computeRescueForPM(pmName: PmName): Promise<RescueMetricResult> {
  const variants = rawNamesFor(pmName);
  const now = new Date();

  const deals = await prisma.deal.findMany({
    where: {
      projectManager: { in: variants, mode: "insensitive" },
      stageId: { notIn: TERMINAL_STAGES },
    },
    select: {
      stageId: true,
      rawProperties: true,
      lastSyncedAt: true,
    },
  });

  if (deals.length === 0) {
    return {
      stuckCountNow: 0,
      medianTimeToUnstick90d: null,
      recoveryRate90d: null,
      portfolioCount: 0,
    };
  }

  const stuckThresholdMs = THRESHOLDS.stuckDays * DAY_MS;
  let stuckCount = 0;

  for (const d of deals) {
    const enteredAt = getStageEnteredAt(d.rawProperties, d.stageId);
    // Fallback: if we can't determine stage entry, fall back to lastSyncedAt
    // (over-counts stuck — conservative for surfacing problem deals)
    const reference = enteredAt ?? d.lastSyncedAt;
    const ageMs = now.getTime() - reference.getTime();
    if (ageMs > stuckThresholdMs) stuckCount += 1;
  }

  return {
    stuckCountNow: stuckCount,
    medianTimeToUnstick90d: null, // Phase 2
    recoveryRate90d: null, // Phase 2
    portfolioCount: deals.length,
  };
}
