import type { EstimatorInput, EstimatorResult } from "./types";
import { computeAnnualKwh, computeTargetKwh, sizeSystem } from "./sizing";
import { computeRetail } from "./pricing";
import { applyIncentives } from "./incentives";
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
  const annualKwh = computeAnnualKwh(input.usage, input.utility.avgBlendedRateUsdPerKwh);
  const targetKwh = computeTargetKwh(annualKwh, input.considerations);
  const { panelCount, systemKwDc, annualProductionKwh } = sizeSystem({
    targetKwh,
    kWhPerKwYear: input.kWhPerKwYear,
    panelWattage: input.panelWattage,
  });
  const offsetPercent = annualKwh > 0 ? Math.min(100, (annualProductionKwh / annualKwh) * 100) : 0;

  const { baseSystemUsd, addOnsUsd, retailUsd } = computeRetail({
    finalKwDc: systemKwDc,
    pricePerWatt: input.pricePerWatt,
    addOns: input.addOns,
    addOnPricing: input.addOnPricing,
  });

  const { applied: appliedIncentives, totalUsd: incentivesUsd } = applyIncentives({
    incentives: input.incentives,
    retailUsd,
    finalKwDc: systemKwDc,
  });

  const finalUsd = Math.max(0, retailUsd - incentivesUsd);
  const monthlyPaymentUsd = amortize(finalUsd, input.financing.apr, input.financing.termMonths);

  const lineItems: Array<{ label: string; amountUsd: number }> = [];
  if (input.addOns.evCharger) {
    lineItems.push({ label: "EV Charger + install", amountUsd: input.addOnPricing.evCharger });
  }
  if (input.addOns.panelUpgrade) {
    lineItems.push({ label: "Main electrical panel upgrade", amountUsd: input.addOnPricing.panelUpgrade });
  }

  return {
    systemKwDc,
    panelCount,
    panelWattage: input.panelWattage,
    annualProductionKwh,
    annualConsumptionKwh: annualKwh,
    offsetPercent,
    pricing: {
      retailUsd,
      addOnsUsd,
      incentivesUsd,
      finalUsd,
      monthlyPaymentUsd,
      breakdown: {
        baseSystemUsd,
        lineItems,
        appliedIncentives,
      },
    },
    assumptions: ASSUMPTIONS,
  };
}
