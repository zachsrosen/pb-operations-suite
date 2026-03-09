/**
 * Solar Engine — Model A: Independent Panel Timeseries
 *
 * Ported from V12 app.js:1079-1114 (generateIndependentTimeseries).
 * Computes per-panel half-hourly power output assuming each panel
 * operates independently (no string mismatch effects).
 *
 * Includes F7 bifacial gain integration.
 */

import { TIMESTEPS, SLOTS_PER_DAY, DAYS_PER_YEAR, HALF_HOUR_FACTOR, sumToMonthly, sumTotal } from "./constants";
import type { PanelStat, ShadeData, TmyLookup, ResolvedPanel, ModelAResult } from "./engine-types";
import { solarFactor, seasonFactor, getSeasonalTSRF, getPanelShadeFactorAtTimestep } from "./physics";
import { getTmyIrradiance, getTemperatureDerate } from "./weather";
import type { WorkerProgressMessage } from "../types";

export interface ModelAInput {
  panels: PanelStat[];
  shadeData: ShadeData;
  resolvedPanels: Record<string, ResolvedPanel>;
  tmyLookup: TmyLookup;
  hasShade: boolean;
}

/**
 * Run Model A: generate independent panel timeseries.
 *
 * Progress: 0% → 30% (reported per panel).
 */
export function runModelA(
  input: ModelAInput,
  reportProgress: (msg: WorkerProgressMessage) => void
): ModelAResult {
  const { panels, shadeData, resolvedPanels, tmyLookup, hasShade } = input;
  const useTmy = tmyLookup.hasTmy;
  const panelTimeseries: Float32Array[] = [];

  for (let pIdx = 0; pIdx < panels.length; pIdx++) {
    const panel = panels[pIdx];
    const spec = resolvedPanels[panel.panelKey];
    if (!spec) continue;

    const series = new Float32Array(TIMESTEPS);
    const panelWatts = spec.watts;
    const tempCoPmax = spec.tempCoPmax || -0.003;
    const baseTsrf = panel.tsrf || 0.8;
    const bifacialGain = panel.bifacialGain;

    for (let d = 0; d < DAYS_PER_YEAR; d++) {
      const tsrfValue = getSeasonalTSRF(baseTsrf, d, hasShade);

      for (let h = 0; h < SLOTS_PER_DAY; h++) {
        const t = d * SLOTS_PER_DAY + h;
        const shadeFactor = getPanelShadeFactorAtTimestep(
          panel.points,
          t,
          shadeData,
          hasShade
        );

        let irradiance: number;
        let tempDerate = 1.0;

        if (useTmy) {
          irradiance = getTmyIrradiance(tmyLookup, t);
          tempDerate = getTemperatureDerate(tmyLookup, t, tempCoPmax);
        } else {
          irradiance = solarFactor(h) * seasonFactor(d);
        }

        series[t] =
          panelWatts *
          irradiance *
          shadeFactor *
          tsrfValue *
          tempDerate *
          bifacialGain;
      }
    }

    panelTimeseries.push(series);

    // Progress: 0% → 30% proportional to panels processed
    const pct = Math.round((pIdx + 1) / panels.length * 30);
    reportProgress({
      type: "SIMULATION_PROGRESS",
      payload: { percent: pct, stage: "Model A" },
    });
  }

  // Aggregate: sum all panel timeseries
  const totalSeries = new Float32Array(TIMESTEPS);
  for (const series of panelTimeseries) {
    for (let t = 0; t < TIMESTEPS; t++) {
      totalSeries[t] += series[t];
    }
  }

  const annualKwh = sumTotal(totalSeries, HALF_HOUR_FACTOR);
  const monthlyKwh = sumToMonthly(totalSeries, HALF_HOUR_FACTOR);

  return { annualKwh, monthlyKwh, panelTimeseries };
}
