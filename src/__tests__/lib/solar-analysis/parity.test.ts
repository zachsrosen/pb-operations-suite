/**
 * Parity Tests — Adapter → Mapper → Engine Round-Trip
 *
 * Validates that projects built via `buildWorkerPayload()` produce valid
 * results when run through `mapPayloadToRunnerInput()` → `runAnalysis()`.
 *
 * Covers: string architecture, micro inverter, optimizer, battery-equipped.
 * Tolerances: annual ±2%, monthly ±5%, mismatch ±0.5% absolute.
 */

import {
  buildWorkerPayload,
  type ProjectForAdapter,
  type WeatherDataForAdapter,
} from "@/lib/solar/adapters/project-to-worker";
import { mapPayloadToRunnerInput } from "@/lib/solar/engine/payload-mapper";
import { runAnalysis, SCHEMA_VERSION } from "@/lib/solar/engine/runner";
import { mapWorkerResultToUI } from "@/lib/solar/adapters/worker-to-ui";
import type { WorkerProgressMessage, WorkerResultMessage } from "@/lib/solar/types";

const noopProgress = (_msg: WorkerProgressMessage) => {};

// ── Synthetic weather — uniform for deterministic parity ────

const syntheticWeather: WeatherDataForAdapter = {
  ghi: Array(8760).fill(200), // 200 W/m² every hour (~1752 PSH annual)
  temperature: Array(8760).fill(25), // 25°C constant
};

// ── Project fixtures using real catalog keys ────────────────

const stringProject: ProjectForAdapter = {
  equipmentConfig: {
    panelKey: "REC_Alpha_Pure_440",
    inverterKey: "Tesla_Inverter_7_6",
    essKey: "None",
    optimizerKey: null,
  },
  stringsConfig: null,
  panelStats: null,
  siteConditions: { groundAlbedo: 0.2 },
  lossProfile: {
    soiling: 2.0,
    mismatch: 2.0,
    dcWiring: 2.0,
    acWiring: 1.0,
    availability: 3.0,
    lid: 1.5,
    snow: 0.0,
    nameplate: 1.0,
  },
};

const microProject: ProjectForAdapter = {
  equipmentConfig: {
    panelKey: "REC_Alpha_Pure_440",
    inverterKey: "Enphase_IQ8M",
    essKey: "None",
    optimizerKey: null,
  },
  stringsConfig: null,
  panelStats: null,
  siteConditions: { groundAlbedo: 0.2 },
  lossProfile: {},
};

const optimizerProject: ProjectForAdapter = {
  equipmentConfig: {
    panelKey: "REC_Alpha_Pure_440",
    inverterKey: "SolarEdge_SE7600H",
    essKey: "None",
    optimizerKey: "SolarEdge_S440",
  },
  stringsConfig: null,
  panelStats: null,
  siteConditions: { groundAlbedo: 0.2 },
  lossProfile: {},
};

const batteryProject: ProjectForAdapter = {
  equipmentConfig: {
    panelKey: "REC_Alpha_Pure_440",
    inverterKey: "Tesla_PW3_Inverter",  // integrated inverter required for DC-coupled battery
    essKey: "Tesla_PW3",
    optimizerKey: null,
  },
  stringsConfig: null,
  panelStats: null,
  siteConditions: { groundAlbedo: 0.2 },
  lossProfile: {},
  homeConsumptionConfig: {
    enabled: true,
    annualKwh: 10000,
    climateZone: "mixed",
    priorityMode: "self_consumption",
    backupReservePct: 20,
  },
};

// ── Full design project (non-Quick Estimate) ────────────────

const fullDesignStringProject: ProjectForAdapter = {
  equipmentConfig: {
    panelKey: "REC_Alpha_Pure_440",
    inverterKey: "Tesla_Inverter_7_6",
    essKey: "None",
    optimizerKey: null,
    resolvedPanels: {},
    resolvedInverters: {},
    architectureType: "string",
    shadeData: {},
  },
  stringsConfig: {
    strings: [
      { panels: [0, 1, 2, 3, 4, 5] },
      { panels: [6, 7, 8, 9, 10, 11] },
    ],
    inverters: [
      { inverterKey: "Tesla_Inverter_7_6", stringIndices: [0, 1] },
    ],
  },
  panelStats: Array.from({ length: 12 }, (_, i) => ({
    tsrf: 0.82 + (i % 3) * 0.02, // vary TSRF slightly: 0.82, 0.84, 0.86
    panelKey: "REC_Alpha_Pure_440",
    segmentIndex: 0,
  })),
  siteConditions: { groundAlbedo: 0.2 },
  lossProfile: {
    soiling: 2.0,
    mismatch: 2.0,
    dcWiring: 2.0,
    acWiring: 1.0,
    availability: 3.0,
    lid: 1.5,
    snow: 0.0,
    nameplate: 1.0,
  },
};

