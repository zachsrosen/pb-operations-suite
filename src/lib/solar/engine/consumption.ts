/**
 * Solar Engine — Home Consumption Profile Generator
 *
 * Ported from V12 app.js:548-692. Generates 17,520 half-hourly watt
 * values from annual kWh + climate zone.
 *
 * Uses climate-aware monthly distribution (EIA data), realistic 24-hour
 * load shapes (NREL residential profiles), seasonal TOD adjustments,
 * and weekend/weekday differentiation.
 */

import { TIMESTEPS, SLOTS_PER_DAY, DAYS_PER_YEAR } from "./constants";
import type { HomeConsumptionConfig } from "./engine-types";

// ── Monthly Distribution Shapes ──────────────────────────────

const MONTHLY_SHAPES: Record<string, number[]> = {
  hot: [0.070, 0.065, 0.065, 0.072, 0.090, 0.110, 0.125, 0.125, 0.105, 0.080, 0.048, 0.045],
  mixed: [0.098, 0.090, 0.080, 0.072, 0.078, 0.092, 0.100, 0.098, 0.085, 0.073, 0.082, 0.052],
  cold: [0.108, 0.100, 0.090, 0.076, 0.070, 0.078, 0.088, 0.085, 0.075, 0.072, 0.085, 0.073],
};

// ── 24-Hour Load Shapes ──────────────────────────────────────

const BASE_HOURLY_SHAPES: Record<string, number[]> = {
  hot: [
    0.55, 0.50, 0.48, 0.47, 0.47, 0.50,
    0.60, 0.72, 0.78, 0.75, 0.73, 0.76,
    0.80, 0.85, 0.92, 0.95, 0.98, 1.00,
    1.10, 1.15, 1.08, 0.95, 0.80, 0.68,
    0.55,
  ],
  mixed: [
    0.45, 0.42, 0.40, 0.38, 0.38, 0.42,
    0.55, 0.70, 0.75, 0.65, 0.58, 0.55,
    0.58, 0.60, 0.62, 0.65, 0.75, 0.90,
    1.10, 1.15, 1.10, 0.95, 0.78, 0.60,
    0.45,
  ],
  cold: [
    0.52, 0.48, 0.46, 0.45, 0.46, 0.50,
    0.65, 0.82, 0.85, 0.72, 0.62, 0.58,
    0.58, 0.56, 0.55, 0.58, 0.68, 0.85,
    1.05, 1.15, 1.10, 0.95, 0.80, 0.65,
    0.52,
  ],
};

// ── Seasonal + Weekend Adjustments ───────────────────────────

function getSeasonalTodAdj(
  zone: string,
  month: number,
  hour: number
): number {
  // Summer months (Jun-Sep): boost afternoon/evening HVAC
  if (month >= 5 && month <= 8) {
    if (hour >= 12 && hour <= 18) return zone === "hot" ? 1.25 : 1.1;
    if (hour >= 0 && hour <= 5) return zone === "hot" ? 1.15 : 1.0;
  }
  // Winter months (Nov-Feb): boost morning heating
  if (month >= 10 || month <= 1) {
    if (hour >= 5 && hour <= 9) return zone === "cold" ? 1.2 : 1.05;
    if (hour >= 17 && hour <= 21) return zone === "cold" ? 1.15 : 1.05;
  }
  return 1.0;
}

function getWeekendAdj(hour: number): number {
  if (hour >= 6 && hour < 9) return 0.85;
  if (hour >= 9 && hour < 16) return 1.15;
  if (hour >= 16 && hour < 21) return 1.05;
  return 1.0;
}

// ── Days-in-month lookup (non-leap) ──────────────────────────

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Map day-of-year (0-364) to month index (0-11).
 */
function dayToMonth(day: number): number {
  let acc = 0;
  for (let m = 0; m < 12; m++) {
    acc += DAYS_IN_MONTH[m];
    if (day < acc) return m;
  }
  return 11;
}

/**
 * Map day-of-year (0-364) to day-of-week (0=Sun, 6=Sat).
 * Uses 2024 as reference year (Jan 1 = Monday = dow 1).
 */
function dayOfWeek(day: number): number {
  return (day + 1) % 7; // Jan 1 2024 = Monday (1), so day 0 → (0+1)%7 = 1
}

// ── Profile Generator ────────────────────────────────────────

/**
 * Generate a 17,520-element half-hourly consumption profile in watts.
 *
 * @param config Home consumption configuration
 * @returns Float32Array(17520) of watts, or null if disabled/invalid
 */
export function generateConsumptionProfile(
  config: HomeConsumptionConfig | null
): Float32Array | null {
  if (!config || !config.enabled || config.annualKwh <= 0) return null;

  const profile = new Float32Array(TIMESTEPS);
  const zone = config.climateZone || "mixed";
  const annualWh = config.annualKwh * 1000;

  // Monthly fractions
  let monthFractions: number[];
  if (config.monthlyKwh && config.monthlyKwh.length === 12) {
    const total = config.monthlyKwh.reduce((a, b) => a + b, 0);
    monthFractions = config.monthlyKwh.map((v) => v / total);
  } else {
    const raw = MONTHLY_SHAPES[zone] || MONTHLY_SHAPES.mixed;
    const rawSum = raw.reduce((a, b) => a + b, 0);
    monthFractions = raw.map((v) => v / rawSum);
  }

  const hourlyPts = BASE_HOURLY_SHAPES[zone] || BASE_HOURLY_SHAPES.mixed;

  for (let d = 0; d < DAYS_PER_YEAR; d++) {
    const m = dayToMonth(d);
    const dow = dayOfWeek(d);
    const isWeekend = dow === 0 || dow === 6;
    const dailyWh = (annualWh * monthFractions[m]) / DAYS_IN_MONTH[m];

    // Build 48-slot weight array by linear interpolation of hourly points
    const dayWeights = new Float32Array(SLOTS_PER_DAY);
    let dayWeightSum = 0;

    for (let h = 0; h < SLOTS_PER_DAY; h++) {
      const hour = h / 2;
      const h0 = Math.floor(hour);
      const h1 = Math.min(24, h0 + 1);
      const frac = hour - h0;
      let w = hourlyPts[h0] * (1 - frac) + hourlyPts[h1] * frac;

      // Seasonal TOD adjustment
      w *= getSeasonalTodAdj(zone, m, hour);

      // Weekend adjustment
      if (isWeekend) {
        w *= 0.3 + 0.7 * getWeekendAdj(hour);
      }

      // Deterministic noise (±5%)
      const noise = 1.0 + 0.05 * Math.sin(d * 7.3 + h * 2.1);
      w *= noise;

      dayWeights[h] = Math.max(0.1, w);
      dayWeightSum += dayWeights[h];
    }

    // Scale weights so this day's total matches dailyWh
    for (let h = 0; h < SLOTS_PER_DAY; h++) {
      const stepWh = dailyWh * (dayWeights[h] / dayWeightSum);
      profile[d * SLOTS_PER_DAY + h] = stepWh / 0.5; // Wh per 30min → Watts
    }
  }

  return profile;
}
