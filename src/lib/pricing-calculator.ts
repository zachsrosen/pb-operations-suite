/**
 * OpenSolar Pricing Calculator
 *
 * Reverse-engineered from OpenSolar's "Costing Scheme Itemized" (ID 10059)
 * and verified against 8+ sold projects with exact matches.
 *
 * Formula: Component Costs + Cost Scheme Overhead + Battery Labour + Adders
 *   → Total COGS → COGS × (1 + markup%) = Base Price
 *   → Fixed Adders → PE Percentage = Final Price
 */

// ---------------------------------------------------------------------------
// Equipment catalog (from OpenSolar component_overrides / activations)
// ---------------------------------------------------------------------------

export interface EquipmentItem {
  code: string;
  label: string;
  category: "module" | "inverter" | "battery" | "other";
  costPerUnit: number;
  wattsPerUnit?: number; // only for modules
  batteryLabour?: number; // only for batteries
  /** If true, cost is NOT included in COGS (e.g. Backup Switch is bundled) */
  bundled?: boolean;
  /** PE Domestic Content qualification — true if product meets IRA DC threshold */
  dcQualified?: boolean;
}

export const EQUIPMENT_CATALOG: EquipmentItem[] = [
  // Modules
  {
    code: "HiN-T440NF(BK)",
    label: "Hyundai 440W (Black)",
    category: "module",
    costPerUnit: 305,
    wattsPerUnit: 440,
  },
  {
    code: "SEG-440-BTD-BG",
    label: "Silfab 440W (Black/Gold)",
    category: "module",
    costPerUnit: 305,
    wattsPerUnit: 440,
  },
  {
    code: "SEG-430-BTD-BG",
    label: "Silfab 430W (Black/Gold)",
    category: "module",
    costPerUnit: 300,
    wattsPerUnit: 430,
  },

  // Inverters
  {
    code: "Tesla 7.6kW Inverter",
    label: "Tesla 7.6kW Inverter",
    category: "inverter",
    costPerUnit: 1200,
  },
  {
    code: "Tesla 5.0kW Inverter",
    label: "Tesla 5.0kW Inverter",
    category: "inverter",
    costPerUnit: 1200,
  },
  {
    code: "Tesla 3.8kW Inverter",
    label: "Tesla 3.8kW Inverter",
    category: "inverter",
    costPerUnit: 1200,
  },
  {
    code: "IQ8MC-72-x-ACM-US",
    label: "Enphase IQ8MC Micro",
    category: "inverter",
    costPerUnit: 160,
  },
  {
    code: "IQ8X-80-x-ACM-US",
    label: "Enphase IQ8X Micro",
    category: "inverter",
    costPerUnit: 158,
  },
  {
    code: "IQ8A-72-2-x-ACM-US",
    label: "Enphase IQ8A Micro",
    category: "inverter",
    costPerUnit: 143,
  },
  {
    code: "IQ8M-72-x-ACM-US",
    label: "Enphase IQ8M Micro",
    category: "inverter",
    costPerUnit: 150,
  },

  // Batteries
  {
    code: "Tesla Powerwall 3",
    label: "Tesla Powerwall 3",
    category: "battery",
    costPerUnit: 7700,
    batteryLabour: 2600,
    dcQualified: true, // 60.5% DC per PE AVL — above 55% BESS threshold
  },
  {
    code: "Tesla Powerwall 3 Expansion Pack",
    label: "PW3 Expansion Pack",
    category: "battery",
    costPerUnit: 5000,
    batteryLabour: 1900,
    dcQualified: true, // 60.5% DC per PE AVL
  },

  // Other equipment
  {
    code: "Gen 3 Wall Connector",
    label: "Tesla Wall Connector (Gen 3)",
    category: "other",
    costPerUnit: 600,
  },
  {
    code: "Tesla Backup Switch",
    label: "Tesla Backup Switch (bundled)",
    category: "other",
    costPerUnit: 305,
    bundled: true, // NOT counted in COGS — bundled with battery install
  },
];

