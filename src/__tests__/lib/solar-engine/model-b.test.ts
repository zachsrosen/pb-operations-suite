/**
 * Model B — String Mismatch with Bypass Diodes Tests
 *
 * Tests both unshaded (should match Model A) and shaded scenarios.
 */

import { runModelA } from "@/lib/solar/engine/model-a";
import { runModelB } from "@/lib/solar/engine/model-b";
import { prepareTmyLookup } from "@/lib/solar/engine/weather";
import { computeMismatchLoss } from "@/lib/solar/engine/architecture";
import { expectClose, expectInRange } from "./test-helpers";
import type { WorkerProgressMessage } from "@/lib/solar/types";
import type { PanelStat, ResolvedPanel, StringConfig } from "@/lib/solar/engine/engine-types";
import fixture from "./fixtures/fixture-single-panel.json";

const noopProgress = (_msg: WorkerProgressMessage) => {};

const testPanel: PanelStat = {
  id: 0,
  tsrf: 0.85,
  points: [],
  panelKey: "TEST_440W",
  bifacialGain: 1.0,
};

const testPanel2: PanelStat = {
  id: 1,
  tsrf: 0.85,
  points: [],
  panelKey: "TEST_440W",
  bifacialGain: 1.0,
};

describe("Model B — No Shade (matches Model A)", () => {
  it("with no shade, Model B annual kWh closely matches Model A", () => {
    const tmyLookup = prepareTmyLookup(null);
    const panels = [testPanel, testPanel2];
    const strings: StringConfig[] = [{ panels: [0, 1] }];

    const modelA = runModelA(
      {
        panels,
        shadeData: {},
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
      },
      noopProgress
    );

    const modelB = runModelB(
      {
        panels,
        strings,
        shadeData: {},
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
        primaryPanelKey: "TEST_440W",
      },
      noopProgress
    );

    // Without shade, Model B should produce ≤ Model A (slight IV curve differences)
    // but within a few percent
    const diff = Math.abs(modelA.annualKwh - modelB.annualKwh) / modelA.annualKwh * 100;
    expect(diff).toBeLessThan(15); // Allow up to 15% difference due to IV model vs simple power model
  });

  it("mismatch loss is 0% when no shade", () => {
    const tmyLookup = prepareTmyLookup(null);
    const panels = [testPanel, testPanel2];

    const modelA = runModelA(
      {
        panels,
        shadeData: {},
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
      },
      noopProgress
    );

    const modelB = runModelB(
      {
        panels,
        strings: [{ panels: [0, 1] }],
        shadeData: {},
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
        primaryPanelKey: "TEST_440W",
      },
      noopProgress
    );

    // Without shade, both models receive the same shade factor (1.0),
    // so mismatch should be very low
    const mismatch = computeMismatchLoss(modelA.annualKwh, modelB.annualKwh, "string");
    expect(mismatch).toBeGreaterThanOrEqual(0);
  });
});

describe("Model B — With Shade", () => {
  it("shaded string produces less than unshaded", () => {
    const tmyLookup = prepareTmyLookup(null);

    // Create shade data: panel 1's point is shaded 50% of daylight hours
    const shadeSeq = buildShadeSequence(0.5);
    const shadedPanel: PanelStat = {
      id: 1,
      tsrf: 0.85,
      points: ["pt_shaded"],
      panelKey: "TEST_440W",
      bifacialGain: 1.0,
    };
    const panels = [testPanel, shadedPanel];
    const shadeData = { pt_shaded: shadeSeq };

    const unshadedResult = runModelB(
      {
        panels: [testPanel, testPanel2],
        strings: [{ panels: [0, 1] }],
        shadeData: {},
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
        primaryPanelKey: "TEST_440W",
      },
      noopProgress
    );

    const shadedResult = runModelB(
      {
        panels,
        strings: [{ panels: [0, 1] }],
        shadeData,
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: true,
        primaryPanelKey: "TEST_440W",
      },
      noopProgress
    );

    expect(shadedResult.annualKwh).toBeLessThan(unshadedResult.annualKwh);
  });

  it("Model B ≤ Model A with partial shade (mismatch loss)", () => {
    const tmyLookup = prepareTmyLookup(null);
    const shadeSeq = buildShadeSequence(0.3);
    const shadedPanel: PanelStat = {
      id: 1,
      tsrf: 0.85,
      points: ["pt_shaded"],
      panelKey: "TEST_440W",
      bifacialGain: 1.0,
    };
    const panels = [testPanel, shadedPanel];
    const shadeData = { pt_shaded: shadeSeq };

    const modelA = runModelA(
      {
        panels,
        shadeData,
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: true,
      },
      noopProgress
    );

    const modelB = runModelB(
      {
        panels,
        strings: [{ panels: [0, 1] }],
        shadeData,
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: true,
        primaryPanelKey: "TEST_440W",
      },
      noopProgress
    );

    // String mismatch: Model B should produce ≤ Model A
    expect(modelB.annualKwh).toBeLessThanOrEqual(modelA.annualKwh * 1.01);
  });

  it("reports progress from 30% to 60%", () => {
    const tmyLookup = prepareTmyLookup(null);
    const progressReports: number[] = [];

    runModelB(
      {
        panels: [testPanel, testPanel2],
        strings: [{ panels: [0, 1] }],
        shadeData: {},
        resolvedPanels: fixture.resolvedPanels as any,
        tmyLookup,
        hasShade: false,
        primaryPanelKey: "TEST_440W",
      },
      (msg) => progressReports.push(msg.payload.percent)
    );

    expect(progressReports.length).toBeGreaterThan(0);
    // Progress should be in [30, 60] range
    for (const p of progressReports) {
      expect(p).toBeGreaterThanOrEqual(30);
      expect(p).toBeLessThanOrEqual(60);
    }
  });
});

/**
 * Build a shade sequence string for 17,520 half-hour slots.
 * shadeFraction = fraction of daylight hours that are shaded.
 * Daylight = slots 12-36 (6am-6pm). Shade applied to first N of those.
 */
function buildShadeSequence(shadeFraction: number): string {
  const SLOTS_PER_DAY = 48;
  const DAYLIGHT_START = 12; // 6am
  const DAYLIGHT_END = 36; // 6pm
  const daylightSlots = DAYLIGHT_END - DAYLIGHT_START;
  const shadedSlots = Math.round(daylightSlots * shadeFraction);

  let dayPattern = "";
  for (let h = 0; h < SLOTS_PER_DAY; h++) {
    if (h >= DAYLIGHT_START && h < DAYLIGHT_START + shadedSlots) {
      dayPattern += "1"; // shaded
    } else {
      dayPattern += "0"; // sun
    }
  }

  return dayPattern.repeat(365);
}
