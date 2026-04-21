import type { AddOnPricing, AddOnSelections } from "./types";

export interface RetailInput {
  finalKwDc: number;
  pricePerWatt: number;
  addOns: AddOnSelections;
  addOnPricing: AddOnPricing;
}

export interface RetailResult {
  baseSystemUsd: number;
  addOnsUsd: number;
  retailUsd: number;
}

export function computeRetail(input: RetailInput): RetailResult {
  const baseSystemUsd = input.finalKwDc * 1000 * input.pricePerWatt;
  const addOnsUsd =
    (input.addOns.evCharger ? input.addOnPricing.evCharger : 0) +
    (input.addOns.panelUpgrade ? input.addOnPricing.panelUpgrade : 0);
  const retailUsd = baseSystemUsd + addOnsUsd;
  return { baseSystemUsd, addOnsUsd, retailUsd };
}