// ---------------------------------------------------------------------------
// Pricing schemes
// ---------------------------------------------------------------------------

export interface PricingScheme {
  id: string;
  label: string;
  markupPct: number;
}

export const PRICING_SCHEMES: PricingScheme[] = [
  { id: "base", label: "Base (Colorado)", markupPct: 40 },
  { id: "ventura", label: "Ventura", markupPct: 36 },
  { id: "bay-area", label: "Bay Area", markupPct: 50 },
  { id: "dnr", label: "D&R", markupPct: 30 },
  { id: "off-grid", label: "Off Grid Homes", markupPct: 65 },
];

// ---------------------------------------------------------------------------
// Cost scheme rates (from Costing Scheme Itemized, ID 10059)
// ---------------------------------------------------------------------------

export const COST_SCHEME = {
  // COGS per-watt
  rackingPerWatt: 0.15,
  bosPerWatt: 0.15,

  // Labour per-watt
  labourPerWatt: 0.55,

  // Acquisition
  leadGenPerSystem: 300,
  leadGenPerWatt: 0.1,
  salaryPerSystem: 100,
  commissionPctOfCogsAndLabour: 0.05, // 5% of (COGS + Labour)
  presalePerWatt: 0.01,

  // Fulfillment
  pmPerSystem: 1000,
  designPerSystem: 350,
  permitPerSystem: 500,

  // Battery misc — $200 for battery-only systems or systems with 2+ batteries
  batteryMisc: 200,
} as const;

// ---------------------------------------------------------------------------
// Roof / site adders (Extra Costs in OpenSolar)
// ---------------------------------------------------------------------------

export interface RoofType {
  id: string;
  label: string;
  costPerSystem: number;
  costPerWatt: number;
}

export const ROOF_TYPES: RoofType[] = [
  { id: "comp", label: "Comp/Asphalt Shingle", costPerSystem: 0, costPerWatt: 0 },
  { id: "flat", label: "Flat Membrane", costPerSystem: 0, costPerWatt: 0.35 },
  { id: "tile", label: "Tile Concrete", costPerSystem: 3500, costPerWatt: 0.8 },
  { id: "shake", label: "Wood Shake", costPerSystem: 0, costPerWatt: 0.35 },
  { id: "metal", label: "Metal Corrugated", costPerSystem: 0, costPerWatt: 0.35 },
];

export interface StoreyAdder {
  id: string;
  label: string;
  costPerWatt: number;
}

export const STOREY_ADDERS: StoreyAdder[] = [
  { id: "1", label: "1 Story", costPerWatt: 0 },
  { id: "2", label: "2 Stories", costPerWatt: 0.05 },
  { id: "3+", label: "3+ Stories", costPerWatt: 0.83 },
];

export interface PitchAdder {
  id: string;
  label: string;
  minSlope: number;
  costPerWatt: number;
}

export const PITCH_ADDERS: PitchAdder[] = [
  { id: "none", label: "Standard (< 34°)", minSlope: 0, costPerWatt: 0 },
  { id: "steep1", label: "Steep (34°–44°)", minSlope: 34, costPerWatt: 0.35 },
  { id: "steep2", label: "Very Steep (> 44°)", minSlope: 44, costPerWatt: 0.5 },
];

// ---------------------------------------------------------------------------
// Org-level adders
// ---------------------------------------------------------------------------

export interface OrgAdder {
  id: string;
  label: string;
  type: "percentage" | "fixed";
  /** For percentage: applied as multiplier (e.g. -30 → ×0.70). For fixed: dollar amount */
  value: number;
  autoApply: boolean;
  description?: string;
}

