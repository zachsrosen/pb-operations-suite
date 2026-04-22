import { z } from "zod";

import utilitiesData from "./data/utilities.json";
import pricingData from "./data/pricing.json";
import type { Utility, PricingConfig } from "./types";

const UtilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  state: z.string(),
  kwhRate: z.number().nonnegative(),
  annualProductionFactor: z.number().positive(),
  productionMultiplier: z.number().positive(),
  batteryRebate: z.number().nonnegative(),
  zips: z.array(z.string()),
});
const UtilitiesSchema = z.array(UtilitySchema);

const PricingSchema = z.object({
  panelOutput: z.number().positive(),
  maxSystemSizeWatts: z.number().positive(),
  base: z.number().nonnegative(),
  perPanel: z.number().nonnegative(),
  panelUpgrade: z.number().nonnegative(),
  evWallConnector: z.number().nonnegative(),
  evInstall: z.number().nonnegative(),
  battery: z.number().nonnegative(),
  expansion: z.number().nonnegative(),
  additionalConduit: z.number().nonnegative(),
  discountMultiplier: z.number().positive().max(1),
  apr: z.number().nonnegative(),
  termMonths: z.number().int().positive(),
});

const UTILITIES: Utility[] = UtilitiesSchema.parse(utilitiesData);
const PRICING: PricingConfig = PricingSchema.parse(pricingData);

export function loadAllUtilities(): Utility[] {
  return UTILITIES;
}

export function loadUtilityById(id: string): Utility | null {
  return UTILITIES.find((u) => u.id === id) ?? null;
}

export function loadUtilitiesForState(state: string, zip?: string): Utility[] {
  const upper = state.toUpperCase();
  const filtered = UTILITIES.filter((u) => u.state === upper);
  return [...filtered].sort((a, b) => {
    const aCovers = zip && a.zips.includes(zip) ? 1 : 0;
    const bCovers = zip && b.zips.includes(zip) ? 1 : 0;
    if (aCovers !== bCovers) return bCovers - aCovers;
    if (a.name === "Other") return 1;
    if (b.name === "Other") return -1;
    return a.label.localeCompare(b.label);
  });
}

export function loadUtilityForZip(zip: string): Utility | null {
  const trimmed = String(zip ?? "").trim().slice(0, 5);
  return UTILITIES.find((u) => u.zips.includes(trimmed)) ?? null;
}

export function loadPricing(): PricingConfig {
  return PRICING;
}

export function effectiveKwhPerKwYear(
  utility: Pick<Utility, "annualProductionFactor" | "productionMultiplier">,
): number {
  return utility.annualProductionFactor * utility.productionMultiplier;
}

export type { Utility, PricingConfig };