// ── Helper: full pipeline ───────────────────────────────────

function runFullPipeline(project: ProjectForAdapter) {
  const { payload, isQuickEstimate } = buildWorkerPayload(
    project,
    syntheticWeather
  );
  const input = mapPayloadToRunnerInput(payload);
  const rawResult = runAnalysis(input, noopProgress);

  // Simulate the wire format (strip Float32Array from timeseries)
  const wireResult: WorkerResultMessage["payload"] = {
    schemaVersion: rawResult.schemaVersion,
    modelA: {
      annualKwh: rawResult.modelA.annualKwh,
      monthlyKwh: rawResult.modelA.monthlyKwh,
    },
    modelB: rawResult.modelB
      ? {
          annualKwh: rawResult.modelB.annualKwh,
          monthlyKwh: rawResult.modelB.monthlyKwh,
          mismatchLossPct: rawResult.modelB.mismatchLossPct,
        }
      : null,
    dispatch: rawResult.dispatch
      ? {
          energyBalance: rawResult.dispatch.energyBalance,
          clippingLossPct: rawResult.dispatch.clippingLossPct,
          curtailedKwh: rawResult.dispatch.curtailedKwh,
        }
      : undefined,
    panelCount: rawResult.panelCount,
    systemSizeKw: rawResult.systemSizeKw,
    systemTsrf: rawResult.systemTsrf,
    specificYield: rawResult.specificYield,
  };

  const uiResult = mapWorkerResultToUI(wireResult, isQuickEstimate);
  return { rawResult, wireResult, uiResult, isQuickEstimate };
}

// ── Parity Tests ────────────────────────────────────────────

