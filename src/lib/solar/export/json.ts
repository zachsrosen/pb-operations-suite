/**
 * Solar Export — JSON
 *
 * Generates a structured JSON export from baseline + scenario results.
 * Includes quality metadata per entry and mixed-quality warnings.
 */

import type { ScenarioResult, ScenarioDelta } from "../scenarios/scenario-types";

interface ExportEntry {
  name: string;
  result: ScenarioResult;
}

export interface JsonExportData {
  exportVersion: 1;
  exportedAt: string;
  projectName: string;
  baseline: {
    name: string;
    quality: "quick_estimate" | "full";
    result: ScenarioResult;
  };
  scenarios: Array<{
    name: string;
    quality: "quick_estimate" | "full";
    result: ScenarioResult;
    delta: ScenarioDelta | null;
  }>;
  warnings: string[];
}

/**
 * Generate a structured JSON export object.
 */
export function exportToJson(
  projectName: string,
  baseline: ExportEntry,
  scenarios: ExportEntry[],
  deltas: ScenarioDelta[]
): JsonExportData {
  const warnings: string[] = [];

  // Check for mixed quality
  const hasMixed = scenarios.some(
    (s) => s.result.isQuickEstimate !== baseline.result.isQuickEstimate
  );
  if (hasMixed) {
    warnings.push(
      "This export contains a mix of Quick Estimate and Full Design results. Comparisons between them are approximate."
    );
  }

  return {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    projectName,
    baseline: {
      name: baseline.name,
      quality: baseline.result.quality,
      result: baseline.result,
    },
    scenarios: scenarios.map((s) => {
      const delta = deltas.find((d) => d.scenarioName === s.name) || null;
      return {
        name: s.name,
        quality: s.result.quality,
        result: s.result,
        delta,
      };
    }),
    warnings,
  };
}

/**
 * Trigger a JSON download in the browser.
 */
export function downloadJson(data: JsonExportData, filename: string): void {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
