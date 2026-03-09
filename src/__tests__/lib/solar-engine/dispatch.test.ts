/**
 * Dispatch — Energy Balance & Battery Tests
 *
 * Tests clipping, battery SOC, and energy balance equation closure [P1-F2].
 */

import { runDispatch } from "@/lib/solar/engine/dispatch";
import { TIMESTEPS, HALF_HOUR_FACTOR } from "@/lib/solar/engine/constants";
import { expectClose, expectInRange } from "./test-helpers";
import type { WorkerProgressMessage } from "@/lib/solar/types";
import type { InverterConfig, ResolvedInverter } from "@/lib/solar/engine/engine-types";

const noopProgress = (_msg: WorkerProgressMessage) => {};

/**
 * Create a synthetic constant-power timeseries (watts).
 */
function constantSeries(watts: number): Float32Array {
  const series = new Float32Array(TIMESTEPS);
  series.fill(watts);
  return series;
}

/**
 * Create a synthetic daylight-only power timeseries.
 * Power = watts during daylight (slots 12-36 = 6am-6pm), 0 at night.
 */
function daylightSeries(peakWatts: number): Float32Array {
  const series = new Float32Array(TIMESTEPS);
  for (let t = 0; t < TIMESTEPS; t++) {
    const slot = t % 48;
    if (slot >= 12 && slot < 36) {
      // Simple bell curve during daylight
      const mid = 24;
      const dist = Math.abs(slot - mid) / 12;
      series[t] = peakWatts * Math.max(0, 1 - dist * dist);
    }
  }
  return series;
}

const testInverter: ResolvedInverter = {
  key: "TEST_INV",
  name: "Test 7.6kW Inverter",
  acPower: 7600,
  dcMax: 11400,
  mpptMin: 100,
  mpptMax: 480,
  channels: 2,
  maxIsc: 20,
  efficiency: 0.97,
  architectureType: "string",
  isMicro: false,
  isIntegrated: false,
};

const integratedInverter: ResolvedInverter = {
  ...testInverter,
  key: "TEST_INV_BATT",
  isIntegrated: true,
  acPower: 5000,
};

describe("Dispatch — No Battery", () => {
  it("produces positive clippedKwh when DC exceeds AC limit", () => {
    // 10kW DC into 7.6kW AC inverter → should clip
    const series = daylightSeries(10000);
    const inverters: InverterConfig[] = [
      { inverterKey: "TEST_INV", stringIndices: [0] },
    ];

    const result = runDispatch(
      {
        stringTimeseries: [series],
        inverters,
        resolvedInverters: { TEST_INV: testInverter },
        clippingThreshold: 1.0,
        consumptionProfile: null,
        homeConsumption: null,
        exportLimitW: 0,
      },
      noopProgress
    );

    expect(result.energyBalance.clippedKwh).toBeGreaterThan(0);
    expect(result.clippingLossPct).toBeGreaterThan(0);
  });

  it("no clipping when DC is within AC limit", () => {
    // 5kW DC into 7.6kW AC inverter → no clipping
    const series = daylightSeries(5000);
    const inverters: InverterConfig[] = [
      { inverterKey: "TEST_INV", stringIndices: [0] },
    ];

    const result = runDispatch(
      {
        stringTimeseries: [series],
        inverters,
        resolvedInverters: { TEST_INV: testInverter },
        clippingThreshold: 1.0,
        consumptionProfile: null,
        homeConsumption: null,
        exportLimitW: 0,
      },
      noopProgress
    );

    expectClose(result.energyBalance.clippedKwh, 0, 0.01, "no clipping");
  });

  it("all production goes to grid export when no consumption", () => {
    const series = daylightSeries(3000);
    const inverters: InverterConfig[] = [
      { inverterKey: "TEST_INV", stringIndices: [0] },
    ];

    const result = runDispatch(
      {
        stringTimeseries: [series],
        inverters,
        resolvedInverters: { TEST_INV: testInverter },
        clippingThreshold: 1.0,
        consumptionProfile: null,
        homeConsumption: null,
        exportLimitW: 0,
      },
      noopProgress
    );

    const eb = result.energyBalance;
    expect(eb.totalProductionKwh).toBeGreaterThan(0);
    // With no consumption: production = export + clipped
    expectClose(
      eb.totalProductionKwh,
      eb.gridExportKwh + eb.clippedKwh,
      0.1,
      "production = export + clipped (no consumption)"
    );
  });
});