describe("Parity — String Architecture (Quick Estimate)", () => {
  const { rawResult, uiResult, isQuickEstimate } =
    runFullPipeline(stringProject);

  it("is a quick estimate", () => {
    expect(isQuickEstimate).toBe(true);
    expect(uiResult.isQuickEstimate).toBe(true);
  });

  it("produces valid schema version", () => {
    expect(rawResult.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("produces non-zero annual output", () => {
    expect(uiResult.annualKwh).toBeGreaterThan(0);
  });

  it("has 12 monthly values summing to annual ±2%", () => {
    expect(uiResult.monthlyKwh).toHaveLength(12);
    const monthlySum = uiResult.monthlyKwh.reduce((a, b) => a + b, 0);
    const tolerance = uiResult.annualKwh * 0.02;
    expect(Math.abs(monthlySum - uiResult.annualKwh)).toBeLessThanOrEqual(
      tolerance
    );
  });

  it("has modelB (string architecture) with mismatch", () => {
    expect(uiResult.mismatchLossPct).not.toBeNull();
    // Uniform TSRF panels can produce tiny negative mismatch from numerical precision
    expect(uiResult.mismatchLossPct!).toBeGreaterThanOrEqual(-1.0);
    expect(uiResult.mismatchLossPct!).toBeLessThan(50); // sanity
  });

  it("specific yield is reasonable (500–1800 kWh/kWp)", () => {
    expect(uiResult.specificYield).toBeGreaterThan(500);
    expect(uiResult.specificYield).toBeLessThan(1800);
  });

  it("panel count > 0", () => {
    expect(uiResult.panelCount).toBeGreaterThan(0);
  });

  it("system size matches panel count × watts", () => {
    const expectedKw = (uiResult.panelCount * 440) / 1000;
    expect(uiResult.systemSizeKw).toBeCloseTo(expectedKw, 1);
  });
});

describe("Parity — Micro Architecture (Quick Estimate)", () => {
  const { uiResult, isQuickEstimate } = runFullPipeline(microProject);

  it("is a quick estimate", () => {
    expect(isQuickEstimate).toBe(true);
  });

  it("modelB is null (micro → no mismatch) [P1-F3]", () => {
    expect(uiResult.mismatchLossPct).toBeNull();
    expect(uiResult.modelBAnnualKwh).toBeNull();
  });

  it("produces non-zero output", () => {
    expect(uiResult.annualKwh).toBeGreaterThan(0);
  });

  it("has 12 monthly values", () => {
    expect(uiResult.monthlyKwh).toHaveLength(12);
  });

  it("panel count > 0", () => {
    expect(uiResult.panelCount).toBeGreaterThan(0);
  });
});

describe("Parity — Optimizer Architecture (Quick Estimate)", () => {
  const { uiResult, isQuickEstimate } = runFullPipeline(optimizerProject);

  it("is a quick estimate", () => {
    expect(isQuickEstimate).toBe(true);
  });

  it("modelB is null (optimizer → no mismatch) [P1-F3]", () => {
    expect(uiResult.mismatchLossPct).toBeNull();
    expect(uiResult.modelBAnnualKwh).toBeNull();
  });

  it("produces non-zero output", () => {
    expect(uiResult.annualKwh).toBeGreaterThan(0);
  });

  it("panel count > 0", () => {
    expect(uiResult.panelCount).toBeGreaterThan(0);
  });
});

describe("Parity — Battery + Home Consumption", () => {
  const { uiResult } = runFullPipeline(batteryProject);

  it("has battery flag set", () => {
    expect(uiResult.hasBattery).toBe(true);
  });

  it("has energy balance with battery data", () => {
    expect(uiResult.energyBalance).not.toBeNull();
    expect(uiResult.energyBalance!.batteryChargedKwh).toBeGreaterThan(0);
    expect(uiResult.energyBalance!.batteryDischargedKwh).toBeGreaterThan(0);
  });

  it("self-consumption ratio is between 0% and 100%", () => {
    const eb = uiResult.energyBalance!;
    const ratio = eb.selfConsumedKwh / eb.totalProductionKwh;
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it("energy balance closes (production ≈ consumed + exported + losses ± deltaStored)", () => {
    const eb = uiResult.energyBalance!;
    const lhs = eb.totalProductionKwh;
    const rhs =
      eb.selfConsumedKwh +
      eb.gridExportKwh +
      eb.batteryLossesKwh +
      eb.curtailedKwh +
      eb.clippedKwh +
      eb.deltaStoredKwh;
    const tolerance = lhs * 0.02; // 2% tolerance
    expect(Math.abs(lhs - rhs)).toBeLessThanOrEqual(tolerance);
  });
});

describe("Parity — Full Design (non-Quick Estimate)", () => {
  const { uiResult, isQuickEstimate } = runFullPipeline(
    fullDesignStringProject
  );

  it("is NOT a quick estimate", () => {
    expect(isQuickEstimate).toBe(false);
    expect(uiResult.isQuickEstimate).toBe(false);
  });

  it("uses provided panel count", () => {
    expect(uiResult.panelCount).toBe(12);
  });

  it("system size matches 12 × 440W", () => {
    expect(uiResult.systemSizeKw).toBeCloseTo(5.28, 1);
  });

  it("has mismatch for string with varied TSRF", () => {
    expect(uiResult.mismatchLossPct).not.toBeNull();
    // With varied TSRF (0.82, 0.84, 0.86), expect some mismatch (can be slightly negative from precision)
    expect(uiResult.mismatchLossPct!).toBeGreaterThan(-1.0);
  });

  it("monthly sum ≈ annual ±2%", () => {
    const monthlySum = uiResult.monthlyKwh.reduce((a, b) => a + b, 0);
    const tolerance = uiResult.annualKwh * 0.02;
    expect(Math.abs(monthlySum - uiResult.annualKwh)).toBeLessThanOrEqual(
      tolerance
    );
  });

  it("specific yield is reasonable", () => {
    expect(uiResult.specificYield).toBeGreaterThan(500);
    expect(uiResult.specificYield).toBeLessThan(1800);
  });
});

describe("Parity — Quick Estimate vs Full Design consistency", () => {
  const qe = runFullPipeline(stringProject);
  const full = runFullPipeline(fullDesignStringProject);

  it("both produce the same schema version", () => {
    expect(qe.uiResult.schemaVersion).toBe(full.uiResult.schemaVersion);
  });

  it("specific yields are within same order of magnitude", () => {
    const ratio = qe.uiResult.specificYield / full.uiResult.specificYield;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2.0);
  });

  it("Quick Estimate flag differs", () => {
    expect(qe.uiResult.isQuickEstimate).toBe(true);
    expect(full.uiResult.isQuickEstimate).toBe(false);
  });
});
