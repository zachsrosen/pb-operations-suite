import type { Considerations, Usage } from "./types";
import { EV_ADD_KWH_PER_YEAR, HOT_TUB_ADD_KWH_PER_YEAR } from "./constants";

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
  kWhPerKwYear: number;
  panelWattage: number;
}

export interface SizingResult {
  panelCount: number;
  systemKwDc: number;
  annualProductionKwh: number;
}

export function sizeSystem(input: SizingInput): SizingResult {
  const { targetKwh, kWhPerKwYear, panelWattage } = input;
  if (targetKwh <= 0 || kWhPerKwYear <= 0 || panelWattage <= 0) {
    return { panelCount: 0, systemKwDc: 0, annualProductionKwh: 0 };
  }
  const systemKwDcTarget = targetKwh / kWhPerKwYear;
  const panelCount = Math.ceil((systemKwDcTarget * 1000) / panelWattage);
  const systemKwDc = (panelCount * panelWattage) / 1000;
  const annualProductionKwh = systemKwDc * kWhPerKwYear;
  return { panelCount, systemKwDc, annualProductionKwh };
}
