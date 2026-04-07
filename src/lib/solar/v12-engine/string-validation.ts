/**
 * Solar Designer V12 Engine — String Voltage Validation
 *
 * Validates a string's voltage against inverter MPPT limits using
 * temperature-corrected Voc (cold) and Vmp (hot) calculations.
 *
 * Property names match ResolvedPanel in engine-types.ts:
 *   tempCoVoc  — Voc temperature coefficient (1/°C, negative)
 *   tempCoPmax — Pmax temperature coefficient (1/°C, negative)
 */
import type { ResolvedPanel, ResolvedInverter } from './types';

export interface StringValidationResult {
  status: 'valid' | 'warning' | 'error';
  vocCold: number;
  vmpHot: number;
  mpptMin: number;
  mpptMax: number;
  message: string | null;
}

/** Threshold for "approaching" warning: within 5% of limit */
const WARNING_MARGIN = 0.05;

export function validateString(
  panelCount: number,
  panel: ResolvedPanel,
  inverter: ResolvedInverter,
  tempMin: number,
  tempMax: number
): StringValidationResult {
  const mpptMin = inverter.mpptMin;
  const mpptMax = inverter.mpptMax;

  if (panelCount === 0) {
    return { status: 'valid', vocCold: 0, vmpHot: 0, mpptMin, mpptMax, message: null };
  }

  const vocCold = panelCount * panel.voc * (1 + panel.tempCoVoc * (tempMin - 25));
  const vmpHot = panelCount * panel.vmp * (1 + panel.tempCoPmax * (tempMax - 25));

  // Error checks
  if (vocCold > mpptMax) {
    return {
      status: 'error',
      vocCold, vmpHot, mpptMin, mpptMax,
      message: `Voc ${vocCold.toFixed(0)}V exceeds MPPT max ${mpptMax}V`,
    };
  }
  if (vmpHot < mpptMin) {
    return {
      status: 'error',
      vocCold, vmpHot, mpptMin, mpptMax,
      message: `Vmp ${vmpHot.toFixed(0)}V below MPPT min ${mpptMin}V`,
    };
  }

  // Warning checks
  if (vocCold > mpptMax * (1 - WARNING_MARGIN)) {
    return {
      status: 'warning',
      vocCold, vmpHot, mpptMin, mpptMax,
      message: `Voc ${vocCold.toFixed(0)}V approaching MPPT max ${mpptMax}V`,
    };
  }
  if (vmpHot < mpptMin * (1 + WARNING_MARGIN)) {
    return {
      status: 'warning',
      vocCold, vmpHot, mpptMin, mpptMax,
      message: `Vmp ${vmpHot.toFixed(0)}V approaching MPPT min ${mpptMin}V`,
    };
  }

  return { status: 'valid', vocCold, vmpHot, mpptMin, mpptMax, message: null };
}
