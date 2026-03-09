/**
 * Solar Engine — Energy Dispatch
 *
 * Ported from V12 app.js:1409-1676 (runEnergyDispatch).
 * Most complex module — 5-phase per-timestep loop.
 *
 * Phases:
 * 1. Sum string timeseries per inverter → raw DC input
 * 2. DC battery charging (PW3 DC-coupled, BEFORE AC clip)
 * 3. AC clipping per inverter
 * 4. System dispatch — home load, self-consumption, battery discharge,
 *    AC-coupled battery charge, export limit curtailment
 * 5. Record dispatch timestep, accumulate energy balance
 */

import { TIMESTEPS } from "./constants";
import type {
  InverterConfig,
  BatteryConfig,
  ResolvedInverter,
  EnergyBalance,
  DispatchResult,
  HomeConsumptionConfig,
} from "./engine-types";
import type { WorkerProgressMessage } from "../types";

export interface DispatchInput {
  /** Per-string half-hourly timeseries in watts (from Model B, or Model A per-panel summed per-string) */
  stringTimeseries: Float32Array[];
  inverters: InverterConfig[];
  resolvedInverters: Record<string, ResolvedInverter>;
  clippingThreshold: number;
  consumptionProfile: Float32Array | null;
  homeConsumption: HomeConsumptionConfig | null;
  exportLimitW: number;
}

/** TOU peak hours: 4pm-9pm (slots 32-41) */
function isPeakHour(t: number): boolean {
  const slot = t % 48;
  return slot >= 32 && slot <= 41;
}

/**
 * Run energy dispatch across all 17,520 timesteps.
 *
 * Progress: 60% → 95% (reported every 480 steps = ~10 days).
 */
