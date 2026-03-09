/**
 * Solar Engine — Adapter Unit Tests
 *
 * Tests for project-to-worker and worker-to-ui adapters.
 * Validates Quick Estimate generation [B1], equipment resolution,
 * and null-safe result mapping [P1-F3].
 */

import {
  buildWorkerPayload,
  DesignDataRequired,
  type ProjectForAdapter,
  type WeatherDataForAdapter,
} from "@/lib/solar/adapters/project-to-worker";
import {
  mapWorkerResultToUI,
  formatKwh,
  formatPercent,
} from "@/lib/solar/adapters/worker-to-ui";
import type { WorkerResultMessage } from "@/lib/solar/types";

// ── Fixtures ────────────────────────────────────────────────

const weatherData: WeatherDataForAdapter = {
  ghi: Array(8760).fill(500),
  temperature: Array(8760).fill(25),
};

const wizardOnlyProject: ProjectForAdapter = {
  equipmentConfig: {
    panelKey: "REC_Alpha_Pure_440",
    inverterKey: "Tesla_Inverter_7_6",
    essKey: "None",
    optimizerKey: null,
    source: "wizard_v1",
  },
  stringsConfig: null,
  panelStats: null,
  siteConditions: { groundAlbedo: 0.2 },
  lossProfile: { soiling: 3.0 },
};

const fullDesignProject: ProjectForAdapter = {
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
    strings: [{ panels: [0, 1, 2, 3] }, { panels: [4, 5, 6, 7] }],
    inverters: [{ inverterKey: "Tesla_Inverter_7_6", stringIndices: [0, 1] }],
  },
  panelStats: Array.from({ length: 8 }, (_, i) => ({
    tsrf: 0.85,
    panelKey: "REC_Alpha_Pure_440",
    segmentIndex: 0,
  })),
  siteConditions: { groundAlbedo: 0.25 },
  lossProfile: { soiling: 2.5 },
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
};

const batteryProject: ProjectForAdapter = {
  equipmentConfig: {
    panelKey: "REC_Alpha_Pure_440",
    inverterKey: "Tesla_Inverter_7_6",
    essKey: "Tesla_PW3",
    optimizerKey: null,
  },
  stringsConfig: null,
  panelStats: null,
};

// ── project-to-worker tests ─────────────────────────────────

