/**
 * Snapshot orchestrator — runs all 5 Phase 1 metrics for each PM and writes
 * the result to PMSnapshot via upsert.
 *
 * Period semantics: each snapshot covers a 90-day window ending at
 * `periodEnd`. The unique key is (pmName, periodStart, periodEnd), so
 * running the same `periodEnd` twice in one day is idempotent — second run
 * overwrites the first.
 */

import { prisma } from "@/lib/db";
import { PM_NAMES, type PmName } from "./owners";
import { computeEngagementForPM } from "./metrics/engagement";
import { computeReadinessForPM } from "./metrics/readiness";
import { computeHygieneForPM } from "./metrics/hygiene";
import { computeRescueForPM } from "./metrics/rescue";
import { computeCsatForPM } from "./metrics/csat";

const PERIOD_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Truncate a Date to the start of its UTC day. Used so periodEnd is stable
 * regardless of which time the cron actually fires.
 */
function truncateToUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function buildSnapshot(pmName: PmName, periodEnd: Date): Promise<void> {
  const periodEndDay = truncateToUtcDay(periodEnd);
  const periodStart = new Date(periodEndDay.getTime() - PERIOD_DAYS * DAY_MS);

  // Run all 5 metrics in parallel — they touch independent data sources.
  // Engagement and readiness are the slowest (HubSpot API per deal).
  const [eng, ready, hyg, res, csat] = await Promise.all([
    computeEngagementForPM(pmName),
    computeReadinessForPM(pmName),
    computeHygieneForPM(pmName),
    computeRescueForPM(pmName),
    computeCsatForPM(pmName),
  ]);

  // Portfolio count: max across the metric scopes (each scope filters
  // differently — engagement = pre-install, hygiene = all active, csat =
  // installed). Hygiene's count is the closest to "active portfolio."
  const portfolioCount = Math.max(eng.portfolioCount, hyg.portfolioCount);

  const data = {
    ghostRate: eng.ghostRate,
    medianDaysSinceLastTouch: eng.medianDaysSinceLastTouch,
    touchFrequency30d: eng.touchFrequency30d,
    readinessScore: ready.readinessScore,
    dayOfFailures90d: ready.dayOfFailures90d,
    fieldPopulationScore: hyg.fieldPopulationScore,
    staleDataCount: hyg.staleDataCount,
    stuckCountNow: res.stuckCountNow,
    // Pass through null (rather than coerce to 0) — the columns are nullable
    // so the UI can distinguish "not computed" from "0% / 0 days."
    medianTimeToUnstick90d: res.medianTimeToUnstick90d,
    recoveryRate90d: res.recoveryRate90d,
    reviewRate: csat.reviewRate,
    avgReviewScore: csat.avgReviewScore,
    complaintRatePer100: csat.complaintRatePer100,
    portfolioCount,
  };

  await prisma.pMSnapshot.upsert({
    where: {
      pmName_periodStart_periodEnd: {
        pmName,
        periodStart,
        periodEnd: periodEndDay,
      },
    },
    create: { pmName, periodStart, periodEnd: periodEndDay, ...data },
    update: { ...data, computedAt: new Date() },
  });
}

export interface BuildAllSnapshotsResult {
  succeeded: PmName[];
  failed: Array<{ pmName: PmName; error: string }>;
}

export async function buildAllSnapshots(
  periodEnd: Date = new Date(),
): Promise<BuildAllSnapshotsResult> {
  const succeeded: PmName[] = [];
  const failed: Array<{ pmName: PmName; error: string }> = [];

  for (const pmName of PM_NAMES) {
    try {
      await buildSnapshot(pmName, periodEnd);
      succeeded.push(pmName);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[pm-tracker:snapshot] failed for ${pmName}:`, err);
      failed.push({ pmName, error: message });
      // Continue with next PM — one failure must not abort the batch
    }
  }

  return { succeeded, failed };
}
