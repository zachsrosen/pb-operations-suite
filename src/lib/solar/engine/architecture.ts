/**
 * Solar Engine — Architecture Validation
 *
 * Ported from V12 architecture.js. Pure validation functions.
 * Skips DOM-only functions (formatMismatchDisplay, getTabVisibility,
 * shouldRunModelB, hydrateArchitectureValidation, validateEquipmentCatalog).
 */

import type { LossProfile } from "./engine-types";

// ── System Derate ────────────────────────────────────────────

/**
 * Calculate system derate factor with architecture-aware mismatch handling.
 *
 * For micro/optimizer architectures, mismatch loss is forced to 0
 * because per-panel MPPT eliminates inter-panel current mismatch.
 *
 * @param lossProfile All values as percentages (e.g. 2.0 = 2% loss)
 * @param architectureType "string" | "micro" | "optimizer"
 * @returns Combined derate factor (e.g. 0.905 for 9.5% total losses)
 */
export function getSystemDerate(
  lossProfile: LossProfile,
  architectureType: "string" | "micro" | "optimizer"
): number {
  const lp = lossProfile;
  const mismatchFactor =
    architectureType === "string" ? 1 - lp.mismatch / 100 : 1.0;

  return (
    (1 - lp.soiling / 100) *
    mismatchFactor *
    (1 - lp.dcWiring / 100) *
    (1 - lp.acWiring / 100) *
    (1 - lp.availability / 100) *
    (1 - lp.lid / 100) *
    (1 - lp.snow / 100) *
    (1 - lp.nameplate / 100)
  );
}

// ── Architecture Validation ──────────────────────────────────

export interface ArchValidation {
  code: string;
  message: string;
}

/**
 * Check if an inverter can be added given the current architecture mode.
 */
export function canAddInverter(
  invSpec: { name: string; architectureType?: string },
  currentArchitecture: "string" | "micro" | "optimizer"
): { allowed: boolean; reason?: string } {
  if (!invSpec.architectureType) {
    return {
      allowed: false,
      reason: `${invSpec.name} is missing architectureType field`,
    };
  }
  if (invSpec.architectureType !== currentArchitecture) {
    return {
      allowed: false,
      reason: `Cannot add ${invSpec.architectureType} inverter — project is in ${currentArchitecture} mode`,
    };
  }
  return { allowed: true };
}

/**
 * Compute mismatch loss percentage with architecture guard.
 *
 * For non-string architectures, always returns 0 (no mismatch).
 */
export function computeMismatchLoss(
  indepTotalRaw: number,
  stringTotalRaw: number,
  architectureType: "string" | "micro" | "optimizer"
): number {
  if (architectureType !== "string") return 0;
  if (indepTotalRaw <= 0) return 0;
  return ((indepTotalRaw - stringTotalRaw) / indepTotalRaw) * 100;
}

// ── Equipment Compatibility ──────────────────────────────────

interface PanelSpec {
  watts: number;
  isc: number;
  vmp: number;
  voc: number;
}

interface MicroSpec {
  dcMax: number;
  maxIsc: number;
  mpptMin: number;
  mpptMax: number;
}

interface OptimizerSpec {
  dcMaxInput: number;
  maxIsc: number;
  inputVoltageMax: number;
  outputVoltageMax: number;
}

interface InverterMpptSpec {
  mpptMin: number;
  mpptMax: number;
}

export interface CompatibilityResult {
  compatible: boolean;
  warnings: ArchValidation[];
  errors: ArchValidation[];
}

/**
 * Validate micro-inverter compatibility with a panel.
 */