export function runDispatch(
  input: DispatchInput,
  reportProgress: (msg: WorkerProgressMessage) => void
): DispatchResult {
  const {
    stringTimeseries,
    inverters,
    resolvedInverters,
    clippingThreshold,
    consumptionProfile,
    homeConsumption,
    exportLimitW,
  } = input;

  const hasConsumption =
    homeConsumption?.enabled === true && consumptionProfile !== null;
  const mode = homeConsumption?.priorityMode ?? "self_consumption";
  const backupReservePct = homeConsumption?.backupReservePct ?? 20;

  // Energy balance accumulator
  const eb: EnergyBalance = {
    totalProductionKwh: 0,
    selfConsumedKwh: 0,
    gridExportKwh: 0,
    gridImportKwh: 0,
    batteryChargedKwh: 0,
    batteryDischargedKwh: 0,
    batteryLossesKwh: 0,
    curtailedKwh: 0,
    clippedKwh: 0,
    deltaStoredKwh: 0,
  };

  // Per-inverter battery state
  interface BatteryState {
    socWh: Float32Array;
    chargeW: Float32Array;
    config: BatteryConfig;
    sqrtEff: number;
  }

  const batteryStates: (BatteryState | null)[] = [];
  let totalSystemClipped = 0;
  let totalSystemGen = 0;

  // PHASE 0: Initialize per-inverter battery state
  for (const inv of inverters) {
    const spec = resolvedInverters[inv.inverterKey];
    const bCfg = inv.batteryConfig;

    if (spec?.isIntegrated && bCfg && bCfg.totalCapacityWh > 0) {
      const sqrtEff = Math.sqrt(bCfg.roundTrip);
      const socWh = new Float32Array(TIMESTEPS);
      // Start at backup reserve level
      socWh[0] =
        bCfg.totalCapacityWh * Math.max(0.2, backupReservePct / 100);

      batteryStates.push({
        socWh,
        chargeW: new Float32Array(TIMESTEPS),
        config: bCfg,
        sqrtEff,
      });
    } else {
      batteryStates.push(null);
    }
  }

  // Record initial SOC for delta calculation [P1-F2]
  let initialTotalSocKwh = 0;
  for (const bs of batteryStates) {
    if (bs) initialTotalSocKwh += bs.socWh[0] / 1000;
  }

  // MAIN DISPATCH LOOP
  for (let t = 0; t < TIMESTEPS; t++) {
    // PHASE 1: Compute raw DC input per inverter
    const dcInputs: number[] = [];
    for (let invIdx = 0; invIdx < inverters.length; invIdx++) {
      let dcInput = 0;
      for (const sIdx of inverters[invIdx].stringIndices) {
        if (stringTimeseries[sIdx]) {
          dcInput += stringTimeseries[sIdx][t];
        }
      }
      dcInputs[invIdx] = dcInput;
    }

    // PHASE 2: DC Battery Charging (PW3 only, BEFORE inverter clip)
    const rawDcInputs = dcInputs.slice();

    for (let invIdx = 0; invIdx < inverters.length; invIdx++) {
      const spec = resolvedInverters[inverters[invIdx].inverterKey];
      const bState = batteryStates[invIdx];
      if (!bState || !spec?.isIntegrated) continue;

      const bCfg = bState.config;
      const prevSoC = t > 0 ? bState.socWh[t - 1] : bState.socWh[0];
      const acCapW = spec.acPower * clippingThreshold;
      const dcForAC = acCapW / spec.efficiency;

      const excessDC = dcInputs[invIdx] - dcForAC;
      if (excessDC > 0 && prevSoC < bCfg.totalCapacityWh) {
        const headroom =
          (bCfg.totalCapacityWh - prevSoC) / (0.5 * bState.sqrtEff);
        const dcCharge = Math.min(excessDC, bCfg.totalDcChargeW, headroom);
        bState.chargeW[t] = dcCharge;
        bState.socWh[t] = prevSoC + dcCharge * 0.5 * bState.sqrtEff;
        dcInputs[invIdx] -= dcCharge;
        eb.batteryChargedKwh += (dcCharge * 0.5) / 1000;
        eb.batteryLossesKwh +=
          (dcCharge * 0.5 * (1 - bState.sqrtEff)) / 1000;
      } else {
        bState.socWh[t] = prevSoC;
      }
    }

    // PHASE 3: AC Clipping per inverter
    let totalACOutput = 0;

    for (let invIdx = 0; invIdx < inverters.length; invIdx++) {
      const spec = resolvedInverters[inverters[invIdx].inverterKey];
      if (!spec) continue;

      const acLimit = spec.acPower * clippingThreshold;
      const bState = batteryStates[invIdx];
      const dcToBatt = bState ? bState.chargeW[t] || 0 : 0;

      let acOutput = dcInputs[invIdx] * spec.efficiency;
      let clippedW = 0;

      if (acOutput > acLimit) {
        clippedW = acOutput - acLimit;
        acOutput = acLimit;
        totalSystemClipped += clippedW;
        eb.clippedKwh += clippedW / 2000;
      }

      totalSystemGen += dcInputs[invIdx] + dcToBatt;
      totalACOutput += acOutput;
    }

    // PHASE 4: System Dispatch
    const homeLoad = hasConsumption ? consumptionProfile![t] : 0;
    let selfConsumed = Math.min(totalACOutput, homeLoad);
    let surplus = totalACOutput - selfConsumed;
    let deficit = homeLoad - selfConsumed;

    // Battery discharge to cover deficit
    if (deficit > 0) {
      const dischargeAllowed =
        mode === "export_first" ? totalACOutput === 0 : true;
      const touBoost = mode === "tou" && isPeakHour(t) ? 1.5 : 1.0;

      if (dischargeAllowed) {
        for (let invIdx = 0; invIdx < inverters.length; invIdx++) {
          if (deficit <= 0) break;
          const bState = batteryStates[invIdx];
          if (!bState) continue;

          const bCfg = bState.config;
          const soc = bState.socWh[t];
          const reserveWh = bCfg.totalCapacityWh * (backupReservePct / 100);
          const availableWh = Math.max(0, soc - reserveWh);
          const maxDischW = Math.min(
            bCfg.maxDischargeW * touBoost,
            availableWh / (0.5 / bState.sqrtEff)
          );
          const discharge = Math.min(deficit, maxDischW);

          if (discharge > 0) {
            bState.socWh[t] -= (discharge * 0.5) / bState.sqrtEff;
            deficit -= discharge;
            eb.batteryDischargedKwh += (discharge * 0.5) / 1000;
            eb.batteryLossesKwh +=
              (discharge * 0.5 * (1 - bState.sqrtEff)) / 1000;
          }
        }
      }
    }

    // AC-coupled battery charge from surplus
    if (surplus > 0 && mode !== "export_first") {
      for (let invIdx = 0; invIdx < inverters.length; invIdx++) {
        if (surplus <= 0) break;
        const bState = batteryStates[invIdx];
        if (!bState) continue;

        const bCfg = bState.config;
        const soc = bState.socWh[t];
        const headroom = bCfg.totalCapacityWh - soc;
        if (headroom <= 0) continue;

        const dcAlreadyCharged = bState.chargeW[t] || 0;
        const maxAdditional = Math.min(
          bCfg.totalDcChargeW - dcAlreadyCharged,
          headroom / (0.5 * bState.sqrtEff)
        );
        if (maxAdditional <= 0) continue;

        const acCharge = Math.min(surplus, maxAdditional);
        bState.chargeW[t] += acCharge;
        bState.socWh[t] += acCharge * 0.5 * bState.sqrtEff;
        surplus -= acCharge;
        eb.batteryChargedKwh += (acCharge * 0.5) / 1000;
        eb.batteryLossesKwh +=
          (acCharge * 0.5 * (1 - bState.sqrtEff)) / 1000;
      }
    }

    // Export limit curtailment
    let curtailedW = 0;
    if (exportLimitW > 0 && surplus > exportLimitW) {
      curtailedW = surplus - exportLimitW;

      // Try to push excess to battery before curtailing
      for (let invIdx = 0; invIdx < inverters.length; invIdx++) {
        if (curtailedW <= 0) break;
        const bState = batteryStates[invIdx];
        if (!bState) continue;

        const bCfg = bState.config;
        const headroom = bCfg.totalCapacityWh - bState.socWh[t];
        if (headroom <= 0) continue;

        const maxCharge = Math.min(
          curtailedW,
          bCfg.totalDcChargeW - (bState.chargeW[t] || 0),
          headroom / (0.5 * bState.sqrtEff)
        );
        if (maxCharge > 0) {
          bState.chargeW[t] += maxCharge;
          bState.socWh[t] += maxCharge * 0.5 * bState.sqrtEff;
          curtailedW -= maxCharge;
          surplus -= maxCharge;
          eb.batteryChargedKwh += (maxCharge * 0.5) / 1000;
        }
      }

      if (curtailedW > 0) {
        surplus -= curtailedW;
        eb.curtailedKwh += curtailedW / 2000;
      }
    }

    // TOU mode: charge battery from surplus during off-peak
    if (mode === "tou" && !isPeakHour(t) && surplus > 0) {
      for (let invIdx = 0; invIdx < inverters.length; invIdx++) {
        if (surplus <= 0) break;
        const bState = batteryStates[invIdx];
        if (!bState) continue;

        const bCfg = bState.config;
        const headroom = bCfg.totalCapacityWh - bState.socWh[t];
        if (headroom <= 0) continue;

        const maxCharge = Math.min(
          surplus,
          bCfg.totalDcChargeW - (bState.chargeW[t] || 0),
          headroom / (0.5 * bState.sqrtEff)
        );
        if (maxCharge > 0) {
          bState.chargeW[t] += maxCharge;
          bState.socWh[t] += maxCharge * 0.5 * bState.sqrtEff;
          surplus -= maxCharge;
          eb.batteryChargedKwh += (maxCharge * 0.5) / 1000;
        }
      }
    }

    // PHASE 5: Record
    eb.totalProductionKwh += totalACOutput / 2000;
    eb.selfConsumedKwh += selfConsumed / 2000;
    eb.gridExportKwh += surplus / 2000;
    eb.gridImportKwh += deficit / 2000;

    // Progress: 60% → 95%
    if (t % 480 === 0) {
      const pct = 60 + Math.round((t / TIMESTEPS) * 35);
      reportProgress({
        type: "SIMULATION_PROGRESS",
        payload: { percent: pct, stage: "Dispatch" },
      });
    }
  }

  // Compute SOC delta [P1-F2]
  let finalTotalSocKwh = 0;
  for (const bs of batteryStates) {
    if (bs) finalTotalSocKwh += bs.socWh[TIMESTEPS - 1] / 1000;
  }
  eb.deltaStoredKwh = finalTotalSocKwh - initialTotalSocKwh;

  // Clipping loss percentage
  const clippingLossPct =
    totalSystemGen > 0 ? (totalSystemClipped / totalSystemGen) * 100 : 0;

  return {
    energyBalance: eb,
    clippingLossPct,
    curtailedKwh: eb.curtailedKwh,
  };
}
