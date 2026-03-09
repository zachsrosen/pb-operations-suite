/**
 * Solar Scenarios — Logic
 *
 * Pure functions for scenario CRUD, baseline comparison, and delta computation.
 * No side effects — components call these and persist results.
 */

import type {
  Scenario,
  ScenarioOverride,
  ScenarioResult,
  ScenarioDelta,
  ScenariosJson,
} from "./scenario-types";

// ── ID Generation ────────────────────────────────────────────

let counter = 0;

function generateId(): string {
  counter += 1;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `sc_${ts}_${rand}_${counter}`;
}

// ── CRUD ─────────────────────────────────────────────────────

/**
 * Create a new scenario with the given name and overrides.
 * Returns the updated scenarios array (immutable).
 */
export function createScenario(
  scenarios: ScenariosJson,
  name: string,
  overrides: ScenarioOverride = {}
): ScenariosJson {
  const newScenario: Scenario = {
    id: generateId(),
    name: name.trim() || `Scenario ${scenarios.length + 1}`,
    overrides,
    result: null,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
  };
  return [...scenarios, newScenario];
}

/**
 * Duplicate an existing scenario with a new name.
 * Clears cached result (must be re-run after any changes).
 */
export function duplicateScenario(
  scenarios: ScenariosJson,
  sourceId: string,
  newName?: string
): ScenariosJson {
  const source = scenarios.find((s) => s.id === sourceId);
  if (!source) return scenarios;

  const dup: Scenario = {
    id: generateId(),
    name: newName || `${source.name} (copy)`,
    overrides: JSON.parse(JSON.stringify(source.overrides)),
    result: null, // must re-run
    createdAt: new Date().toISOString(),
    lastRunAt: null,
  };
  return [...scenarios, dup];
}

/**
 * Rename a scenario.
 */
export function renameScenario(
  scenarios: ScenariosJson,
  id: string,
  newName: string
): ScenariosJson {
  return scenarios.map((s) =>
    s.id === id ? { ...s, name: newName.trim() || s.name } : s
  );
}

/**
 * Delete a scenario by ID.
 */
export function deleteScenario(
  scenarios: ScenariosJson,
  id: string
): ScenariosJson {
  return scenarios.filter((s) => s.id !== id);
}

/**
 * Update a scenario's overrides. Clears cached result.
 */
export function updateScenarioOverrides(
  scenarios: ScenariosJson,
  id: string,
  overrides: ScenarioOverride
): ScenariosJson {
  return scenarios.map((s) =>
    s.id === id
      ? { ...s, overrides, result: null, lastRunAt: null }
      : s
  );
}

/**
 * Cache a simulation result for a scenario.
 */
export function setScenarioResult(
  scenarios: ScenariosJson,
  id: string,
  result: ScenarioResult
): ScenariosJson {
  return scenarios.map((s) =>
    s.id === id
      ? { ...s, result, lastRunAt: new Date().toISOString() }
      : s
  );
}

// ── Compare / Delta ─────────────────────────────────────────

/**
 * Compute deltas for all scenarios that have results, relative to a baseline.
 *
 * Returns deltas sorted by scenario creation order.
 * Scenarios without results are skipped.
 */
export function computeDeltas(
  scenarios: ScenariosJson,
  baseline: ScenarioResult
): ScenarioDelta[] {
  return scenarios
    .filter((s): s is Scenario & { result: ScenarioResult } => s.result !== null)
    .map((s) => {
      const r = s.result;
      const deltaAnnualKwh = r.annualKwh - baseline.annualKwh;
      const deltaSystemSizeKw = r.systemSizeKw - baseline.systemSizeKw;
      const deltaSpecificYield = r.specificYield - baseline.specificYield;

      return {
        scenarioId: s.id,
        scenarioName: s.name,
        annualKwh: r.annualKwh,
        systemSizeKw: r.systemSizeKw,
        specificYield: r.specificYield,
        deltaAnnualKwh,
        deltaSystemSizeKw,
        deltaSpecificYield,
        pctChangeAnnualKwh: baseline.annualKwh > 0
          ? (deltaAnnualKwh / baseline.annualKwh) * 100
          : 0,
        pctChangeSpecificYield: baseline.specificYield > 0
          ? (deltaSpecificYield / baseline.specificYield) * 100
          : 0,
        isQuickEstimate: r.isQuickEstimate,
        quality: r.quality,
        isMixedQuality: r.isQuickEstimate !== baseline.isQuickEstimate,
      };
    });
}

/**
 * Check whether any scenario has a mixed-quality comparison with the baseline.
 */
export function hasMixedQualityWarning(
  scenarios: ScenariosJson,
  baselineIsQuickEstimate: boolean
): boolean {
  return scenarios.some(
    (s) => s.result !== null && s.result.isQuickEstimate !== baselineIsQuickEstimate
  );
}

/**
 * Count scenarios by run state.
 */
export function scenarioStats(scenarios: ScenariosJson): {
  total: number;
  withResults: number;
  pending: number;
} {
  const withResults = scenarios.filter((s) => s.result !== null).length;
  return {
    total: scenarios.length,
    withResults,
    pending: scenarios.length - withResults,
  };
}
