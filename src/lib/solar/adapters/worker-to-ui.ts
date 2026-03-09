/**
 * Solar Engine — Worker-to-UI Result Adapter
 *
 * Maps WorkerResultMessage["payload"] → AnalysisResult with:
 * - Null-safe accessors for modelB (null for micro/optimizer [P1-F3])
 * - isQuickEstimate propagation for non-authoritative output policy
 * - Flattened UI-friendly fields
 */

import type { WorkerResultMessage, EnergyBalance } from "../types";

// ── UI Result Type ──────────────────────────────────────────

export interface AnalysisResult {
  /** Schema version from engine */
  schemaVersion: number;

  /** System summary */
  panelCount: number;
  systemSizeKw: number;
  systemTsrf: number;
  specificYield: number;

  /** Model A — always present */
  annualKwh: number;
  monthlyKwh: number[];

  /** Model B — null for micro/optimizer [P1-F3] */
  mismatchLossPct: number | null;
  modelBAnnualKwh: number | null;

  /** Dispatch — null when no battery/home consumption */
  energyBalance: EnergyBalance | null;
  clippingLossPct: number | null;
  curtailedKwh: number | null;

  /** Battery presence flag */
  hasBattery: boolean;

  /**
   * Quick Estimate flag — when true:
   * - All result cards show "Quick Estimate" badge
   * - "Save Results" button is disabled
   * - Results cannot be persisted as a revision
   */
  isQuickEstimate: boolean;
}

// ── Mapper ──────────────────────────────────────────────────

/**
 * Map raw worker result + adapter metadata to a UI-safe AnalysisResult.
 *
 * @param raw - The payload from WorkerResultMessage
 * @param isQuickEstimate - Whether this was a Quick Estimate run [B1]
 */
export function mapWorkerResultToUI(
  raw: WorkerResultMessage["payload"],
  isQuickEstimate: boolean
): AnalysisResult {
  return {
    schemaVersion: raw.schemaVersion,

    // System summary
    panelCount: raw.panelCount,
    systemSizeKw: raw.systemSizeKw,
    systemTsrf: raw.systemTsrf,
    specificYield: raw.specificYield,

    // Model A — always present
    annualKwh: raw.modelA.annualKwh,
    monthlyKwh: raw.modelA.monthlyKwh,

    // Model B — null-safe [P1-F3]
    mismatchLossPct: raw.modelB?.mismatchLossPct ?? null,
    modelBAnnualKwh: raw.modelB?.annualKwh ?? null,

    // Dispatch — null-safe
    energyBalance: raw.dispatch?.energyBalance ?? null,
    clippingLossPct: raw.dispatch?.clippingLossPct ?? null,
    curtailedKwh: raw.dispatch?.curtailedKwh ?? null,

    // Derived flags
    hasBattery: (raw.dispatch?.energyBalance?.batteryChargedKwh ?? 0) > 0,
    isQuickEstimate,
  };
}

// ── Helpers ─────────────────────────────────────────────────

/** Format kWh with appropriate precision */
export function formatKwh(kwh: number): string {
  if (kwh === 0) return "0 kWh";
  if (kwh < 1) return `${(kwh * 1000).toFixed(0)} Wh`;
  if (kwh < 100) return `${kwh.toFixed(1)} kWh`;
  return `${Math.round(kwh).toLocaleString()} kWh`;
}

/** Format percentage with one decimal */
export function formatPercent(pct: number | null): string {
  if (pct === null) return "N/A";
  return `${pct.toFixed(1)}%`;
}

/** Month labels for 12-bar chart */
export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;
