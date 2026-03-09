/**
 * Solar Scenarios — Type Contracts
 *
 * A scenario represents an equipment/config override set that can be
 * simulated independently and compared against the baseline (current project config).
 *
 * Persistence: scenarios are stored as a JSON array in SolarProject.scenarios.
 * Each scenario carries its own cached result + isQuickEstimate flag.
 */

import type { AnalysisResult } from "../adapters/worker-to-ui";

// ── Scenario Definition ──────────────────────────────────────

export interface ScenarioOverride {
  /** Override equipment keys (null = use baseline) */
  panelKey?: string | null;
  inverterKey?: string | null;
  essKey?: string | null;
  optimizerKey?: string | null;
  /** Override loss profile values */
  lossProfile?: Partial<{
    soiling: number;
    mismatch: number;
    dcWiring: number;
    acWiring: number;
    availability: number;
    lid: number;
    snow: number;
    nameplate: number;
  }>;
  /** Override site conditions */
  siteConditions?: Partial<{
    groundAlbedo: number;
  }>;
}

export interface Scenario {
  /** Unique ID within the project (cuid-like) */
  id: string;
  /** User-facing name */
  name: string;
  /** Equipment/config overrides from baseline */
  overrides: ScenarioOverride;
  /** Cached simulation result (null = not yet run) */
  result: ScenarioResult | null;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Last run timestamp (ISO 8601, null = never run) */
  lastRunAt: string | null;
}

// ── Scenario Result ──────────────────────────────────────────

export interface ScenarioResult {
  /** Core metrics from analysis */
  annualKwh: number;
  monthlyKwh: number[];
  panelCount: number;
  systemSizeKw: number;
  systemTsrf: number;
  specificYield: number;
  mismatchLossPct: number | null;
  clippingLossPct: number | null;
  hasBattery: boolean;
  /** Quick Estimate propagation — non-authoritative marker */
  isQuickEstimate: boolean;
  /** Quality tag for export metadata */
  quality: "quick_estimate" | "full";
  /** Schema version from engine */
  schemaVersion: number;
}

// ── Compare Delta ────────────────────────────────────────────

export interface ScenarioDelta {
  scenarioId: string;
  scenarioName: string;
  /** Absolute metric values */
  annualKwh: number;
  systemSizeKw: number;
  specificYield: number;
  /** Delta from baseline (scenario - baseline) */
  deltaAnnualKwh: number;
  deltaSystemSizeKw: number;
  deltaSpecificYield: number;
  /** Percentage change from baseline */
  pctChangeAnnualKwh: number;
  pctChangeSpecificYield: number;
  /** Quality flags */
  isQuickEstimate: boolean;
  quality: "quick_estimate" | "full";
  /** True when comparing QE vs full or vice versa */
  isMixedQuality: boolean;
}

// ── Persistence Shape ────────────────────────────────────────

/**
 * The JSON stored in SolarProject.scenarios column.
 * It's simply an array of Scenario objects.
 */
export type ScenariosJson = Scenario[];

// ── Helpers ──────────────────────────────────────────────────

/**
 * Convert an AnalysisResult to a ScenarioResult for caching.
 */
export function analysisResultToScenarioResult(
  ar: AnalysisResult
): ScenarioResult {
  return {
    annualKwh: ar.annualKwh,
    monthlyKwh: ar.monthlyKwh,
    panelCount: ar.panelCount,
    systemSizeKw: ar.systemSizeKw,
    systemTsrf: ar.systemTsrf,
    specificYield: ar.specificYield,
    mismatchLossPct: ar.mismatchLossPct,
    clippingLossPct: ar.clippingLossPct,
    hasBattery: ar.hasBattery,
    isQuickEstimate: ar.isQuickEstimate,
    quality: ar.isQuickEstimate ? "quick_estimate" : "full",
    schemaVersion: ar.schemaVersion,
  };
}
