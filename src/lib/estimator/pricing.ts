import type {
  AddOnSelections,
  LineItem,
  PricingBreakdown,
  PricingConfig,
  Utility,
} from "./types";

export interface PricingInput {
  panelCount: number;
  addOns: AddOnSelections;
  pricing: PricingConfig;
  utility: Pick<Utility, "batteryRebate">;
  includeBattery?: boolean;
}

export interface PricingResult {
  retailUsd: number;
  addOnsUsd: number;
  discountUsd: number;
  batteryRebateUsd: number;
  finalUsd: number;
  breakdown: PricingBreakdown;
}

/**
 * Pricing model ported from the original estimator:
 *
 *   retail   = base + perPanel × panelCount + ∑ add-ons
 *   final    = retail × discountMultiplier − batteryRebate
 */
export function computePricing(input: PricingInput): PricingResult {
  const { pricing, panelCount, addOns, utility } = input;
  const panelsUsd = pricing.perPanel * panelCount;
  const baseSystemUsd = pricing.base + panelsUsd;

  const lineItems: LineItem[] = [];
  let addOnsUsd = 0;

  if (addOns.evCharger) {
    const chargerCost = pricing.evWallConnector + pricing.evInstall;
    lineItems.push({
      label: "EV charger (Tesla universal wall connector + install)",
      amountUsd: chargerCost,
    });
    addOnsUsd += chargerCost;
  }
  if (addOns.panelUpgrade) {
    lineItems.push({ label: "Main electrical panel upgrade", amountUsd: pricing.panelUpgrade });
    addOnsUsd += pricing.panelUpgrade;
  }
  if (input.includeBattery) {
    lineItems.push({ label: "Home backup battery", amountUsd: pricing.battery });
    addOnsUsd += pricing.battery;
  }

  const retailUsd = baseSystemUsd + addOnsUsd;
  const postDiscountUsd = retailUsd * pricing.discountMultiplier;
  const discountUsd = retailUsd - postDiscountUsd;
  const batteryRebateUsd = input.includeBattery ? utility.batteryRebate : 0;
  const finalUsd = Math.max(0, postDiscountUsd - batteryRebateUsd);

  return {
    retailUsd,
    addOnsUsd,
    discountUsd,
    batteryRebateUsd,
    finalUsd,
    breakdown: {
      baseSystemUsd,
      panelsUsd,
      lineItems,
      retailUsd,
      discountUsd,
      batteryRebateUsd,
    },
  };
}
