/**
 * Revenue Groups Configuration & Pure Computations
 *
 * Client-safe: no server-only imports (hubspot, db, prisma, etc.).
 * Used by both the API route (server) and potential client components.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** How revenue is "recognized" for a deal in a pipeline */
export type RecognitionStrategy = "construction_complete" | "gated" | "split";

/** Recognition rule for a single pipeline within a group */
export interface RecognitionRule {
  pipelineId: string;
  strategy: RecognitionStrategy;
  /**
   * For "construction_complete": field name holding the completion date.
   * For "gated": field name for the stage-gate completion date.
   * For "split": array of [field, fraction] tuples (must sum to 1).
   */
  dateField?: string;
  splitFields?: [field: string, fraction: number][];
}

/** Configuration for one revenue group (office / vertical) */
export interface RevenueGroupConfig {
  key: string;
  label: string;
  color: string;
  annualTarget: number;
  /** Pipeline(s) + recognition strategy */
  recognition: RecognitionRule[];
  /** Optional location filter — deal.pb_location must match one of these */
  locationFilter?: string[];
  /** Stage IDs to exclude (cancelled, etc.) across all pipelines in this group */
  excludedStages: string[];
}

/** Pace status relative to expected pro-rata target */
export type PaceStatus = "ahead" | "on_pace" | "behind";

/** Monthly result for a single month */
export interface MonthResult {
  month: number; // 0-11
  actual: number;
  baseTarget: number;
  effectiveTarget: number;
  closed: boolean;
  hit: boolean;
  missed: boolean;
  currentMonthOnTarget: boolean;
}

/** Full result for one revenue group */
export interface RevenueGroupResult {
  groupKey: string;
  displayName: string;
  color: string;
  annualTarget: number;
  ytdActual: number;
  ytdPaceExpected: number;
  paceStatus: PaceStatus;
  discoveryGated: boolean;
  months: MonthResult[];
}

/** Top-level API response shape */
export interface RevenueGoalResponse {
  year: number;
  lastUpdated: string; // ISO timestamp
  groups: RevenueGroupResult[];
  companyTotal: {
    annualTarget: number;
    ytdActual: number;
    ytdPaceExpected: number;
    paceStatus: PaceStatus;
  };
}

/**
 * Minimal deal shape for aggregation. Uses index signature so callers
 * can pass raw HubSpot properties directly.
 */
export interface DealLike {
  [key: string]: string | undefined;
  hs_object_id: string;
  dealname?: string;
  amount?: string;
  pipeline?: string;
  dealstage?: string;
  pb_location?: string;
}

// ---------------------------------------------------------------------------
// Group configuration
// ---------------------------------------------------------------------------

/** Hardcoded pipeline IDs (no env vars — these never change) */
const PIPELINE = {
  PROJECT: "6900017",
  DNR: "21997330",
  ROOFING: "765928545",
  SERVICE: "23928924",
} as const;

/** Cancelled stage IDs per pipeline */
const CANCELLED_STAGES = {
  PROJECT: "68229433",
  DNR: "52474745",
  SERVICE: "56217769",
} as const;

export const REVENUE_GROUPS: Record<string, RevenueGroupConfig> = {
  westminster: {
    key: "westminster",
    label: "Westminster",
    color: "#3B82F6",
    annualTarget: 15_000_000,
    recognition: [
      {
        pipelineId: PIPELINE.PROJECT,
        strategy: "construction_complete",
        dateField: "construction_complete_date",
      },
    ],
    locationFilter: ["Westminster"],
    excludedStages: [CANCELLED_STAGES.PROJECT],
  },

  dtc: {
    key: "dtc",
    label: "DTC (Centennial)",
    color: "#10B981",
    annualTarget: 15_000_000,
    recognition: [
      {
        pipelineId: PIPELINE.PROJECT,
        strategy: "construction_complete",
        dateField: "construction_complete_date",
      },
    ],
    locationFilter: ["Centennial"],
    excludedStages: [CANCELLED_STAGES.PROJECT],
  },

  colorado_springs: {
    key: "colorado_springs",
    label: "Colorado Springs",
    color: "#F59E0B",
    annualTarget: 7_000_000,
    recognition: [
      {
        pipelineId: PIPELINE.PROJECT,
        strategy: "construction_complete",
        dateField: "construction_complete_date",
      },
    ],
    locationFilter: ["Colorado Springs"],
    excludedStages: [CANCELLED_STAGES.PROJECT],
  },

  california: {
    key: "california",
    label: "California",
    color: "#8B5CF6",
    annualTarget: 7_000_000,
    recognition: [
      {
        pipelineId: PIPELINE.PROJECT,
        strategy: "construction_complete",
        dateField: "construction_complete_date",
      },
    ],
    locationFilter: ["San Luis Obispo", "Camarillo"],
    excludedStages: [CANCELLED_STAGES.PROJECT],
  },

  roofing_dnr: {
    key: "roofing_dnr",
    label: "Roofing & D&R",
    color: "#EC4899",
    annualTarget: 7_000_000,
    recognition: [
      {
        pipelineId: PIPELINE.DNR,
        strategy: "split",
        splitFields: [
          ["detach_completion_date", 0.5],
          ["reset_completion_date", 0.5],
        ],
      },
      {
        pipelineId: PIPELINE.ROOFING,
        strategy: "gated",
        dateField: "closedate",
      },
    ],
    excludedStages: [CANCELLED_STAGES.DNR],
  },

  service: {
    key: "service",
    label: "Service",
    color: "#06B6D4",
    annualTarget: 1_500_000,
    recognition: [
      {
        pipelineId: PIPELINE.SERVICE,
        strategy: "gated",
        dateField: "closedate",
      },
    ],
    excludedStages: [CANCELLED_STAGES.SERVICE],
  },
};

