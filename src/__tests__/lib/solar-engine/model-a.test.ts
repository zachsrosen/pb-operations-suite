/**
 * Model A — Independent Panel Timeseries Tests
 *
 * Golden-master fixture tests with frozen inputs and numeric assertions.
 */

import { runModelA } from "@/lib/solar/engine/model-a";
import { prepareTmyLookup } from "@/lib/solar/engine/weather";
import { TIMESTEPS } from "@/lib/solar/engine/constants";
import { expectInRange, expectClose } from "./test-helpers";
import type { WorkerProgressMessage } from "@/lib/solar/types";
import fixture from "./fixtures/fixture-single-panel.json";

const noopProgress = (_msg: WorkerProgressMessage) => {};

describe("Model A — runModelA", () => {
  it("produces annual output in expected range for 440W panel (synthetic weather)", () => {
    const tmyLookup = prepareTmyLookup(null); // synthetic weather

    const result = runModelA(
      {
        panels: fixture.panels as any,
        shadeData: fixture.shadeData,
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
      },
      noopProgress
    );

    // 440W panel with TSRF 0.85, synthetic weather → reasonable annual range
    expectInRange(result.annualKwh, 300, 1000, "Model A annual kWh");
  });

  it("produces 12 monthly values that sum close to annual", () => {
    const tmyLookup = prepareTmyLookup(null);
    const result = runModelA(
      {
        panels: fixture.panels as any,
        shadeData: fixture.shadeData,
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
      },
      noopProgress
    );

    expect(result.monthlyKwh).toHaveLength(12);
    const monthlySum = result.monthlyKwh.reduce((a, b) => a + b, 0);
    expectClose(monthlySum, result.annualKwh, 0.01, "monthly sum vs annual");
  });

  it("summer months produce more than winter months", () => {
    const tmyLookup = prepareTmyLookup(null);
    const result = runModelA(
      {
        panels: fixture.panels as any,
        shadeData: fixture.shadeData,
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
      },
      noopProgress
    );

    // June (index 5) and July (index 6) should be > December (index 11) and January (index 0)
    const summerAvg = (result.monthlyKwh[5] + result.monthlyKwh[6]) / 2;
    const winterAvg = (result.monthlyKwh[0] + result.monthlyKwh[11]) / 2;
    expect(summerAvg).toBeGreaterThan(winterAvg);
  });

  it("returns one panelTimeseries per panel", () => {
    const tmyLookup = prepareTmyLookup(null);
    const result = runModelA(
      {
        panels: fixture.panels as any,
        shadeData: fixture.shadeData,
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
      },
      noopProgress
    );

    expect(result.panelTimeseries).toHaveLength(1);
    expect(result.panelTimeseries[0]).toHaveLength(TIMESTEPS);
  });

  it("scales linearly with panel count", () => {
    const tmyLookup = prepareTmyLookup(null);
    const panel = fixture.panels[0] as any;

    const singleResult = runModelA(
      {
        panels: [panel],
        shadeData: {},
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
      },
      noopProgress
    );

    const doubleResult = runModelA(
      {
        panels: [
          { ...panel, id: 0 },
          { ...panel, id: 1 },
        ],
        shadeData: {},
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
      },
      noopProgress
    );

    expectClose(
      doubleResult.annualKwh,
      singleResult.annualKwh * 2,
      0.01,
      "double panel output"
    );
  });

  it("reports progress from 0% to 30%", () => {
    const tmyLookup = prepareTmyLookup(null);
    const progressReports: number[] = [];

    runModelA(
      {
        panels: fixture.panels as any,
        shadeData: fixture.shadeData,
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
      },
      (msg) => progressReports.push(msg.payload.percent)
    );

    expect(progressReports.length).toBeGreaterThan(0);
    expect(progressReports[progressReports.length - 1]).toBe(30);
  });

  it("all timeseries values are non-negative", () => {
    const tmyLookup = prepareTmyLookup(null);
    const result = runModelA(
      {
        panels: fixture.panels as any,
        shadeData: fixture.shadeData,
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
      },
      noopProgress
    );

    for (const series of result.panelTimeseries) {
      for (let t = 0; t < TIMESTEPS; t++) {
        expect(series[t]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("Model A — Bifacial (F7)", () => {
  it("bifacial panel produces more than non-bifacial equivalent", () => {
    const tmyLookup = prepareTmyLookup(null);
    const panel = fixture.panels[0] as any;

    // Non-bifacial
    const nonBifacialResult = runModelA(
      {
        panels: [{ ...panel, bifacialGain: 1.0 }],
        shadeData: {},
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
      },
      noopProgress
    );

    // Bifacial with ~7% gain
    const bifacialResult = runModelA(
      {
        panels: [{ ...panel, bifacialGain: 1.07 }],
        shadeData: {},
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
      },
      noopProgress
    );

    // Bifacial should produce ~7% more
    expect(bifacialResult.annualKwh).toBeGreaterThan(nonBifacialResult.annualKwh);
    const gainPct =
      ((bifacialResult.annualKwh - nonBifacialResult.annualKwh) /
        nonBifacialResult.annualKwh) *
      100;
    expectInRange(gainPct, 5, 10, "bifacial gain percentage");
  });
});
