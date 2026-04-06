/**
 * Solar Designer V12 Engine — Physics
 *
 * Re-exports from existing engine/physics.ts (already V12-faithful).
 * See: src/lib/solar/engine/physics.ts header "Ported from V12 physics.js"
 */
export {
  solarFactor,
  seasonFactor,
  getSeasonalTSRF,
  getPanelShadeFactorAtTimestep,
  calculateStringElectrical,
} from '../engine/physics';

export type {
  StringElectricalInput,
  StringElectricalResult,
} from '../engine/physics';
