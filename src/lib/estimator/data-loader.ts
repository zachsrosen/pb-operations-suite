import { z } from "zod";

import utilitiesData from "./data/utilities.json";
import productionData from "./data/production.json";
import pricingData from "./data/pricing.json";
import incentivesData from "./data/incentives.json";
import { DEFAULT_FALLBACK_KWH_PER_KW_YEAR, DEFAULT_FALLBACK_PRICE_PER_WATT } from "./constants";
import type { ShadeBucket, AddOnPricing, FinancingConfig, IncentiveRecord } from "./types";

// -- Schemas --

const UtilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  states: z.array(z.string()),
  zips: z.array(z.string()).optional(),
  avgBlendedRateUsdPerKwh: z.number().positive(),
});
const UtilitiesSchema = z.array(UtilitySchema);

const ShadeBucketSchema = z.enum(["light", "moderate", "heavy"]);
const ProductionSchema = z.record(z.string(), z.record(ShadeBucketSchema, z.number().positive()));

const PricingSchema = z.object({
  basePricePerWatt: z.record(z.string(), z.number().positive()),
  addOns: z.object({
    evCharger: z.number().nonnegative(),
    panelUpgrade: z.number().nonnegative(),
  }),
  financing: z.object({
    defaultApr: z.number().nonnegative(),
    defaultTermMonths: z.number().int().positive(),
  }),
});

const IncentiveSchema = z.object({
  id: z.string(),
  scope: z.enum(["federal", "state", "utility", "local"]),
  match: z.object({
    state: z.string().optional(),
    zip: z.string().optional(),
    utilityId: z.string().optional(),
  }),
  type: z.enum(["percent", "fixed", "perWatt"]),
  value: z.number(),
  cap: z.number().optional(),
  label: z.string(),
  disclosure: z.string().optional(),
});
const IncentivesSchema = z.array(IncentiveSchema);

// -- Parsed data (fails loudly at import time if JSON drifts) --

const UTILITIES = UtilitiesSchema.parse(utilitiesData);
const PRODUCTION = ProductionSchema.parse(productionData);
const PRICING = PricingSchema.parse(pricingData);
const INCENTIVES = IncentivesSchema.parse(incentivesData);

export type Utility = z.infer<typeof UtilitySchema>;
export type Incentive = z.infer<typeof IncentiveSchema>;

// -- Utility lookups --

export function loadUtilitiesForState(state: string, zip?: string): Utility[] {
  const upper = state.toUpperCase();
  const filtered = UTILITIES.filter((u) => u.states.includes(upper));
  if (!zip) return filtered;
  return [...filtered].sort((a, b) => {
    const aMatch = a.zips?.includes(zip) ? 1 : 0;
    const bMatch = b.zips?.includes(zip) ? 1 : 0;
    return bMatch - aMatch;
  });
}

export function loadUtilityById(id: string): Utility | null {
  return UTILITIES.find((u) => u.id === id) ?? null;
}

// -- Production --

export function loadKwhPerKwYear(state: string, shade: ShadeBucket): number {
  return PRODUCTION[state.toUpperCase()]?.[shade] ?? DEFAULT_FALLBACK_KWH_PER_KW_YEAR;
}

// -- Pricing --

export function loadPricePerWatt(location: string): number {
  return PRICING.basePricePerWatt[location] ?? DEFAULT_FALLBACK_PRICE_PER_WATT;
}

export function loadAddOnPricing(): AddOnPricing {
  return { ...PRICING.addOns };
}

export function loadFinancingDefaults(): FinancingConfig {
  return {
    apr: PRICING.financing.defaultApr,
    termMonths: PRICING.financing.defaultTermMonths,
  };
}

// -- Incentives --

export function loadApplicableIncentives(opts: {
  state: string;
  zip: string;
  utilityId: string;
}): IncentiveRecord[] {
  const state = opts.state.toUpperCase();
  return INCENTIVES.filter((i) => {
    if (i.match.state && i.match.state.toUpperCase() !== state) return false;
    if (i.match.zip && i.match.zip !== opts.zip) return false;
    if (i.match.utilityId && i.match.utilityId !== opts.utilityId) return false;
    return true;
  });
}