// ---------------------------------------------------------------------------
// Pure computation functions
// ---------------------------------------------------------------------------

/**
 * Returns the number of fully-closed calendar months relative to `now`.
 * January → 0 (no months closed yet), March → 2 (Jan+Feb closed), etc.
 */
export function getClosedMonthCount(now: Date): number {
  return now.getUTCMonth(); // 0-indexed: Jan=0 means 0 closed months
}

/**
 * Compute effective monthly targets with shortfall/surplus redistribution.
 *
 * Closed months keep their base target (frozen). Any cumulative shortfall
 * or surplus is spread equally across the remaining open months.
 *
 * @param baseTargets  - 12-element array of monthly base targets
 * @param actuals      - 12-element array of monthly actuals
 * @param closedMonths - number of months fully closed (0-12)
 * @returns 12-element array of effective targets
 */
export function computeEffectiveTargets(
  baseTargets: number[],
  actuals: number[],
  closedMonths: number
): number[] {
  const result = [...baseTargets];
  const remainingMonths = 12 - closedMonths;

  if (remainingMonths <= 0) {
    return result;
  }

  // Sum up shortfall (positive) or surplus (negative) from closed months
  let cumulativeDelta = 0;
  for (let i = 0; i < closedMonths; i++) {
    cumulativeDelta += baseTargets[i] - actuals[i];
  }

  // Distribute delta across remaining months
  const perMonthAdjustment = cumulativeDelta / remainingMonths;
  for (let i = closedMonths; i < 12; i++) {
    result[i] = baseTargets[i] + perMonthAdjustment;
  }

  return result;
}

/**
 * Determine pace status by comparing actual vs expected revenue.
 *
 * - ahead:   actual > 105% of expected
 * - on_pace: actual within 95-105% of expected
 * - behind:  actual < 95% of expected
 */
export function computePaceStatus(
  actual: number,
  expected: number
): PaceStatus {
  if (expected === 0 && actual === 0) return "on_pace";
  if (expected === 0) return "ahead"; // any revenue with $0 expected

  const ratio = actual / expected;
  if (ratio > 1.05) return "ahead";
  if (ratio < 0.95) return "behind";
  return "on_pace";
}

// ---------------------------------------------------------------------------
// Revenue aggregation
// ---------------------------------------------------------------------------

/** Internal: maps pipeline ID → group keys that include that pipeline */
function buildPipelineGroupIndex(
  groups: Record<string, RevenueGroupConfig>
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [key, cfg] of Object.entries(groups)) {
    for (const rule of cfg.recognition) {
      const existing = index.get(rule.pipelineId) ?? [];
      existing.push(key);
      index.set(rule.pipelineId, existing);
    }
  }
  return index;
}

/**
 * Parse a date string and return the 0-indexed month if it falls within `year`.
 * Returns null if the date is missing, unparseable, or outside the target year.
 */
function parseMonthInYear(
  dateStr: string | undefined,
  year: number
): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() !== year) return null;
  return d.getUTCMonth();
}

/**
 * Aggregate deals into monthly actuals per revenue group.
 *
 * @param deals  - Array of deal-like objects with HubSpot properties
 * @param groups - Revenue group config map
 * @param year   - Calendar year to aggregate for
 * @returns Map of group key → { monthlyActuals: number[12] }
 */
export function aggregateRevenue(
  deals: DealLike[],
  groups: Record<string, RevenueGroupConfig>,
  year: number
): Record<string, { monthlyActuals: number[] }> {
  // Initialize result
  const result: Record<string, { monthlyActuals: number[] }> = {};
  for (const key of Object.keys(groups)) {
    result[key] = { monthlyActuals: Array(12).fill(0) };
  }

  const pipelineIndex = buildPipelineGroupIndex(groups);

  for (const deal of deals) {
    const pipelineId = deal.pipeline;
    if (!pipelineId) continue;

    const amount = parseFloat(deal.amount ?? "0") || 0;
    if (amount <= 0) continue;

    // Find candidate groups for this pipeline
    const candidateKeys = pipelineIndex.get(pipelineId);
    if (!candidateKeys) continue;

    for (const groupKey of candidateKeys) {
      const group = groups[groupKey];

      // Check excluded stages
      if (deal.dealstage && group.excludedStages.includes(deal.dealstage)) {
        continue;
      }

      // Check location filter
      if (group.locationFilter) {
        const dealLocation = deal.pb_location;
        if (!dealLocation || !group.locationFilter.includes(dealLocation)) {
          continue;
        }
      }

      // Find the recognition rule for this pipeline
      const rule = group.recognition.find(
        (r) => r.pipelineId === pipelineId
      );
      if (!rule) continue;

      // Apply recognition strategy
      switch (rule.strategy) {
        case "construction_complete":
        case "gated": {
          const dateField = rule.dateField;
          if (!dateField) break;
          const month = parseMonthInYear(deal[dateField], year);
          if (month !== null) {
            result[groupKey].monthlyActuals[month] += amount;
          }
          break;
        }

        case "split": {
          if (!rule.splitFields) break;
          for (const [field, fraction] of rule.splitFields) {
            const month = parseMonthInYear(deal[field], year);
            if (month !== null) {
              result[groupKey].monthlyActuals[month] += amount * fraction;
            }
          }
          break;
        }
      }
    }
  }

  return result;
}
