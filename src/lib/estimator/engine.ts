import type { EstimatorInput, EstimatorResult } from "./types";
import { computeAnnualKwh, computeTargetKwh, sizeSystem } from "./sizing";
import { computePricing } from "./pricing";
import { amortize } from "./financing";

const ASSUMPTIONS: string[] = [
  "You are the owner of the home at the address provided",
  "Single-family home, no more than two stories",
  "Roof is structurally sound for the expected system weight",
  "Utility rate held constant (no annual escalation modeling)",
  "Incentive eligibility based on address only — final eligibility confirmed during consult",
  "System size is an estimate — final design may vary after site survey",
];

export function runEstimator(input: EstimatorInput): EstimatorResult {
  const annualKwh = computeAnnualKwh(input.usage, input.utility.kwhRate);
  const targetKwh = computeTargetKwh(annualKwh, input.considerations);

  const { panelCount, systemKwDc, annualProductionKwh } = sizeSystem({
    targetKwh,
    utility: input.utility,
    panelWattage: input.pricing.panelOutput,
    maxSystemSizeWatts: input.pricing.maxSystemSizeWatts,
  });

  const offsetPercent = annualKwh > 0 ? Math.min(100, (annualProductionKwh / annualKwh) * 100) : 0;

  const pricing = computePricing({
    panelCount,
    addOns: input.addOns,
    pricing: input.pricing,
    utility: input.utility,
    includeBattery: false,
  });

  const monthlyPaymentUsd = amortize(
    pricing.finalUsd,
    input.pricing.apr,
    input.pricing.termMonths,
  );

  return {
    systemKwDc,
    panelCount,
    panelWattage: input.pricing.panelOutput,
    annualProductionKwh,
    annualConsumptionKwh: annualKwh,
    offsetPercent,
    pricing: {
      retailUsd: pricing.retailUsd,
      addOnsUsd: pricing.addOnsUsd,
      discountUsd: pricing.discountUsd,
      finalUsd: pricing.finalUsd,
      monthlyPaymentUsd,
      breakdown: pricing.breakdown,
    },
    assumptions: ASSUMPTIONS,
  };
}
