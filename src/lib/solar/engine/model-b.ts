/**
 * Solar Engine — Model B: String Mismatch with Bypass Diodes
 *
 * Ported from V12 app.js:1117-1209 (generateStringTimeseries).
 * Only runs for architectureType === "string". For micro/optimizer,
 * the runner returns modelB: null [P1-F3].
 *
 * Bypass diode model:
 * - Each panel has N bypass diodes (typically 3)
 * - Each diode covers 1/N of the panel area (a "substring")
 * - Shade distributed proportionally across substrings
 * - Fully shaded substrings are bypassed (contribute ~0V)
 * - Partially shaded substrings reduce current
 * - String current = min panel current ratio (series constraint)
 */

import { TIMESTEPS, SLOTS_PER_DAY, HALF_HOUR_FACTOR, sumToMonthly, sumTotal } from "./constants";
import type { PanelStat, ShadeData, StringConfig, TmyLookup, ResolvedPanel, ModelBResult } from "./engine-types";
import { solarFactor, seasonFactor, getSeasonalTSRF, getPanelShadeFactorAtTimestep } from "./physics";
import { getTmyIrradiance, getTemperatureDerate } from "./weather";
import type { WorkerProgressMessage } from "../types";

export interface ModelBInput {
  panels: PanelStat[];
  strings: StringConfig[];
  shadeData: ShadeData;
  resolvedPanels: Record<string, ResolvedPanel>;
  tmyLookup: TmyLookup;
  hasShade: boolean;
  /** The single panel spec used across strings (V12 uses one panel type) */
  primaryPanelKey: string;
}

/**
 * Run Model B: generate string-level timeseries with bypass diode mismatch.
 *
 * Progress: 30% → 60% (reported every 480 timesteps = ~10 days).
 */
export function runModelB(
  input: ModelBInput,
  reportProgress: (msg: WorkerProgressMessage) => void
): ModelBResult {
  const { panels, strings, shadeData, resolvedPanels, tmyLookup, hasShade, primaryPanelKey } = input;

  if (strings.length === 0) {
    return {
      annualKwh: 0,
      monthlyKwh: new Array(12).fill(0),
      mismatchLossPct: 0,
      stringTimeseries: [],
    };
  }

  const spec = resolvedPanels[primaryPanelKey];
  if (!spec) {
    return {
      annualKwh: 0,
      monthlyKwh: new Array(12).fill(0),
      mismatchLossPct: 0,
      stringTimeseries: [],
    };
  }

  const numDiodes = spec.bypassDiodes;
  const vmpPerPanel = spec.vmp;
  const impPanel = spec.imp;
  const tempCoPmax = spec.tempCoPmax || -0.003;
  const useTmy = tmyLookup.hasTmy;
  const stringTimeseries: Float32Array[] = [];

  for (const str of strings) {
    const series = new Float32Array(TIMESTEPS);
    const panelIndices = str.panels;

    for (let t = 0; t < TIMESTEPS; t++) {
      // Progress: 30% → 60% reported every 480 steps
      // (must be before early-exit continues)
      if (t % 480 === 0) {
        const pct = 30 + Math.round((t / TIMESTEPS) * 30);
        reportProgress({
          type: "SIMULATION_PROGRESS",
          payload: { percent: pct, stage: "Model B" },
        });
      }

      const d = Math.floor(t / SLOTS_PER_DAY);
      const h = t % SLOTS_PER_DAY;

      let baseFactor: number;
      let tempDerate = 1.0;

      if (useTmy) {
        baseFactor = getTmyIrradiance(tmyLookup, t);
        tempDerate = getTemperatureDerate(tmyLookup, t, tempCoPmax);
      } else {
        const sf = solarFactor(h);
        if (sf <= 0.01) continue;
        baseFactor = sf * seasonFactor(d);
      }

      if (baseFactor <= 0.01) continue;

      // For each panel in string, compute current ratio and voltage contribution
      let minCurrentRatio = 1;
      let totalVoltage = 0;
      let anyActive = false;

      for (const pIdx of panelIndices) {
        const panel = panels[pIdx];
        if (!panel) continue;

        const shadeFactor = getPanelShadeFactorAtTimestep(
          panel.points,
          t,
          shadeData,
          hasShade
        );
        const shadedFraction = 1 - shadeFactor;
        const tsrfValue = getSeasonalTSRF(panel.tsrf || 0.8, d, hasShade);

        // Bypass diode model
        let bypassed = 0;
        let partialShade = 0;

        if (shadedFraction > 0) {
          bypassed = Math.min(
            numDiodes,
            Math.floor(shadedFraction * numDiodes)
          );
          partialShade = shadedFraction * numDiodes - bypassed;
        }

        const activeSubstrings = numDiodes - bypassed;
        const currentRatio =
          activeSubstrings > 0
            ? (activeSubstrings - partialShade * 0.5) / numDiodes
            : 0;

        if (currentRatio > 0) {
          minCurrentRatio = Math.min(minCurrentRatio, currentRatio);
          totalVoltage +=
            vmpPerPanel *
            (activeSubstrings / numDiodes) *
            baseFactor *
            tsrfValue;
          anyActive = true;
        }
      }

      if (!anyActive) continue;

      series[t] = impPanel * minCurrentRatio * totalVoltage * tempDerate;
    }

    stringTimeseries.push(series);
  }

  // Aggregate
  const totalSeries = new Float32Array(TIMESTEPS);
  for (const series of stringTimeseries) {
    for (let t = 0; t < TIMESTEPS; t++) {
      totalSeries[t] += series[t];
    }
  }

  const annualKwh = sumTotal(totalSeries, HALF_HOUR_FACTOR);
  const monthlyKwh = sumToMonthly(totalSeries, HALF_HOUR_FACTOR);

  // Compute mismatch loss (requires Model A total for comparison — done in runner)
  return {
    annualKwh,
    monthlyKwh,
    mismatchLossPct: 0, // Set by runner after comparing with Model A
    stringTimeseries,
  };
}