describe("buildWorkerPayload", () => {
  describe("Quick Estimate mode [B1]", () => {
    it("generates quick estimate when no design data exists", () => {
      const { payload, isQuickEstimate } = buildWorkerPayload(
        wizardOnlyProject,
        weatherData
      );

      expect(isQuickEstimate).toBe(true);
      expect(payload.panelStats.length).toBeGreaterThan(0);
      // All panels should have default TSRF=0.80
      for (const panel of payload.panelStats) {
        expect(panel.tsrf).toBe(0.8);
      }
    });

    it("derives panel count from inverter capacity", () => {
      const { payload } = buildWorkerPayload(wizardOnlyProject, weatherData);

      // Tesla 7.6kW: dcMax=11400, panel=440W → ~26 panels, but capped at 2×DC/AC
      // 2 × 7600/440 ≈ 35 → raw 26 < 35, so rawCount wins
      const expectedCount = Math.round(11400 / 440);
      expect(payload.panelStats.length).toBe(expectedCount);
    });

    it("generates uniform strings across channels", () => {
      const { payload } = buildWorkerPayload(wizardOnlyProject, weatherData);

      const sc = payload.stringsConfig as { strings: Array<{ panels: number[] }> };
      expect(sc.strings.length).toBeGreaterThan(0);

      // Tesla_Inverter_7_6 has 4 channels
      expect(sc.strings.length).toBeLessThanOrEqual(4);

      // All panels should be assigned
      const allPanels = sc.strings.flatMap((s) => s.panels);
      expect(allPanels.length).toBe(payload.panelStats.length);
    });

    it("generates 1-panel-per-string for micro inverter", () => {
      const { payload } = buildWorkerPayload(microProject, weatherData);

      const sc = payload.stringsConfig as { strings: Array<{ panels: number[] }> };
      for (const s of sc.strings) {
        expect(s.panels.length).toBe(1);
      }
    });
  });

  describe("Full design data mode", () => {
    it("uses design data when present", () => {
      const { payload, isQuickEstimate } = buildWorkerPayload(
        fullDesignProject,
        weatherData
      );

      expect(isQuickEstimate).toBe(false);
      expect(payload.panelStats.length).toBe(8);
      expect(payload.panelStats[0].tsrf).toBe(0.85);
    });

    it("passes through stringsConfig from project", () => {
      const { payload } = buildWorkerPayload(fullDesignProject, weatherData);

      const sc = payload.stringsConfig as { strings: Array<{ panels: number[] }> };
      expect(sc.strings).toHaveLength(2);
      expect(sc.strings[0].panels).toEqual([0, 1, 2, 3]);
    });
  });

  describe("Equipment resolution", () => {
    it("resolves panel specs from catalog", () => {
      const { payload } = buildWorkerPayload(wizardOnlyProject, weatherData);

      const eq = payload.equipmentConfig as Record<string, unknown>;
      const resolved = eq.resolvedPanels as Record<string, unknown>;
      expect(resolved).toHaveProperty("REC_Alpha_Pure_440");

      const panel = resolved.REC_Alpha_Pure_440 as Record<string, unknown>;
      expect(panel.watts).toBe(440);
      expect(panel.voc).toBe(48.4);
    });

    it("resolves inverter specs from catalog", () => {
      const { payload } = buildWorkerPayload(wizardOnlyProject, weatherData);

      const eq = payload.equipmentConfig as Record<string, unknown>;
      const resolved = eq.resolvedInverters as Record<string, unknown>;
      expect(resolved).toHaveProperty("Tesla_Inverter_7_6");

      const inv = resolved.Tesla_Inverter_7_6 as Record<string, unknown>;
      expect(inv.acPower).toBe(7600);
      expect(inv.architectureType).toBe("string");
    });

    it("sets architectureType from inverter", () => {
      const { payload } = buildWorkerPayload(microProject, weatherData);

      const eq = payload.equipmentConfig as Record<string, unknown>;
      expect(eq.architectureType).toBe("micro");
    });
  });

  describe("Battery config", () => {
    it("embeds battery config in stringsConfig inverters when ESS is selected", () => {
      const { payload } = buildWorkerPayload(batteryProject, weatherData);

      // Battery config is embedded in each inverter entry (not top-level)
      const sc = payload.stringsConfig as any;
      expect(sc.inverters).toBeDefined();
      expect(sc.inverters.length).toBeGreaterThan(0);

      const bc = sc.inverters[0].batteryConfig;
      expect(bc).toBeDefined();
      expect(bc.essKey).toBe("Tesla_PW3");
      expect(bc.totalCapacityWh).toBe(13500); // 13.5 kWh × 1000
      expect(bc.roundTrip).toBe(0.92);
    });

    it("omits battery config from inverters when ESS is None", () => {
      const { payload } = buildWorkerPayload(wizardOnlyProject, weatherData);

      const sc = payload.stringsConfig as any;
      if (sc.inverters?.length > 0) {
        expect(sc.inverters[0].batteryConfig).toBeUndefined();
      }
    });
  });

  describe("Error handling", () => {
    it("throws DesignDataRequired when no equipmentConfig", () => {
      expect(() =>
        buildWorkerPayload({ equipmentConfig: null }, weatherData)
      ).toThrow(DesignDataRequired);
    });

    it("throws DesignDataRequired when panelKey is missing", () => {
      expect(() =>
        buildWorkerPayload(
          { equipmentConfig: { inverterKey: "Tesla_Inverter_7_6" } },
          weatherData
        )
      ).toThrow(DesignDataRequired);
    });

    it("throws DesignDataRequired when inverterKey is missing", () => {
      expect(() =>
        buildWorkerPayload(
          { equipmentConfig: { panelKey: "REC_Alpha_Pure_440" } },
          weatherData
        )
      ).toThrow(DesignDataRequired);
    });

    it("throws for unknown panel key", () => {
      expect(() =>
        buildWorkerPayload(
          {
            equipmentConfig: {
              panelKey: "Unknown_Panel",
              inverterKey: "Tesla_Inverter_7_6",
            },
          },
          weatherData
        )
      ).toThrow(DesignDataRequired);
    });
  });

  describe("Weather data", () => {
    it("passes through weather data", () => {
      const { payload } = buildWorkerPayload(wizardOnlyProject, weatherData);

      expect(payload.weatherData.ghi.length).toBe(8760);
    });

    it("uses empty arrays when no weather data", () => {
      const { payload } = buildWorkerPayload(wizardOnlyProject, null);

      expect(payload.weatherData.ghi.length).toBe(0);
      expect(payload.weatherData.temperature.length).toBe(0);
    });
  });

  describe("Site conditions passthrough", () => {
    it("passes through loss profile", () => {
      const { payload } = buildWorkerPayload(wizardOnlyProject, weatherData);

      const lp = payload.lossProfile as Record<string, unknown>;
      expect(lp.soiling).toBe(3.0);
    });

    it("passes through ground albedo", () => {
      const { payload } = buildWorkerPayload(fullDesignProject, weatherData);

      const sc = payload.siteConditions as Record<string, unknown>;
      expect(sc.groundAlbedo).toBe(0.25);
    });
  });
});

