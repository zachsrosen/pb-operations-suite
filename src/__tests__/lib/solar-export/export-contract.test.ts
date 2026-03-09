/**
 * Solar Export — Contract Tests
 *
 * Tests CSV, JSON, and PDF export structure, quality metadata,
 * and mixed-quality warnings.
 */

import { exportToCsv } from "@/lib/solar/export/csv";
import { exportToJson } from "@/lib/solar/export/json";
import { generatePdfHtml } from "@/lib/solar/export/pdf";
import type { ScenarioResult, ScenarioDelta } from "@/lib/solar/scenarios/scenario-types";

// ── Fixtures ────────────────────────────────────────────────

const fullResult: ScenarioResult = {
  annualKwh: 11000,
  monthlyKwh: [600, 650, 800, 950, 1100, 1200, 1250, 1150, 1000, 850, 700, 650],
  panelCount: 20,
  systemSizeKw: 8.8,
  systemTsrf: 0.82,
  specificYield: 1250,
  mismatchLossPct: 2.3,
  clippingLossPct: null,
  hasBattery: false,
  isQuickEstimate: false,
  quality: "full",
  schemaVersion: 1,
};

const qeResult: ScenarioResult = {
  ...fullResult,
  annualKwh: 10500,
  specificYield: 1193,
  mismatchLossPct: null,
  isQuickEstimate: true,
  quality: "quick_estimate",
};

const altResult: ScenarioResult = {
  ...fullResult,
  annualKwh: 12000,
  specificYield: 1364,
};

const baseDelta: ScenarioDelta = {
  scenarioId: "sc_1",
  scenarioName: "Alt Panel",
  annualKwh: 12000,
  systemSizeKw: 8.8,
  specificYield: 1364,
  deltaAnnualKwh: 1000,
  deltaSystemSizeKw: 0,
  deltaSpecificYield: 114,
  pctChangeAnnualKwh: 9.09,
  pctChangeSpecificYield: 9.12,
  isQuickEstimate: false,
  quality: "full",
  isMixedQuality: false,
};

const mixedDelta: ScenarioDelta = {
  ...baseDelta,
  scenarioId: "sc_2",
  scenarioName: "QE Scenario",
  annualKwh: 10500,
  specificYield: 1193,
  deltaAnnualKwh: -500,
  deltaSpecificYield: -57,
  pctChangeAnnualKwh: -4.55,
  pctChangeSpecificYield: -4.56,
  isQuickEstimate: true,
  quality: "quick_estimate",
  isMixedQuality: true,
};

// ── CSV Tests ───────────────────────────────────────────────

describe("CSV Export", () => {
  it("generates valid CSV with headers", () => {
    const csv = exportToCsv(
      { name: "Baseline", result: fullResult },
      []
    );

    const lines = csv.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2); // header + baseline
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Quality");
    expect(lines[0]).toContain("Annual kWh");
    expect(lines[0]).toContain("Jan kWh");
    expect(lines[0]).toContain("Dec kWh");
  });

  it("includes quality column with correct values", () => {
    const csv = exportToCsv(
      { name: "Baseline", result: fullResult },
      [{ name: "QE Scenario", result: qeResult }]
    );

    const lines = csv.split("\n");
    expect(lines[1]).toContain("full");
    expect(lines[2]).toContain("quick_estimate");
  });

  it("includes all 12 monthly values", () => {
    const csv = exportToCsv(
      { name: "Baseline", result: fullResult },
      []
    );

    const lines = csv.split("\n");
    const dataRow = lines[1].split(",");
    // Name, Quality, Annual, SystemSize, PanelCount, SpecificYield, Mismatch, Clipping, HasBattery + 12 months = 21 fields
    expect(dataRow.length).toBe(21);
  });

  it("handles N/A for null mismatch", () => {
    const csv = exportToCsv(
      { name: "Micro", result: qeResult },
      []
    );

    expect(csv).toContain("N/A");
  });

  it("escapes names with commas", () => {
    const csv = exportToCsv(
      { name: "Panel A, Option B", result: fullResult },
      []
    );

    const lines = csv.split("\n");
    // Name with comma should be quoted
    expect(lines[1]).toMatch(/^"/);
  });

  it("includes multiple scenarios in order", () => {
    const csv = exportToCsv(
      { name: "Baseline", result: fullResult },
      [
        { name: "Alt 1", result: altResult },
        { name: "Alt 2", result: qeResult },
      ]
    );

    const lines = csv.split("\n");
    expect(lines).toHaveLength(4); // header + baseline + 2 scenarios
    expect(lines[2]).toContain("Alt 1");
    expect(lines[3]).toContain("Alt 2");
  });
});

