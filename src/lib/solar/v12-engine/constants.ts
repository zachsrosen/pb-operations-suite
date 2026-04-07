/**
 * Solar Designer V12 Engine — Constants
 *
 * Re-exports shared constants from existing engine.
 * Add new v12-specific constants here.
 */

export {
  TIMESTEPS,
  HALF_HOUR_FACTOR,
  DAYS_PER_YEAR,
  SLOTS_PER_DAY,
  HOURS_PER_YEAR,
  MONTH_START_DAY,
  MONTH_END_DAY,
  timestepToMonthIndex,
  sumToMonthly,
  sumTotal,
} from '../engine/constants';

/** Default site conditions matching V12 defaults */
export const DEFAULT_SITE_CONDITIONS = {
  tempMin: -10,        // °C (V12 default cold temp)
  tempMax: 45,         // °C (V12 default hot temp)
  groundAlbedo: 0.2,   // grass
  clippingThreshold: 1.0, // 100% of rated AC
  exportLimitW: 0,     // no export limit
} as const;

/** Default loss profile matching V12 defaults */
export const DEFAULT_LOSS_PROFILE = {
  soiling: 2.0,
  mismatch: 2.0,
  dcWiring: 2.0,
  acWiring: 1.0,
  availability: 3.0,
  lid: 1.5,
  snow: 0.0,
  nameplate: 1.0,
} as const;
