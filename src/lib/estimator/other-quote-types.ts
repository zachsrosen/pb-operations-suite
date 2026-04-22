/**
 * Engine helpers for the four non-new-install quote types. Shares the
 * same pricing config (base, perPanel, discountMultiplier, battery,
 * expansion, evWallConnector, evInstall, additionalConduit) as the
 * New Installation flow — they were all ported from the original's
 * `math` object.
 */

import type { PricingConfig, Utility } from "./types";
import { amortize } from "./financing";

export interface EvChargerInput {
  pricing: PricingConfig;
  /** Extra conduit beyond standard run, in feet. */
  extraConduitFeet: number;
}

export interface EvChargerResult {
  retailUsd: number;
  finalUsd: number;
  monthlyPaymentUsd: number;
  lineItems: Array<{ label: string; amountUsd: number }>;
}

/** EV charger: Tesla universal wall connector + install + optional extra conduit. */
export function computeEvChargerQuote(input: EvChargerInput): EvChargerResult {
  const { pricing, extraConduitFeet } = input;
  const conduitUsd = Math.max(0, extraConduitFeet) * pricing.additionalConduit;
  const lineItems = [
    { label: "Tesla universal wall connector", amountUsd: pricing.evWallConnector },
    { label: "Install + 10 ft standard conduit", amountUsd: pricing.evInstall },
  ];
  if (conduitUsd > 0) {
    lineItems.push({ label: `Additional conduit (${extraConduitFeet} ft)`, amountUsd: conduitUsd });
  }
  const retailUsd = lineItems.reduce((s, li) => s + li.amountUsd, 0);
  // EV-only quotes don't take the federal-ITC-baked discountMultiplier since
  // standalone EV chargers aren't ITC-eligible; price shown is retail.
  const finalUsd = retailUsd;
  const monthlyPaymentUsd = amortize(finalUsd, pricing.apr, pricing.termMonths);
  return { retailUsd, finalUsd, monthlyPaymentUsd, lineItems };
}

export interface BatteryInput {
  pricing: PricingConfig;
  utility: Pick<Utility, "batteryRebate">;
  /** Number of home backup batteries (e.g. Powerwall). */
  batteryCount: number;
}

export interface BatteryResult {
  retailUsd: number;
  discountUsd: number;
  batteryRebateUsd: number;
  finalUsd: number;
  monthlyPaymentUsd: number;
  lineItems: Array<{ label: string; amountUsd: number }>;
}

/** Home backup battery only: $13,500 per battery × count − utility rebate. */
export function computeBatteryQuote(input: BatteryInput): BatteryResult {
  const { pricing, utility, batteryCount } = input;
  const count = Math.max(1, Math.floor(batteryCount));
  const retailUsd = pricing.battery * count;
  const postDiscountUsd = retailUsd * pricing.discountMultiplier;
  const discountUsd = retailUsd - postDiscountUsd;
  // CA utilities pay a per-system battery rebate (PG&E / SCE = $3,800).
  const batteryRebateUsd = utility.batteryRebate * (count > 0 ? 1 : 0);
  const finalUsd = Math.max(0, postDiscountUsd - batteryRebateUsd);
  const monthlyPaymentUsd = amortize(finalUsd, pricing.apr, pricing.termMonths);
  const lineItems = [
    {
      label: `Home backup battery × ${count}`,
      amountUsd: pricing.battery * count,
    },
  ];
  return { retailUsd, discountUsd, batteryRebateUsd, finalUsd, monthlyPaymentUsd, lineItems };
}

export interface SystemExpansionInput {
  pricing: PricingConfig;
  /** Panels to add to the existing system. */
  addedPanelCount: number;
}

export interface SystemExpansionResult {
  retailUsd: number;
  discountUsd: number;
  finalUsd: number;
  monthlyPaymentUsd: number;
  systemKwDcAdded: number;
  panelCount: number;
  lineItems: Array<{ label: string; amountUsd: number }>;
}

/**
 * System expansion: adds panels to an existing system. Pricing uses the
 * dedicated `expansion` base plus `perPanel × count` from ops's math.
 */
export function computeSystemExpansionQuote(input: SystemExpansionInput): SystemExpansionResult {
  const { pricing, addedPanelCount } = input;
  const panelCount = Math.max(1, Math.floor(addedPanelCount));
  const systemKwDcAdded = (panelCount * pricing.panelOutput) / 1000;
  const retailUsd = pricing.expansion + pricing.perPanel * panelCount;
  const postDiscountUsd = retailUsd * pricing.discountMultiplier;
  const discountUsd = retailUsd - postDiscountUsd;
  const finalUsd = Math.max(0, postDiscountUsd);
  const monthlyPaymentUsd = amortize(finalUsd, pricing.apr, pricing.termMonths);
  const lineItems = [
    { label: "Expansion base (design + permit + labor)", amountUsd: pricing.expansion },
    { label: `Added panels × ${panelCount}`, amountUsd: pricing.perPanel * panelCount },
  ];
  return {
    retailUsd,
    discountUsd,
    finalUsd,
    monthlyPaymentUsd,
    systemKwDcAdded,
    panelCount,
    lineItems,
  };
}