// ── JSON Tests ──────────────────────────────────────────────

describe("JSON Export", () => {
  it("exports with correct structure", () => {
    const data = exportToJson(
      "Test Project",
      { name: "Baseline", result: fullResult },
      [{ name: "Alt", result: altResult }],
      [baseDelta]
    );

    expect(data.exportVersion).toBe(1);
    expect(data.projectName).toBe("Test Project");
    expect(data.exportedAt).toBeTruthy();
    expect(data.baseline).toBeDefined();
    expect(data.scenarios).toHaveLength(1);
  });

  it("includes quality metadata on baseline", () => {
    const data = exportToJson(
      "Test",
      { name: "Baseline", result: fullResult },
      [],
      []
    );

    expect(data.baseline.quality).toBe("full");
    expect(data.baseline.name).toBe("Baseline");
  });

  it("includes quality metadata on scenarios", () => {
    const data = exportToJson(
      "Test",
      { name: "Baseline", result: fullResult },
      [{ name: "QE", result: qeResult }],
      [mixedDelta]
    );

    expect(data.scenarios[0].quality).toBe("quick_estimate");
  });

  it("includes delta for matching scenario", () => {
    const data = exportToJson(
      "Test",
      { name: "Baseline", result: fullResult },
      [{ name: "Alt Panel", result: altResult }],
      [baseDelta]
    );

    expect(data.scenarios[0].delta).not.toBeNull();
    expect(data.scenarios[0].delta!.deltaAnnualKwh).toBe(1000);
  });

  it("sets delta to null when no matching delta found", () => {
    const data = exportToJson(
      "Test",
      { name: "Baseline", result: fullResult },
      [{ name: "Unmatched", result: altResult }],
      [] // no deltas
    );

    expect(data.scenarios[0].delta).toBeNull();
  });

  it("adds mixed-quality warning when QE and full coexist", () => {
    const data = exportToJson(
      "Test",
      { name: "Baseline", result: fullResult },
      [{ name: "QE", result: qeResult }],
      [mixedDelta]
    );

    expect(data.warnings.length).toBeGreaterThan(0);
    expect(data.warnings[0]).toContain("mix");
  });

  it("has no warnings when all same quality", () => {
    const data = exportToJson(
      "Test",
      { name: "Baseline", result: fullResult },
      [{ name: "Alt", result: altResult }],
      [baseDelta]
    );

    expect(data.warnings).toHaveLength(0);
  });

  it("includes full result data in baseline", () => {
    const data = exportToJson(
      "Test",
      { name: "Baseline", result: fullResult },
      [],
      []
    );

    expect(data.baseline.result.annualKwh).toBe(11000);
    expect(data.baseline.result.monthlyKwh).toHaveLength(12);
    expect(data.baseline.result.panelCount).toBe(20);
  });
});

// ── PDF Tests ───────────────────────────────────────────────

