/**
 * Solar Designer V12 Engine — Mismatch
 *
 * Re-exports Model B (string-level production with bypass diode model)
 * and the mismatch loss calculator.
 */
export { runModelB } from '../engine/model-b';
export { computeMismatchLoss } from '../engine/architecture';
export type { ModelBResult } from '../engine/engine-types';