export const ORG_ADDERS: OrgAdder[] = [
  {
    id: "pe",
    label: "Prepaid Energy Service Agreement",
    type: "percentage",
    value: -30,
    autoApply: true,
    description: "PE deal — customer price is 70% of base. HubSpot tracks full PB revenue.",
  },
  {
    id: "q1-2026",
    label: "Q1 2026 $1,000 Off Solar",
    type: "fixed",
    value: -1000,
    autoApply: false,
  },
  {
    id: "soco",
    label: "SoCo Regional Discount",
    type: "fixed",
    value: -1500,
    autoApply: false,
  },
];

// ---------------------------------------------------------------------------
// PE (Participate Energy) lease factor calculation
// ---------------------------------------------------------------------------

export const PE_LEASE = {
  baselineFactor: 1.4285714, // 10/7 — constant per PE Residential Pricing Policy v3
  dcBonus: 0.1098901, // adjustment when DC qualifies
  noBonusPenalty: -0.0952381, // adjustment when no DC and no EC
} as const;

/** Brands whose modules meet IRA domestic content threshold (50% for solar). Currently none qualify. */
export const DC_QUALIFYING_MODULE_BRANDS: string[] = [];

/** Brands whose batteries meet IRA domestic content threshold (55% for BESS). */
export const DC_QUALIFYING_BATTERY_BRANDS: string[] = ["Tesla"];

export type PeSystemType = "solar+battery" | "solar" | "battery";

/**
 * Determine the lease factor adjustment based on ITC bonus qualifications.
 * Source: PE Residential Pricing Policy, Schedule 1 — Lease Factor Adjustments
 */
export function calcLeaseFactorAdjustment(
  systemType: PeSystemType,
  solarDC: boolean,
  batteryDC: boolean,
  energyCommunity: boolean,
): number {
  if (systemType === "solar+battery") {
    // Both DC must qualify for bonus
    if (solarDC && batteryDC) return PE_LEASE.dcBonus;
    if (solarDC || batteryDC || energyCommunity) return 0;
    return PE_LEASE.noBonusPenalty;
  }
  if (systemType === "solar") {
    if (solarDC) return PE_LEASE.dcBonus;
    if (energyCommunity) return 0;
    return PE_LEASE.noBonusPenalty;
  }
  // battery only
  if (batteryDC) return PE_LEASE.dcBonus;
  if (energyCommunity) return 0;
  return PE_LEASE.noBonusPenalty;
}

// ---------------------------------------------------------------------------
// Deal import helpers
// ---------------------------------------------------------------------------

/** Map normalized PB location → pricing scheme ID */
export const LOCATION_SCHEME: Record<string, string> = {
  Westminster: "base",
  Centennial: "base",
  "Colorado Springs": "base",
  "San Luis Obispo": "ventura",
  Camarillo: "ventura",
};

/** Token sets for fuzzy matching line items to catalog equipment */
const MATCH_TOKENS: Array<{ code: string; category: string; tokens: string[] }> =
  EQUIPMENT_CATALOG.map((e) => ({
    code: e.code,
    category: e.category,
    tokens: e.code
      .toLowerCase()
      .replace(/[()]/g, "")
      .split(/[\s/]+/)
      .filter((t) => t.length > 2),
  }));

/** Map HubSpot product_category to our internal category */
const catMap: Record<string, string> = {
  module: "module",
  solar_panel: "module",
  inverter: "inverter",
  battery: "battery",
  energy_storage: "battery",
  ev_charger: "other",
  other: "other",
};

/**
 * Match a HubSpot line item to an EQUIPMENT_CATALOG entry.
 * Returns the equipment code or null if no match found.
 *
 * Strategy:
 * 1. Aspirational SKU match against code field.
 * 2. Category-aware fuzzy name match — line item name/manufacturer must
 *    contain enough tokens from the catalog code.
 */