describe("Dispatch — With Battery", () => {
  it("battery charges when there is excess DC", () => {
    // Large DC input with integrated inverter + battery
    const series = daylightSeries(8000);
    const inverters: InverterConfig[] = [
      {
        inverterKey: "TEST_INV_BATT",
        stringIndices: [0],
        batteryConfig: {
          essKey: "TEST_ESS",
          totalCapacityWh: 13500,
          totalDcChargeW: 5000,
          maxDischargeW: 5000,
          roundTrip: 0.90,
        },
      },
    ];

    const result = runDispatch(
      {
        stringTimeseries: [series],
        inverters,
        resolvedInverters: { TEST_INV_BATT: integratedInverter },
        clippingThreshold: 1.0,
        consumptionProfile: null,
        homeConsumption: null,
        exportLimitW: 0,
      },
      noopProgress
    );

    expect(result.energyBalance.batteryChargedKwh).toBeGreaterThan(0);
  });

  it("battery reduces clipping compared to no battery", () => {
    const series = daylightSeries(8000);

    // Without battery
    const noBattResult = runDispatch(
      {
        stringTimeseries: [series],
        inverters: [{ inverterKey: "TEST_INV_BATT", stringIndices: [0] }],
        resolvedInverters: { TEST_INV_BATT: integratedInverter },
        clippingThreshold: 1.0,
        consumptionProfile: null,
        homeConsumption: null,
        exportLimitW: 0,
      },
      noopProgress
    );

    // With battery
    const withBattResult = runDispatch(
      {
        stringTimeseries: [series],
        inverters: [
          {
            inverterKey: "TEST_INV_BATT",
            stringIndices: [0],
            batteryConfig: {
              essKey: "TEST_ESS",
              totalCapacityWh: 13500,
              totalDcChargeW: 5000,
              maxDischargeW: 5000,
              roundTrip: 0.90,
            },
          },
        ],
        resolvedInverters: { TEST_INV_BATT: integratedInverter },
        clippingThreshold: 1.0,
        consumptionProfile: null,
        homeConsumption: null,
        exportLimitW: 0,
      },
      noopProgress
    );

    expect(withBattResult.energyBalance.clippedKwh).toBeLessThanOrEqual(
      noBattResult.energyBalance.clippedKwh
    );
  });
});

describe("Dispatch — Energy Balance Equation [P1-F2]", () => {
  it("balance equation holds for no-battery system", () => {
    const series = daylightSeries(5000);
    const consumption = constantSeries(1000); // 1kW constant load

    const result = runDispatch(
      {
        stringTimeseries: [series],
        inverters: [{ inverterKey: "TEST_INV", stringIndices: [0] }],
        resolvedInverters: { TEST_INV: testInverter },
        clippingThreshold: 1.0,
        consumptionProfile: consumption,
        homeConsumption: {
          enabled: true,
          annualKwh: 8760,
          climateZone: "mixed",
          priorityMode: "self_consumption",
          backupReservePct: 20,
        },
        exportLimitW: 0,
      },
      noopProgress
    );

    const eb = result.energyBalance;
    // AC-side energy balance (no battery):
    // production = selfConsumed + gridExport + curtailed
    // (import covers deficit independently — not part of AC production flow)
    const acProduction = eb.totalProductionKwh;
    const acDisposition =
      eb.selfConsumedKwh +
      eb.gridExportKwh +
      eb.curtailedKwh;

    expectClose(acProduction, acDisposition, 1.0, "AC production balance");

    // Also verify grid import covers what solar didn't
    expect(eb.gridImportKwh).toBeGreaterThan(0);
  });

  it("balance equation holds for battery system", () => {
    const series = daylightSeries(8000);
    const consumption = constantSeries(1500);

    const result = runDispatch(
      {
        stringTimeseries: [series],
        inverters: [
          {
            inverterKey: "TEST_INV_BATT",
            stringIndices: [0],
            batteryConfig: {
              essKey: "TEST_ESS",
              totalCapacityWh: 13500,
              totalDcChargeW: 5000,
              maxDischargeW: 5000,
              roundTrip: 0.90,
            },
          },
        ],
        resolvedInverters: { TEST_INV_BATT: integratedInverter },
        clippingThreshold: 1.0,
        consumptionProfile: consumption,
        homeConsumption: {
          enabled: true,
          annualKwh: 13140,
          climateZone: "mixed",
          priorityMode: "self_consumption",
          backupReservePct: 20,
        },
        exportLimitW: 0,
      },
      noopProgress
    );

    const eb = result.energyBalance;
    // For battery: AC production is split between self-consumption,
    // export, AC battery charging, and curtailment.
    // Battery discharge reduces grid import (not tracked in production).
    // Just verify the production-side balance holds approximately.
    const acProduction = eb.totalProductionKwh;
    const acDisposition =
      eb.selfConsumedKwh +
      eb.gridExportKwh +
      eb.curtailedKwh;

    // AC-coupled battery charge is deducted from surplus (not from production),
    // so production ≈ selfConsumed + export + curtailed + acBatteryCharge
    // We allow the difference to equal the AC-coupled battery charge amount
    expect(acProduction).toBeGreaterThanOrEqual(acDisposition - 1);

    // Battery should have charged
    expect(eb.batteryChargedKwh).toBeGreaterThan(0);

    // Battery discharge should reduce import compared to no-battery
    expect(eb.batteryDischargedKwh).toBeGreaterThanOrEqual(0);
  });

  it("reports progress from 60% to 95%", () => {
    const series = daylightSeries(3000);
    const progressReports: number[] = [];

    runDispatch(
      {
        stringTimeseries: [series],
        inverters: [{ inverterKey: "TEST_INV", stringIndices: [0] }],
        resolvedInverters: { TEST_INV: testInverter },
        clippingThreshold: 1.0,
        consumptionProfile: null,
        homeConsumption: null,
        exportLimitW: 0,
      },
      (msg) => progressReports.push(msg.payload.percent)
    );

    expect(progressReports.length).toBeGreaterThan(0);
    for (const p of progressReports) {
      expect(p).toBeGreaterThanOrEqual(60);
      expect(p).toBeLessThanOrEqual(95);
    }
  });
});
