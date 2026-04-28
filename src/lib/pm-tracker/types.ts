/**
 * Shared types for the PM accountability tracker.
 */

import type { PmName } from "./owners";

export interface PmMetrics {
  // B - Customer engagement
  ghostRate: number;
  medianDaysSinceLastTouch: number;
  touchFrequency30d: number;

  // D - Pre-install readiness
  readinessScore: number;
  dayOfFailures90d: number;

  // E - Stage hygiene
  fieldPopulationScore: number;
  staleDataCount: number;

  // F - Stalled-deal rescue
  stuckCountNow: number;
  /** null in Phase 1 (computed only after Phase 2 history tracking lands) */
  medianTimeToUnstick90d: number | null;
  /** null in Phase 1 */
  recoveryRate90d: number | null;

  // G - Customer satisfaction
  reviewRate: number;
  avgReviewScore: number;
  complaintRatePer100: number;
}

export interface PmScorecard {
  pmName: PmName;
  periodStart: string; // ISO
  periodEnd: string; // ISO
  metrics: PmMetrics;
  portfolioCount: number;
  computedAt: string; // ISO
}

export interface TeamSummary {
  scorecards: PmScorecard[];
  periodStart: string;
  periodEnd: string;
}

export type AtRiskReason =
  | "STUCK"
  | "GHOSTED"
  | "PERMIT_OVERDUE"
  | "READINESS_GAP";

export interface AtRiskDeal {
  hubspotDealId: string;
  dealName: string;
  pmName: PmName;
  reason: AtRiskReason;
  daysAtRisk: number;
  url: string;
  /** Free-text detail to display alongside the reason (e.g., "missing permit") */
  detail?: string;
}