export function matchLineItemToEquipment(
  name: string,
  sku: string,
  category: string,
  manufacturer: string,
): string | null {
  const haystack = `${name} ${manufacturer}`.toLowerCase();

  const mappedCat = catMap[category.toLowerCase()] || "";

  // Try SKU exact match first (rarely succeeds but cheap)
  const skuMatch = EQUIPMENT_CATALOG.find(
    (e) => sku && e.code.toLowerCase() === sku.toLowerCase(),
  );
  if (skuMatch) return skuMatch.code;

  // Fuzzy name match — find catalog item with highest token overlap
  let bestCode: string | null = null;
  let bestScore = 0;

  for (const entry of MATCH_TOKENS) {
    // If we know the category, filter to matching category
    if (mappedCat && entry.category !== mappedCat) continue;

    const matched = entry.tokens.filter((t) => haystack.includes(t));
    // Require at least 2 tokens or all tokens if only 1
    const score = matched.length;
    const threshold = entry.tokens.length === 1 ? 1 : 2;
    if (score >= threshold && score > bestScore) {
      bestScore = score;
      bestCode = entry.code;
    }
  }

  return bestCode;
}

// ---------------------------------------------------------------------------
// Calculator input / output types
// ---------------------------------------------------------------------------

export interface EquipmentSelection {
  code: string;
  qty: number;
}

export interface CalcInput {
  modules: EquipmentSelection[];
  inverters: EquipmentSelection[];
  batteries: EquipmentSelection[];
  otherEquip: EquipmentSelection[];

  pricingSchemeId: string; // key into PRICING_SCHEMES

  roofTypeId: string; // key into ROOF_TYPES
  storeyId: string; // key into STOREY_ADDERS
  pitchId: string; // key into PITCH_ADDERS

  /** Watts affected by pitch adder (defaults to total system watts if not specified) */
  pitchWatts?: number;

  /** Active org-level adder IDs */
  activeAdderIds: string[];

  /** Custom fixed adder amount (e.g. -500 for a one-off discount) */
  customFixedAdder: number;

  /** PE: Is the project in an IRA Energy Community? */
  energyCommunity?: boolean;
}

export interface CalcBreakdown {
  // Equipment costs
  moduleCost: number;
  inverterCost: number;
  batteryCost: number;
  otherCost: number;
  batteryMisc: number;
  racking: number;
  bos: number;
  cogs: number;

  // Extra costs (roof/site)
  roofAdder: number;
  storeyAdder: number;
  pitchAdder: number;
  extraCosts: number;

  // Labour
  labourGeneral: number;
  labourBatteries: number;
  labour: number;

  // Acquisition
  leadGen: number;
  salary: number;
  commission: number;
  presale: number;
  acquisition: number;

  // Fulfillment
  fulfillment: number;

  // Totals
  totalCosts: number;
  markupPct: number;
  basePrice: number;

  // Adders
  fixedAdderTotal: number;
  fixedAdderDetails: { label: string; amount: number }[];
  peActive: boolean;
  pePct: number;
  peAmount: number;

  // Final
  finalPrice: number; // What customer pays (OpenSolar price)
  hsAmount: number; // What goes in HubSpot (full PB revenue for PE deals)

  // PE Revenue (populated when PE active)
  peSystemType: PeSystemType | null;
  peSolarDC: boolean;
  peBatteryDC: boolean;
  peEnergyCommunnity: boolean;
  peLeaseFactor: number;
  peLeaseAdjustment: number;
  peLeaseCustomerAmount: number; // PE's calculated customer share (EPC ÷ leaseFactor)
  pePaymentToInstaller: number; // PE pays PB this total (EPC − leaseCustomerAmount)
  pePaymentIC: number; // 2/3 at Inspection Complete
  pePaymentPC: number; // 1/3 at Project Complete
  peTotalRevenue: number; // actual customer payment (flat 70%) + PE payment

  // System info
  totalWatts: number;
  totalPanels: number;
  totalBatteries: number;
  isBatteryOnly: boolean;
}

// ---------------------------------------------------------------------------
// Calculator function
// ---------------------------------------------------------------------------

function findEquipment(code: string): EquipmentItem | undefined {
  return EQUIPMENT_CATALOG.find((e) => e.code === code);
}