// ── worker-to-ui tests ──────────────────────────────────────

describe("mapWorkerResultToUI", () => {
  const baseResult: WorkerResultMessage["payload"] = {
    schemaVersion: 1,
    modelA: { annualKwh: 5000, monthlyKwh: Array(12).fill(416.67) },
    modelB: {
      annualKwh: 4800,
      monthlyKwh: Array(12).fill(400),
      mismatchLossPct: 4.0,
    },
    dispatch: {
      energyBalance: {
        totalProductionKwh: 5000,
        selfConsumedKwh: 3000,
        gridExportKwh: 2000,
        gridImportKwh: 1000,
        batteryChargedKwh: 500,
        batteryDischargedKwh: 480,
        batteryLossesKwh: 20,
        curtailedKwh: 0,
        clippedKwh: 50,
        deltaStoredKwh: 0,
      },
      clippingLossPct: 1.0,
      curtailedKwh: 0,
    },
    panelCount: 12,
    systemSizeKw: 5.28,
    systemTsrf: 0.85,
    specificYield: 946,
  };

  it("maps all fields from full result", () => {
    const result = mapWorkerResultToUI(baseResult, false);

    expect(result.schemaVersion).toBe(1);
    expect(result.panelCount).toBe(12);
    expect(result.systemSizeKw).toBe(5.28);
    expect(result.annualKwh).toBe(5000);
    expect(result.monthlyKwh).toHaveLength(12);
    expect(result.mismatchLossPct).toBe(4.0);
    expect(result.modelBAnnualKwh).toBe(4800);
    expect(result.clippingLossPct).toBe(1.0);
    expect(result.hasBattery).toBe(true);
    expect(result.isQuickEstimate).toBe(false);
  });

  it("handles null modelB for micro architecture [P1-F3]", () => {
    const microResult: WorkerResultMessage["payload"] = {
      ...baseResult,
      modelB: null,
    };
    const result = mapWorkerResultToUI(microResult, false);

    expect(result.mismatchLossPct).toBeNull();
    expect(result.modelBAnnualKwh).toBeNull();
  });

  it("handles missing dispatch", () => {
    const noDispatch: WorkerResultMessage["payload"] = {
      ...baseResult,
      dispatch: undefined,
    };
    const result = mapWorkerResultToUI(noDispatch, false);

    expect(result.energyBalance).toBeNull();
    expect(result.clippingLossPct).toBeNull();
    expect(result.curtailedKwh).toBeNull();
    expect(result.hasBattery).toBe(false);
  });

  it("propagates isQuickEstimate flag", () => {
    const result = mapWorkerResultToUI(baseResult, true);
    expect(result.isQuickEstimate).toBe(true);
  });

  it("detects battery from energy balance", () => {
    const noBattery: WorkerResultMessage["payload"] = {
      ...baseResult,
      dispatch: {
        ...baseResult.dispatch!,
        energyBalance: {
          ...baseResult.dispatch!.energyBalance,
          batteryChargedKwh: 0,
          batteryDischargedKwh: 0,
          batteryLossesKwh: 0,
        },
      },
    };
    const result = mapWorkerResultToUI(noBattery, false);
    expect(result.hasBattery).toBe(false);
  });
});

// ── Formatting helpers ──────────────────────────────────────

describe("formatKwh", () => {
  it("formats zero", () => expect(formatKwh(0)).toBe("0 kWh"));
  it("formats small values as Wh", () => expect(formatKwh(0.5)).toBe("500 Wh"));
  it("formats medium values with decimal", () =>
    expect(formatKwh(42.3)).toBe("42.3 kWh"));
  it("formats large values with commas", () =>
    expect(formatKwh(5280)).toBe("5,280 kWh"));
});

describe("formatPercent", () => {
  it("formats null as N/A", () => expect(formatPercent(null)).toBe("N/A"));
  it("formats number with one decimal", () =>
    expect(formatPercent(4.567)).toBe("4.6%"));
});
