/**
 * Solar Engine — TMY Weather Data Processing
 *
 * Ported from V12 weather.js. No fetch — receives pre-parsed TMY data
 * from the host. Weather is fetched by the host via /api/solar/weather
 * and passed to the worker via message.
 *
 * Key concepts:
 * - GHI (Global Horizontal Irradiance, W/m^2) replaces synthetic curves
 * - Ambient temperature enables per-timestep power derating via tempCoPmax
 * - Normalized irradiance = GHI / 1000 (fraction of STC 1000 W/m^2)
 * - Cell temperature estimated via simplified NOCT model
 */

import { HOURS_PER_YEAR, TIMESTEPS } from "./constants";
import type { TmyData, TmyLookup } from "./engine-types";

// ── TMY Lookup Preparation ───────────────────────────────────

/**
 * Prepare half-hourly TMY lookup from hourly TMY data.
 *
 * @param tmyData Raw 8,760 hourly GHI + temperature arrays
 * @returns TmyLookup with interpolated 17,520 half-hourly arrays
 */
export function prepareTmyLookup(tmyData: TmyData | null): TmyLookup {
  if (
    !tmyData ||
    !tmyData.ghi ||
    !tmyData.temperature ||
    tmyData.ghi.length !== HOURS_PER_YEAR ||
    tmyData.temperature.length !== HOURS_PER_YEAR
  ) {
    return {
      ghi: new Float32Array(TIMESTEPS),
      temp: new Float32Array(TIMESTEPS),
      annualPSH: 0,
      hasTmy: false,
    };
  }

  const ghi = interpolateToHalfHourly(tmyData.ghi);
  const temp = interpolateToHalfHourly(tmyData.temperature);

  // Calculate annual PSH: sum(GHI half-hourly × 0.5h) / 1000
  let ghiSum = 0;
  for (let i = 0; i < TIMESTEPS; i++) {
    ghiSum += ghi[i];
  }
  const annualPSH = ghiSum / 2000; // (W/m^2 × 0.5h) / 1000 = kWh/m^2

  return { ghi, temp, annualPSH, hasTmy: true };
}

// ── Per-Timestep Accessors ───────────────────────────────────

/**
 * Get STC-normalized irradiance for a half-hour timestep.
 *
 * @param lookup Pre-computed TMY lookup
 * @param timestep 0-17519 half-hourly index
 * @returns GHI / 1000 (0-~1.2, fraction of STC irradiance)
 */
export function getTmyIrradiance(
  lookup: TmyLookup,
  timestep: number
): number {
  return lookup.ghi[timestep] / 1000;
}

/**
 * Calculate power temperature derate factor for a timestep.
 *
 * Simplified NOCT cell temperature model:
 *   T_cell = T_ambient + (NOCT - 20) * (GHI / 800)
 *
 * Power derate:
 *   derate = 1 + tempCoPmax * (T_cell - 25)
 *
 * At STC (25C cell), derate = 1.0.
 * Hotter → derate < 1 (less power).
 * Colder → derate > 1 (capped at 1.10).
 *
 * @param lookup Pre-computed TMY lookup
 * @param timestep 0-17519
 * @param tempCoPmax Power temperature coefficient (decimal, e.g. -0.0026)
 * @param noct Nominal Operating Cell Temperature (C), default 45
 * @returns Derate factor (typically 0.85-1.05)
 */
export function getTemperatureDerate(
  lookup: TmyLookup,
  timestep: number,
  tempCoPmax: number,
  noct = 45
): number {
  if (!lookup.hasTmy) return 1.0;

  const tAmb = lookup.temp[timestep];
  const ghi = lookup.ghi[timestep];

  if (ghi <= 0) return 1.0; // Night — no production anyway

  // Cell temperature estimate (simplified NOCT model)
  const tCell = tAmb + (noct - 20) * (ghi / 800);

  // Power derate — negative tempCoPmax means power decreases with temperature
  const derate = 1 + tempCoPmax * (tCell - 25);

  // Clamp to reasonable range
  return Math.max(0.5, Math.min(1.1, derate));
}

// ── Interpolation ────────────────────────────────────────────

/**
 * Linear interpolation: 8,760 hourly → 17,520 half-hourly.
 *
 * Each hourly value V[i] produces two half-hourly values:
 *   half[2i]   = (V[i-1] + V[i]) / 2  (blend with previous)
 *   half[2i+1] = (V[i] + V[i+1]) / 2  (blend with next)
 *
 * Boundary wraps around for continuity. GHI values clamped >= 0.
 */
export function interpolateToHalfHourly(hourly: number[]): Float32Array {
  const n = hourly.length;
  const half = new Float32Array(n * 2);

  for (let i = 0; i < n; i++) {
    const prev = hourly[(i - 1 + n) % n];
    const curr = hourly[i];
    const next = hourly[(i + 1) % n];

    half[2 * i] = Math.max(0, (prev + curr) / 2);
    half[2 * i + 1] = Math.max(0, (curr + next) / 2);
  }

  return half;
}