export function calcPrice(input: CalcInput): CalcBreakdown {
  const scheme = PRICING_SCHEMES.find((s) => s.id === input.pricingSchemeId) ?? PRICING_SCHEMES[0];
  const roofType = ROOF_TYPES.find((r) => r.id === input.roofTypeId) ?? ROOF_TYPES[0];
  const storey = STOREY_ADDERS.find((s) => s.id === input.storeyId) ?? STOREY_ADDERS[0];
  const pitch = PITCH_ADDERS.find((p) => p.id === input.pitchId) ?? PITCH_ADDERS[0];

  // --- Equipment costs ---
  let moduleCost = 0;
  let totalWatts = 0;
  let totalPanels = 0;
  for (const sel of input.modules) {
    const eq = findEquipment(sel.code);
    if (!eq) continue;
    moduleCost += eq.costPerUnit * sel.qty;
    totalWatts += (eq.wattsPerUnit ?? 0) * sel.qty;
    totalPanels += sel.qty;
  }

  let inverterCost = 0;
  for (const sel of input.inverters) {
    const eq = findEquipment(sel.code);
    if (!eq) continue;
    inverterCost += eq.costPerUnit * sel.qty;
  }

  let batteryCost = 0;
  let labourBatteries = 0;
  let totalBatteries = 0;
  for (const sel of input.batteries) {
    const eq = findEquipment(sel.code);
    if (!eq) continue;
    if (!eq.bundled) {
      batteryCost += eq.costPerUnit * sel.qty;
    }
    labourBatteries += (eq.batteryLabour ?? 0) * sel.qty;
    totalBatteries += sel.qty;
  }

  let otherCost = 0;
  for (const sel of input.otherEquip) {
    const eq = findEquipment(sel.code);
    if (!eq || eq.bundled) continue;
    otherCost += eq.costPerUnit * sel.qty;
  }

  const isBatteryOnly = totalPanels === 0 && totalBatteries > 0;
  const batteryMisc =
    (isBatteryOnly || totalBatteries >= 2) && totalBatteries > 0
      ? COST_SCHEME.batteryMisc
      : 0;

  const racking = totalWatts * COST_SCHEME.rackingPerWatt;
  const bos = totalWatts * COST_SCHEME.bosPerWatt;

  const cogs = moduleCost + inverterCost + batteryCost + otherCost + batteryMisc + racking + bos;

  // --- Extra costs (roof/site adders) ---
  const roofAdder = roofType.costPerSystem + totalWatts * roofType.costPerWatt;
  const storeyAdder = totalWatts * storey.costPerWatt;
  const pitchWatts = input.pitchWatts ?? totalWatts;
  const pitchAdder = pitchWatts * pitch.costPerWatt;
  const extraCosts = roofAdder + storeyAdder + pitchAdder;

  // --- Labour ---
  const labourGeneral = totalWatts * COST_SCHEME.labourPerWatt;
  const labour = labourGeneral + labourBatteries;

  // --- Acquisition ---
  const leadGen = COST_SCHEME.leadGenPerSystem + totalWatts * COST_SCHEME.leadGenPerWatt;
  const salary = COST_SCHEME.salaryPerSystem;
  // Commission base: COGS (excl. extra costs) + Labour
  const commission = (cogs + labour) * COST_SCHEME.commissionPctOfCogsAndLabour;
  const presale = totalWatts * COST_SCHEME.presalePerWatt;
  const acquisition = leadGen + salary + commission + presale;

  // --- Fulfillment ---
  const fulfillment =
    COST_SCHEME.pmPerSystem + COST_SCHEME.designPerSystem + COST_SCHEME.permitPerSystem;

  // --- Total costs ---
  const totalCosts = cogs + extraCosts + labour + acquisition + fulfillment;

  // --- Markup ---
  const markupPct = scheme.markupPct;
  const basePrice = totalCosts * (1 + markupPct / 100);

  // --- Adders ---
  const fixedAdderDetails: { label: string; amount: number }[] = [];

  for (const adderId of input.activeAdderIds) {
    const adder = ORG_ADDERS.find((a) => a.id === adderId);
    if (!adder || adder.type !== "fixed") continue;
    fixedAdderDetails.push({ label: adder.label, amount: adder.value });
  }

  if (input.customFixedAdder !== 0) {
    fixedAdderDetails.push({ label: "Custom Adder", amount: input.customFixedAdder });
  }

  const fixedAdderTotal = fixedAdderDetails.reduce((sum, a) => sum + a.amount, 0);
  const priceAfterFixed = basePrice + fixedAdderTotal;

  // --- PE Lease Factor ---
  const peActive = input.activeAdderIds.includes("pe");

  // Auto-derive DC qualifications from selected equipment
  const selectedModuleItems = input.modules.map((s) => findEquipment(s.code)).filter(Boolean);
  const selectedInverterItems = input.inverters.map((s) => findEquipment(s.code)).filter(Boolean);
  const selectedBatteryItems = input.batteries.map((s) => findEquipment(s.code)).filter(Boolean);

  const peSolarDC =
    selectedModuleItems.length > 0 &&
    selectedModuleItems.every((e) => e!.dcQualified) &&
    (selectedInverterItems.length === 0 || selectedInverterItems.every((e) => e!.dcQualified));
  const peBatteryDC =
    selectedBatteryItems.length > 0 &&
    selectedBatteryItems.every((e) => e!.dcQualified);
  const peEnergyCommunnity = input.energyCommunity ?? false;

  const peSystemType: PeSystemType | null =
    totalPanels > 0 && totalBatteries > 0
      ? "solar+battery"
      : totalPanels > 0
        ? "solar"
        : totalBatteries > 0
          ? "battery"
          : null;

  let peLeaseFactor = PE_LEASE.baselineFactor;
  let peLeaseAdjustment = 0;
  if (peActive && peSystemType) {
    peLeaseAdjustment = calcLeaseFactorAdjustment(peSystemType, peSolarDC, peBatteryDC, peEnergyCommunnity);
    peLeaseFactor = PE_LEASE.baselineFactor + peLeaseAdjustment;
  }

  const epcPrice = priceAfterFixed; // PE "EPC Price" = full system price
  const peLeaseCustomerAmount = peActive ? epcPrice / peLeaseFactor : 0;
  const pePaymentToInstaller = peActive ? epcPrice - peLeaseCustomerAmount : 0;
  const pePaymentIC = pePaymentToInstaller * (2 / 3); // Inspection Complete
  const pePaymentPC = pePaymentToInstaller * (1 / 3); // Project Complete

  // PE customer discount is always flat -30% (OpenSolar pricing)
  const pePct = peActive ? -30 : 0;
  const peAmount = peActive ? epcPrice * 0.3 : 0;

  const finalPrice = peActive ? epcPrice * 0.7 : priceAfterFixed;
  const hsAmount = peActive ? epcPrice : finalPrice;

  return {
    moduleCost,
    inverterCost,
    batteryCost,
    otherCost,
    batteryMisc,
    racking,
    bos,
    cogs,
    roofAdder,
    storeyAdder,
    pitchAdder,
    extraCosts,
    labourGeneral,
    labourBatteries,
    labour,
    leadGen,
    salary,
    commission,
    presale,
    acquisition,
    fulfillment,
    totalCosts,
    markupPct,
    basePrice,
    fixedAdderTotal,
    fixedAdderDetails,
    peActive,
    pePct,
    peAmount,
    finalPrice,
    hsAmount,
    peSystemType,
    peSolarDC,
    peBatteryDC,
    peEnergyCommunnity,
    peLeaseFactor,
    peLeaseAdjustment,
    peLeaseCustomerAmount,
    pePaymentToInstaller,
    pePaymentIC,
    pePaymentPC,
    peTotalRevenue: peActive ? finalPrice + pePaymentToInstaller : 0,
    totalWatts,
    totalPanels,
    totalBatteries,
    isBatteryOnly,
  };
}
