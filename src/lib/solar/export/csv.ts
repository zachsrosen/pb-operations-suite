/**
 * Solar Export — CSV
 *
 * Generates a CSV string from baseline + scenario results.
 * Includes quality metadata column per row.
 */

import type { ScenarioResult } from "../scenarios/scenario-types";
import { MONTH_LABELS } from "../adapters/worker-to-ui";

interface ExportRow {
  name: string;
  result: ScenarioResult;
}

/**
 * Generate a CSV string from baseline and scenario results.
 *
 * Columns:
 * Name, Quality, Annual kWh, System Size kW, Panel Count,
 * Specific Yield, Mismatch %, Clipping %, Has Battery,
 * Jan kWh, Feb kWh, ... Dec kWh
 */
export function exportToCsv(
  baseline: ExportRow,
  scenarios: ExportRow[]
): string {
  const monthHeaders = MONTH_LABELS.map((m) => `${m} kWh`);
  const headers = [
    "Name",
    "Quality",
    "Annual kWh",
    "System Size kW",
    "Panel Count",
    "Specific Yield kWh/kWp",
    "Mismatch %",
    "Clipping %",
    "Has Battery",
    ...monthHeaders,
  ];

  const rows = [baseline, ...scenarios].map((row) =>
    formatRow(row.name, row.result)
  );

  return [headers.join(","), ...rows].join("\n");
}

function formatRow(name: string, r: ScenarioResult): string {
  const monthValues = (r.monthlyKwh || []).map((v) => v.toFixed(1));
  // Pad to 12 months if needed
  while (monthValues.length < 12) monthValues.push("0.0");

  const fields = [
    csvEscape(name),
    r.quality,
    r.annualKwh.toFixed(1),
    r.systemSizeKw.toFixed(2),
    r.panelCount.toString(),
    r.specificYield.toFixed(1),
    r.mismatchLossPct !== null ? r.mismatchLossPct.toFixed(2) : "N/A",
    r.clippingLossPct !== null ? r.clippingLossPct.toFixed(2) : "N/A",
    r.hasBattery ? "Yes" : "No",
    ...monthValues,
  ];

  return fields.join(",");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Trigger a CSV download in the browser.
 */
export function downloadCsv(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
