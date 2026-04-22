import type { Considerations, Usage, Utility } from "./types";
import { EV_ADD_KWH_PER_YEAR, HOT_TUB_ADD_KWH_PER_YEAR } from "./constants";
import { effectiveKwhPerKwYear } from "./data-loader";

export function computeAnnualKwh(usage: Usage, utilityRateUsdPerKwh: number): number {
  if (usage.kind === "bill") {
    if (utilityRateUsdPerKwh <= 0) return 0;
    return (usage.avgMonthlyBillUsd * 12) / utilityRateUsdPerKwh;
  }
  return usage.avgMonthlyKwh * 12;
}

export function computeTargetKwh(annualKwh: number, considerations: Considerations): number {
  let target = annualKwh;
  if (considerations.planningEv) target += EV_ADD_KWH_PER_YEAR;
  if (considerations.planningHotTub) target += HOT_TUB_ADD_KWH_PER_YEAR;
  return target;
}

export interface SizingInput {
  targetKwh: number;
  utility: Pick<Utility, "annualProductionFactor" | "productionMultiplier">;
  panelWattage: number;
  maxSystemSizeWatts: number;
}

export interface SizingResult {
  panelCount: number;
  systemKwDc: number;
  annualProductionKwh: number;
}

export function sizeSystem(input: SizingInput): SizingResult {
  const kwhPerKwYear = effectiveKwhPerKwYear(input.utility);
  if (input.targetKwh <= 0 || kwhPerKwYear <= 0 || input.panelWattage <= 0) {
    return { panelCount: 0, systemKwDc: 0, annualProductionKwh: 0 };
  }
  const systemKwDcTarget = input.targetKwh / kwhPerKwYear;
  const uncapped = Math.ceil((systemKwDcTarget * 1000) / input.panelWattage);
  const maxPanelCount = Math.floor(input.maxSystemSizeWatts / input.panelWattage);
  const panelCount = Math.min(uncapped, maxPanelCount);
  const systemKwDc = (panelCount * input.panelWattage) / 1000;
  const annualProductionKwh = systemKwDc * kwhPerKwYear;
  return { panelCount, systemKwDc, annualProductionKwh };
}