describe("PDF Export", () => {
  it("generates valid HTML document", () => {
    const html = generatePdfHtml(
      "Test Project",
      { name: "Baseline", result: fullResult },
      [{ name: "Alt", result: altResult }],
      [baseDelta]
    );

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html).toContain("Test Project");
  });

  it("includes summary table with all rows", () => {
    const html = generatePdfHtml(
      "Test",
      { name: "Baseline", result: fullResult },
      [{ name: "Alt", result: altResult }],
      [baseDelta]
    );

    expect(html).toContain("Baseline");
    expect(html).toContain("Alt");
    expect(html).toContain("Summary");
  });

  it("includes quality badges", () => {
    const html = generatePdfHtml(
      "Test",
      { name: "Baseline", result: fullResult },
      [{ name: "QE", result: qeResult }],
      [mixedDelta]
    );

    expect(html).toContain("badge-full");
    expect(html).toContain("badge-qe");
    expect(html).toContain("Full");
    expect(html).toContain("QE");
  });

  it("shows mixed-quality warning when applicable", () => {
    const html = generatePdfHtml(
      "Test",
      { name: "Baseline", result: fullResult },
      [{ name: "QE", result: qeResult }],
      [mixedDelta]
    );

    expect(html).toContain("warning");
    expect(html).toContain("Quick Estimate");
  });

  it("hides mixed-quality warning when all same quality", () => {
    const html = generatePdfHtml(
      "Test",
      { name: "Baseline", result: fullResult },
      [{ name: "Alt", result: altResult }],
      [baseDelta]
    );

    // Should not contain the warning div
    expect(html).not.toContain("class=\"warning\"");
  });

  it("includes monthly production table", () => {
    const html = generatePdfHtml(
      "Test",
      { name: "Baseline", result: fullResult },
      [],
      []
    );

    expect(html).toContain("Monthly Production");
    expect(html).toContain("Jan");
    expect(html).toContain("Dec");
  });

  it("includes delta values with positive/negative styling", () => {
    // Delta scenarioName must match the scenario entry name
    const matchingDelta = { ...baseDelta, scenarioName: "Alt" };
    const html = generatePdfHtml(
      "Test",
      { name: "Baseline", result: fullResult },
      [{ name: "Alt", result: altResult }],
      [matchingDelta]
    );

    expect(html).toContain("delta-pos");
    expect(html).toMatch(/delta-pos">\+/);
  });

  it("shows dash for baseline delta columns", () => {
    const matchingDelta = { ...baseDelta, scenarioName: "Alt" };
    const html = generatePdfHtml(
      "Test",
      { name: "Baseline", result: fullResult },
      [{ name: "Alt", result: altResult }],
      [matchingDelta]
    );

    expect(html).toContain("&mdash;");
  });

  it("escapes HTML in project name", () => {
    const html = generatePdfHtml(
      "<script>alert(1)</script>",
      { name: "Baseline", result: fullResult },
      [],
      []
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes print-optimized styles", () => {
    const html = generatePdfHtml(
      "Test",
      { name: "Baseline", result: fullResult },
      [],
      []
    );

    expect(html).toContain("@media print");
  });

  it("handles null mismatch with N/A", () => {
    const noMismatch: ScenarioResult = {
      ...fullResult,
      mismatchLossPct: null,
    };

    const html = generatePdfHtml(
      "Test",
      { name: "Baseline", result: noMismatch },
      [],
      []
    );

    expect(html).toContain("N/A");
  });
});

// ── Cross-Export Consistency ────────────────────────────────

describe("Cross-export consistency", () => {
  it("CSV and JSON agree on quality values", () => {
    const csv = exportToCsv(
      { name: "Baseline", result: fullResult },
      [{ name: "QE", result: qeResult }]
    );
    const json = exportToJson(
      "Test",
      { name: "Baseline", result: fullResult },
      [{ name: "QE", result: qeResult }],
      [mixedDelta]
    );

    // CSV contains "full" and "quick_estimate"
    expect(csv).toContain("full");
    expect(csv).toContain("quick_estimate");

    // JSON has matching quality fields
    expect(json.baseline.quality).toBe("full");
    expect(json.scenarios[0].quality).toBe("quick_estimate");
  });

  it("all exports include the same number of scenarios", () => {
    const scenarios = [
      { name: "Alt 1", result: altResult },
      { name: "Alt 2", result: qeResult },
    ];

    const csv = exportToCsv(
      { name: "Baseline", result: fullResult },
      scenarios
    );
    const json = exportToJson(
      "Test",
      { name: "Baseline", result: fullResult },
      scenarios,
      [baseDelta, mixedDelta]
    );
    const html = generatePdfHtml(
      "Test",
      { name: "Baseline", result: fullResult },
      scenarios,
      [baseDelta, mixedDelta]
    );

    // CSV: header + baseline + 2 scenarios = 4 lines
    expect(csv.split("\n")).toHaveLength(4);
    // JSON: 2 scenarios
    expect(json.scenarios).toHaveLength(2);
    // HTML contains both scenario names
    expect(html).toContain("Alt 1");
    expect(html).toContain("Alt 2");
  });
});
