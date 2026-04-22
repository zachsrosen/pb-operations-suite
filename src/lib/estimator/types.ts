export type QuoteType = "new_install";

export type RoofType = "asphalt_shingle" | "tile" | "metal" | "flat_tpo" | "other";

export type Location = "DTC" | "WESTY" | "COSP" | "CA" | "CAMARILLO";

export type ShadeBucket = "light" | "moderate" | "heavy";

export interface AddressParts {
  street: string;
  city: string;
  state: string;
  zip: string;
  unit?: string;
  lat?: number;
  lng?: number;
  formatted?: string;
  normalizedHash?: string;
}

export interface UsageBill {
  kind: "bill";
  avgMonthlyBillUsd: number;
}

export interface UsageKwh {
  kind: "kwh";
  avgMonthlyKwh: number;
}

export type Usage = UsageBill | UsageKwh;

export interface Considerations {
  planningEv: boolean;
  needsPanelUpgrade: boolean;
  planningHotTub: boolean;
  mayNeedNewRoof: boolean;
}

export interface AddOnSelections {
  evCharger: boolean;
  panelUpgrade: boolean;
}

/**
 * Utility config ported from the original photonbrothers.com estimator.
 * Each utility carries its own production factor and territory-wide
 * derate multiplier (captures regional shade/orientation assumptions).
 */
export interface Utility {
  id: string;
  name: string;
  label: string;
  state: string;
  /** Blended retail rate — used to back-convert monthly bill to kWh. */
  kwhRate: number;
  /** Baseline annual production per 1 kW DC (pre-multiplier). */
  annualProductionFactor: number;
  /** Territory-wide derate; final production = factor × multiplier. */
  productionMultiplier: number;
  /** Flat per-system battery rebate ($0 CO, $3800 for CA PG&E/SCE). */
  batteryRebate: number;
  /** Zips served by this utility. */
  zips: string[];
}

/**
 * Pricing + financing config. `discountMultiplier` is a single blended
 * discount (federal ITC + ops-level adjustment) baked in by sales ops.
 */
export interface PricingConfig {
  panelOutput: number;
  maxSystemSizeWatts: number;
  base: number;
  perPanel: number;
  panelUpgrade: number;
  evWallConnector: number;
  evInstall: number;
  battery: number;
  expansion: number;
  additionalConduit: number;
  discountMultiplier: number;
  apr: number;
  termMonths: number;
}

export interface EstimatorInput {
  quoteType: QuoteType;
  address: AddressParts;
  location: Location;
  utility: Utility;
  usage: Usage;
  home: {
    roofType: RoofType;
    heatPump: boolean;
    /** Optional metadata, not used in math. */
    shade?: ShadeBucket;
  };
  considerations: Considerations;
  addOns: AddOnSelections;
  pricing: PricingConfig;
}

export interface LineItem {
  label: string;
  amountUsd: number;
}

export interface PricingBreakdown {
  baseSystemUsd: number;
  panelsUsd: number;
  lineItems: LineItem[];
  retailUsd: number;
  discountUsd: number;
  batteryRebateUsd: number;
}

export interface EstimatorResult {
  systemKwDc: number;
  panelCount: number;
  panelWattage: number;
  annualProductionKwh: number;
  annualConsumptionKwh: number;
  offsetPercent: number;
  pricing: {
    retailUsd: number;
    addOnsUsd: number;
    discountUsd: number;
    finalUsd: number;
    monthlyPaymentUsd: number;
    breakdown: PricingBreakdown;
  };
  assumptions: string[];
}
