export type QuoteType = "new_install";

export type ShadeBucket = "light" | "moderate" | "heavy";

export type RoofType = "asphalt_shingle" | "tile" | "metal" | "flat_tpo" | "other";

export type Location = "DTC" | "WESTY" | "COSP" | "CA" | "CAMARILLO";

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

export interface AddOnPricing {
  evCharger: number;
  panelUpgrade: number;
}

export interface FinancingConfig {
  apr: number;
  termMonths: number;
}

export interface IncentiveRecord {
  id: string;
  scope: "federal" | "state" | "utility" | "local";
  type: "percent" | "fixed" | "perWatt";
  value: number;
  cap?: number;
  label: string;
  disclosure?: string;
}

export interface UtilityRef {
  id: string;
  avgBlendedRateUsdPerKwh: number;
}

export interface EstimatorInput {
  quoteType: QuoteType;
  address: AddressParts;
  location: Location;
  utility: UtilityRef;
  usage: Usage;
  home: {
    roofType: RoofType;
    shade: ShadeBucket;
    heatPump: boolean;
  };
  considerations: Considerations;
  addOns: AddOnSelections;
  // Engine-internal: the caller resolves these from JSON data files before calling runEstimator.
  panelWattage: number;
  pricePerWatt: number;
  kWhPerKwYear: number;
  incentives: IncentiveRecord[];
  addOnPricing: AddOnPricing;
  financing: FinancingConfig;
}

export interface AppliedIncentive {
  id: string;
  label: string;
  amountUsd: number;
}

export interface PricingBreakdown {
  baseSystemUsd: number;
  lineItems: Array<{ label: string; amountUsd: number }>;
  appliedIncentives: AppliedIncentive[];
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
    incentivesUsd: number;
    finalUsd: number;
    monthlyPaymentUsd: number;
    breakdown: PricingBreakdown;
  };
  assumptions: string[];
}
