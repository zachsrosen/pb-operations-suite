/**
 * Solar Export — PDF Summary
 *
 * Generates a printable HTML string that can be opened in a new tab
 * and printed to PDF via the browser's print dialog.
 *
 * No external PDF library dependency — uses `window.print()`.
 * Includes quality metadata badges and mixed-quality warnings.
 */

import type { ScenarioResult, ScenarioDelta } from "../scenarios/scenario-types";
import { MONTH_LABELS } from "../adapters/worker-to-ui";

interface PdfEntry {
  name: string;
  result: ScenarioResult;
}

/**
 * Generate a printable HTML document string for PDF export.
 */
export function generatePdfHtml(
  projectName: string,
  baseline: PdfEntry,
  scenarios: PdfEntry[],
  deltas: ScenarioDelta[]
): string {
  const hasMixed = scenarios.some(
    (s) => s.result.isQuickEstimate !== baseline.result.isQuickEstimate
  );

  const rows = [baseline, ...scenarios];
  const allDeltas = deltas;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(projectName)} — Solar Analysis Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 2rem; color: #1a1a2e; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .subtitle { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 0.5rem 0.75rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.8rem; color: #856404; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 0.8rem; }
    th, td { padding: 0.4rem 0.6rem; border: 1px solid #ddd; text-align: right; }
    th { background: #f5f5f5; font-weight: 600; text-align: left; }
    td:first-child { text-align: left; }
    .badge { display: inline-block; font-size: 0.65rem; padding: 0.1rem 0.4rem; border-radius: 3px; font-weight: 600; }
    .badge-qe { background: #fff3cd; color: #856404; }
    .badge-full { background: #d4edda; color: #155724; }
    .delta-pos { color: #155724; }
    .delta-neg { color: #a71d2a; }
    .monthly-table td { text-align: center; }
    .footer { margin-top: 2rem; font-size: 0.7rem; color: #999; border-top: 1px solid #eee; padding-top: 0.5rem; }
    @media print { body { padding: 1rem; } .no-print { display: none; } }
  </style>
</head>
<body>
  <h1>${esc(projectName)}</h1>
  <p class="subtitle">Solar Analysis Report &mdash; Generated ${new Date().toLocaleDateString()}</p>

  ${hasMixed ? '<div class="warning">&#9888; This report contains a mix of Quick Estimate and Full Design results. Comparisons are approximate.</div>' : ""}

  <h2 style="font-size:1.1rem;margin-bottom:0.5rem">Summary</h2>
  <table>
    <thead>
      <tr>
        <th>Scenario</th>
        <th>Quality</th>
        <th>Annual kWh</th>
        <th>System kW</th>
        <th>Panels</th>
        <th>Yield kWh/kWp</th>
        <th>Mismatch %</th>
        <th>&#916; Annual</th>
        <th>&#916; %</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((row, i) => {
        const delta = i === 0 ? null : allDeltas.find((d) => d.scenarioName === row.name);
        const r = row.result;
        return `<tr>
          <td>${esc(row.name)}</td>
          <td><span class="badge ${r.quality === "quick_estimate" ? "badge-qe" : "badge-full"}">${r.quality === "quick_estimate" ? "QE" : "Full"}</span></td>
          <td>${fmtNum(r.annualKwh, 0)}</td>
          <td>${fmtNum(r.systemSizeKw, 2)}</td>
          <td>${r.panelCount}</td>
          <td>${fmtNum(r.specificYield, 0)}</td>
          <td>${r.mismatchLossPct !== null ? fmtNum(r.mismatchLossPct, 1) + "%" : "N/A"}</td>
          <td>${delta ? fmtDelta(delta.deltaAnnualKwh, 0, " kWh") : "&mdash;"}</td>
          <td>${delta ? fmtDelta(delta.pctChangeAnnualKwh, 1, "%") : "&mdash;"}</td>
        </tr>`;
      }).join("\n")}
    </tbody>
  </table>

  <h2 style="font-size:1.1rem;margin-bottom:0.5rem">Monthly Production (kWh)</h2>
  <table class="monthly-table">
    <thead>
      <tr>
        <th>Scenario</th>
        ${MONTH_LABELS.map((m) => `<th>${m}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${rows.map((row) => {
        const monthly = row.result.monthlyKwh || [];
        return `<tr>
          <td>${esc(row.name)}</td>
          ${MONTH_LABELS.map((_, i) => `<td>${fmtNum(monthly[i] || 0, 0)}</td>`).join("")}
        </tr>`;
      }).join("\n")}
    </tbody>
  </table>

  <div class="footer">
    PB Operations Suite &mdash; Solar Surveyor Analysis Report
  </div>
</body>
</html>`;
}

/**
 * Open a printable PDF in a new browser tab using DOM APIs.
 */
export function openPdfPrintView(html: string): void {
  const win = window.open("", "_blank");
  if (win) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    // Copy the parsed content into the new window
    win.document.replaceChild(
      win.document.importNode(doc.documentElement, true),
      win.document.documentElement
    );
    win.document.close();
    win.print();
  }
}

// ── Helpers ──────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtNum(val: number, decimals: number): string {
  return val.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDelta(val: number, decimals: number, suffix: string): string {
  const cls = val > 0 ? "delta-pos" : val < 0 ? "delta-neg" : "";
  const sign = val > 0 ? "+" : "";
  return `<span class="${cls}">${sign}${fmtNum(val, decimals)}${suffix}</span>`;
}