export function validateMicroCompatibility(
  panel: PanelSpec,
  micro: MicroSpec
): CompatibilityResult {
  const warnings: ArchValidation[] = [];
  const errors: ArchValidation[] = [];

  if (micro.dcMax > 0 && panel.watts > micro.dcMax) {
    warnings.push({
      code: "DC_OVERSIZE",
      message: `DC oversize: ${panel.watts}W panel > ${micro.dcMax}W micro max`,
    });
  }
  if (micro.maxIsc > 0 && panel.isc > micro.maxIsc) {
    errors.push({
      code: "ISC_EXCEEDED",
      message: `Isc exceeded: ${panel.isc}A panel > ${micro.maxIsc}A micro max`,
    });
  }
  if (micro.mpptMin > 0 && panel.vmp < micro.mpptMin) {
    errors.push({
      code: "VMP_BELOW_MPPT",
      message: `Vmp below MPPT: ${panel.vmp}V < ${micro.mpptMin}V min`,
    });
  }
  if (micro.mpptMax > 0 && panel.vmp > micro.mpptMax) {
    errors.push({
      code: "VMP_ABOVE_MPPT",
      message: `Vmp above MPPT: ${panel.vmp}V > ${micro.mpptMax}V max`,
    });
  }

  return { compatible: errors.length === 0, warnings, errors };
}

/**
 * Validate optimizer compatibility with a panel.
 */
export function validateOptimizerCompatibility(
  panel: PanelSpec,
  optimizer: OptimizerSpec
): CompatibilityResult {
  const warnings: ArchValidation[] = [];
  const errors: ArchValidation[] = [];

  if (optimizer.dcMaxInput > 0 && panel.watts > optimizer.dcMaxInput) {
    warnings.push({
      code: "DC_OVERSIZE",
      message: `DC oversize: ${panel.watts}W panel > ${optimizer.dcMaxInput}W optimizer max`,
    });
  }
  if (optimizer.maxIsc > 0 && panel.isc > optimizer.maxIsc) {
    errors.push({
      code: "ISC_EXCEEDED",
      message: `Isc exceeded: ${panel.isc}A panel > ${optimizer.maxIsc}A optimizer max`,
    });
  }
  if (optimizer.inputVoltageMax > 0 && panel.voc > optimizer.inputVoltageMax) {
    errors.push({
      code: "VOC_EXCEEDED",
      message: `Voc exceeded: ${panel.voc}V panel > ${optimizer.inputVoltageMax}V optimizer max`,
    });
  }

  return { compatible: errors.length === 0, warnings, errors };
}

/**
 * Validate optimizer string voltage against inverter MPPT window.
 */
export function validateOptimizerStringVoltage(
  panelsPerString: number,
  optimizer: OptimizerSpec,
  inverter: InverterMpptSpec
): {
  valid: boolean;
  stringVoltageMax: number;
  warnings: ArchValidation[];
  errors: ArchValidation[];
} {
  const warnings: ArchValidation[] = [];
  const errors: ArchValidation[] = [];
  const stringVoltageMax = panelsPerString * optimizer.outputVoltageMax;

  if (inverter.mpptMax > 0 && stringVoltageMax > inverter.mpptMax) {
    errors.push({
      code: "STRING_VOLTAGE_OVER_MPPT",
      message: `String voltage ${stringVoltageMax.toFixed(0)}V exceeds inverter MPPT max ${inverter.mpptMax}V`,
    });
  }
  if (inverter.mpptMin > 0 && stringVoltageMax < inverter.mpptMin) {
    warnings.push({
      code: "STRING_VOLTAGE_UNDER_MPPT",
      message: `String voltage ${stringVoltageMax.toFixed(0)}V below inverter MPPT min ${inverter.mpptMin}V`,
    });
  }

  return { valid: errors.length === 0, stringVoltageMax, warnings, errors };
}

/**
 * Calculate valid string length range for optimizer systems.
 */
export function getOptimizerStringLengthRange(
  optimizer: OptimizerSpec,
  inverter: InverterMpptSpec,
  defaults: { min: number; max: number } = { min: 6, max: 15 }
): { min: number; max: number } {
  let maxLen = defaults.max;
  let minLen = defaults.min;

  if (optimizer.outputVoltageMax > 0 && inverter.mpptMax > 0) {
    maxLen = Math.min(
      maxLen,
      Math.floor(inverter.mpptMax / optimizer.outputVoltageMax)
    );
  }

  if (optimizer.outputVoltageMax > 0 && inverter.mpptMin > 0) {
    minLen = Math.max(
      minLen,
      Math.ceil(inverter.mpptMin / optimizer.outputVoltageMax)
    );
  }

  maxLen = Math.max(1, maxLen);
  minLen = Math.min(minLen, maxLen);

  return { min: minLen, max: maxLen };
}
