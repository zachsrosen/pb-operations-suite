/**
 * Solar Engine — Pure Physics Functions
 *
 * Ported from V12 physics.js. All pure functions, no state, no DOM.
 */

import type { ShadeData } from "./engine-types";

// ── Solar & Season Curves ────────────────────────────────────

/**
 * Synthetic solar irradiance factor for a half-hour slot.
 * Sunrise ~6:00, sunset ~20:00, sinusoidal peak at solar noon.
 *
 * @param halfHour 0-47 half-hour index within a day
 * @returns 0-1 normalized irradiance factor
 */
export function solarFactor(halfHour: number): number {
  const hour = halfHour / 2;
  if (hour < 6 || hour > 20) return 0;
  return Math.sin(((hour - 6) / 14) * Math.PI);
}

/**
 * Seasonal variation factor for a given day of year.
 * Peak around summer solstice (~day 172), trough near winter solstice.
 *
 * @param dayOfYear 0-364
 * @returns ~0.4-1.0
 */
export function seasonFactor(dayOfYear: number): number {
  return 0.7 + 0.3 * Math.sin(((dayOfYear - 80) / 365) * 2 * Math.PI);
}

// ── TSRF & Shade ─────────────────────────────────────────────

/**
 * Seasonal TSRF decomposition.
 *
 * When shade data is missing, the annual-average TSRF suppresses summer
 * peaks. This decomposes TSRF into a seasonal curve: higher in summer,
 * lower in winter. Calibrated to preserve the production-weighted annual
 * energy integral.
 *
 * @param panelTsrf Annual average TSRF (0-1)
 * @param dayOfYear 0-indexed day (0-364)
 * @param hasShade Whether real shade data is available
 * @returns Adjusted TSRF for this day
 */
export function getSeasonalTSRF(
  panelTsrf: number,
  dayOfYear: number,
  hasShade = false
): number {
  if (hasShade) return panelTsrf;
  if (!panelTsrf || panelTsrf >= 1.0) return panelTsrf || 0.8;

  const SHADE_SWING = 0.65;
  const B = SHADE_SWING * (1.0 - panelTsrf);
  const correctedBase = panelTsrf - 0.15 * B;
  const S = Math.sin(((dayOfYear - 80) / 365) * 2 * Math.PI);
  return Math.max(0.01, Math.min(1.0, correctedBase + B * S));
}

/**
 * Panel shade factor at a specific timestep.
 *
 * @param points Array of point IDs belonging to this panel
 * @param timestepIdx Index into shade sequence (0-17519)
 * @param shadeData Point ID → shade sequence string mapping
 * @param hasShade Whether shade data is loaded
 * @returns 0-1 (1 = fully unshaded)
 */
export function getPanelShadeFactorAtTimestep(
  points: string[],
  timestepIdx: number,
  shadeData: ShadeData,
  hasShade: boolean
): number {
  if (!hasShade || points.length === 0) return 1;
  let shaded = 0;
  let total = 0;
  for (const ptId of points) {
    const seq = shadeData[ptId];
    if (seq && timestepIdx < seq.length) {
      const c = seq[timestepIdx];
      if (c === "0" || c === "1") {
        total++;
        if (c === "0") shaded++;
      }
    }
  }
  if (total === 0) return 1;
  return 1 - shaded / total;
}

// ── String Electrical ────────────────────────────────────────

export interface StringElectricalInput {
  numPanels: number;
  panel: {
    watts: number;
    voc: number;
    vmp: number;
    isc: number;
    imp: number;
    tempCoVoc: number;
    tempCoIsc: number;
  };
  inverter: {
    mpptMax: number;
    mpptMin: number;
    maxIsc: number;
  };
  tempMin: number;
  tempMax: number;
}

export interface StringElectricalResult {
  vocCold: number;
  vmpHot: number;
  vmp: number;
  power: number;
  isc: number;
  imp: number;
  warning: string | null;
}

/**
 * Calculate string electrical properties with temperature derating.
 */
export function calculateStringElectrical(
  input: StringElectricalInput
): StringElectricalResult {
  const { numPanels: n, panel, inverter, tempMin, tempMax } = input;

  const vocCold = n * panel.voc * (1 + panel.tempCoVoc * (tempMin - 25));
  const vmpHot = n * panel.vmp * (1 + panel.tempCoVoc * (tempMax - 25));
  const vmp = n * panel.vmp;
  const power = n * panel.watts;
  const isc = panel.isc * (1 + panel.tempCoIsc * (tempMax - 25));

  let warning: string | null = null;
  if (vocCold > inverter.mpptMax) {
    warning = `Voc exceeds inverter max (${inverter.mpptMax}V)`;
  } else if (vmpHot < inverter.mpptMin) {
    warning = `Vmp below inverter min (${inverter.mpptMin}V)`;
  } else if (isc > inverter.maxIsc) {
    warning = `Isc exceeds inverter max (${inverter.maxIsc}A)`;
  }

  return { vocCold, vmpHot, vmp, power, isc, imp: panel.imp, warning };
}
