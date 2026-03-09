/**
 * Solar Engine — Shared Constants & Monthly Aggregation Helpers
 *
 * Used across all engine modules. No side effects, no DOM references.
 */

/** 365 days x 48 half-hour slots = 17,520 timesteps per year */
export const TIMESTEPS = 17_520;

/** Multiply watts by 0.5h / 1000 to get kWh per half-hour */
export const HALF_HOUR_FACTOR = 2_000;

export const DAYS_PER_YEAR = 365;
export const SLOTS_PER_DAY = 48;
export const HOURS_PER_YEAR = 8_760;

/** Day-of-year where each month starts (0-indexed, non-leap) */
export const MONTH_START_DAY = [
  0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334,
] as const;

/** Day-of-year where each month ends (exclusive, non-leap) */
export const MONTH_END_DAY = [
  31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365,
] as const;

/**
 * Map a half-hourly timestep index (0..17519) to a month index (0..11).
 */
export function timestepToMonthIndex(t: number): number {
  const day = Math.floor(t / SLOTS_PER_DAY);
  for (let m = 11; m >= 0; m--) {
    if (day >= MONTH_START_DAY[m]) return m;
  }
  return 0;
}

/**
 * Aggregate a 17,520-element half-hourly series into 12 monthly totals.
 * Each half-hourly value is divided by `divisor` (e.g. HALF_HOUR_FACTOR
 * for watts → kWh conversion).
 */
export function sumToMonthly(
  series: Float32Array,
  divisor: number
): number[] {
  const monthly = new Array<number>(12).fill(0);
  for (let t = 0; t < TIMESTEPS; t++) {
    monthly[timestepToMonthIndex(t)] += series[t] / divisor;
  }
  return monthly;
}

/**
 * Sum an entire 17,520-element series and divide by divisor.
 */
export function sumTotal(series: Float32Array, divisor: number): number {
  let total = 0;
  for (let t = 0; t < TIMESTEPS; t++) {
    total += series[t];
  }
  return total / divisor;
}
