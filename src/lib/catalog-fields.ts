// src/lib/catalog-fields.ts

export interface FieldDef {
  key: string;
  label: string;
  type: "number" | "text" | "dropdown" | "toggle";
  options?: string[];
  unit?: string;
  placeholder?: string;
  required?: boolean;
  tooltip?: string;
  showWhen?: { field: string; value: unknown };
  hubspotProperty?: string;
  zuperCustomField?: string;
  zohoCustomField?: string;
}

export interface CategoryConfig {
  label: string;
  enumValue: string;
  hubspotValue: string;
  zuperCategory?: string;
  specTable?: string;
  fields: FieldDef[];
}

export const CATEGORY_CONFIGS: Record<string, CategoryConfig> = {
  MODULE: {
    label: "Module",
    enumValue: "MODULE",
    hubspotValue: "Module",
    zuperCategory: "Solar Panel",

    specTable: "moduleSpec",
    fields: [
      { key: "wattage", label: "DC Size (Wattage)", type: "number", unit: "W", hubspotProperty: "dc_size", tooltip: "Rated power output under STC (Standard Test Conditions)" },
      { key: "efficiency", label: "Efficiency", type: "number", unit: "%", tooltip: "Module conversion efficiency percentage" },
      { key: "cellType", label: "Cell Type", type: "dropdown", options: ["Mono PERC", "TOPCon", "HJT", "Poly", "Thin Film"], tooltip: "Solar cell technology used in the module" },
      { key: "voc", label: "Voc (Open Circuit Voltage)", type: "number", unit: "V", tooltip: "Voltage when no load is connected" },
      { key: "isc", label: "Isc (Short Circuit Current)", type: "number", unit: "A", tooltip: "Current when output terminals are shorted" },
      { key: "vmp", label: "Vmp (Max Power Voltage)", type: "number", unit: "V", tooltip: "Voltage at maximum power point" },
      { key: "imp", label: "Imp (Max Power Current)", type: "number", unit: "A", tooltip: "Current at maximum power point" },
      { key: "tempCoefficient", label: "Temp Coefficient (Pmax)", type: "number", unit: "%/°C", tooltip: "Power output change per degree Celsius" },
    ],
  },
  INVERTER: {
    label: "Inverter",
    enumValue: "INVERTER",
    hubspotValue: "Inverter",
    zuperCategory: "Inverter",

    specTable: "inverterSpec",
    fields: [
      { key: "acOutputKw", label: "AC Output Size", type: "number", unit: "kW", hubspotProperty: "ac_size", tooltip: "Rated AC power output of the inverter" },
      { key: "maxDcInput", label: "Max DC Input", type: "number", unit: "kW", tooltip: "Maximum DC input power the inverter can accept" },
      { key: "phase", label: "Phase", type: "dropdown", options: ["Single", "Three-phase"], tooltip: "Single-phase for residential, three-phase for commercial" },
      { key: "nominalAcVoltage", label: "Nominal AC Voltage", type: "dropdown", options: ["240V", "208V", "480V"], tooltip: "Grid-side AC voltage the inverter connects to" },
      { key: "mpptChannels", label: "MPPT Channels", type: "number", tooltip: "Number of independent maximum power point trackers" },
      { key: "maxInputVoltage", label: "Max Input Voltage", type: "number", unit: "V", tooltip: "Maximum DC input voltage the inverter can handle" },
      { key: "inverterType", label: "Inverter Type", type: "dropdown", options: ["String", "Micro", "Hybrid", "Central"], tooltip: "String = centralized, Micro = per-panel, Hybrid = battery-ready" },
    ],
  },
  BATTERY: {
    label: "Battery",
    enumValue: "BATTERY",
    hubspotValue: "Battery",
    zuperCategory: "Battery",

    specTable: "batterySpec",
    fields: [
      { key: "capacityKwh", label: "Capacity", type: "number", unit: "kWh", hubspotProperty: "size__kwh_", tooltip: "Total energy storage capacity of the battery" },
      { key: "energyStorageCapacity", label: "Energy Storage Capacity", type: "number", hubspotProperty: "energy_storage_capacity", tooltip: "HubSpot-specific energy storage value" },
      { key: "usableCapacityKwh", label: "Usable Capacity", type: "number", unit: "kWh", tooltip: "Actual usable energy after depth-of-discharge limits" },
      { key: "continuousPowerKw", label: "Continuous Power", type: "number", unit: "kW", hubspotProperty: "capacity__kw_", tooltip: "Sustained power output the battery can deliver" },
      { key: "peakPowerKw", label: "Peak Power", type: "number", unit: "kW", tooltip: "Maximum short-burst power output" },
      { key: "chemistry", label: "Chemistry", type: "dropdown", options: ["LFP", "NMC"], tooltip: "LFP = longer life/safer, NMC = higher energy density" },
      { key: "roundTripEfficiency", label: "Round-Trip Efficiency", type: "number", unit: "%", tooltip: "Energy retained after a full charge/discharge cycle" },
      { key: "nominalVoltage", label: "Nominal Voltage", type: "number", unit: "V", tooltip: "Average operating voltage of the battery system" },
    ],
  },
  BATTERY_EXPANSION: {
    label: "Battery Expansion",
    enumValue: "BATTERY_EXPANSION",
    hubspotValue: "Battery Expansion",
    zuperCategory: "Battery Expansion",

    specTable: "batterySpec",
    fields: [],
  },
  EV_CHARGER: {
    label: "EV Charger",
    enumValue: "EV_CHARGER",
    hubspotValue: "EV Charger",
    zuperCategory: "EV Charger",

    specTable: "evChargerSpec",
    fields: [
      { key: "powerKw", label: "Charger Power", type: "number", unit: "kW", hubspotProperty: "capacity__kw_", tooltip: "Maximum charging power output" },
      { key: "connectorType", label: "Connector Type", type: "dropdown", options: ["J1772", "NACS", "CCS"], tooltip: "Physical plug type — NACS is Tesla/newer EVs" },
      { key: "amperage", label: "Amperage", type: "number", unit: "A", tooltip: "Maximum current draw of the charger" },
      { key: "voltage", label: "Voltage", type: "number", unit: "V", tooltip: "Operating voltage (240V typical for Level 2)" },
      { key: "level", label: "Level", type: "dropdown", options: ["Level 1", "Level 2", "DC Fast"], tooltip: "L1 = 120V/slow, L2 = 240V/standard, DC Fast = commercial" },
      { key: "smartFeatures", label: "WiFi / Smart Features", type: "toggle", tooltip: "WiFi connectivity, app control, energy scheduling" },
    ],
  },
  RACKING: {
    label: "Mounting Hardware",
    enumValue: "RACKING",
    hubspotValue: "Mounting Hardware",
    zuperCategory: "Mounting Hardware",

    specTable: "mountingHardwareSpec",
    fields: [
      { key: "mountType", label: "Mount Type", type: "dropdown", options: ["Roof", "Ground", "Carport", "Flat Roof"], tooltip: "Installation location type for the racking system" },
      { key: "material", label: "Material", type: "dropdown", options: ["Aluminum", "Steel"], tooltip: "Primary structural material of the racking" },
      { key: "tiltRange", label: "Tilt Range", type: "text", tooltip: "Adjustable tilt angle range (e.g. 10°–30°)" },
      { key: "windRating", label: "Wind Rating", type: "number", unit: "mph", tooltip: "Maximum wind speed the system is rated for" },
      { key: "snowLoad", label: "Snow Load", type: "number", unit: "psf", tooltip: "Maximum snow load in pounds per square foot" },
      { key: "roofAttachment", label: "Roof Attachment", type: "dropdown", options: ["Comp Shingle", "Tile", "Metal", "S-Tile"], tooltip: "Roof material the mount attaches to" },
    ],
  },
  ELECTRICAL_BOS: {
    label: "Electrical Hardware",
    enumValue: "ELECTRICAL_BOS",
    hubspotValue: "Electrical Hardware",
    zuperCategory: "Electrical Hardwire",

    specTable: "electricalHardwareSpec",
    fields: [
      { key: "componentType", label: "Component Type", type: "dropdown", options: ["Conduit", "Wire", "Disconnect", "Breaker", "Combiner"], tooltip: "Type of electrical balance-of-system component" },
      { key: "gaugeSize", label: "Gauge / Size", type: "text", tooltip: "Wire gauge (AWG) or conduit trade size" },
      { key: "voltageRating", label: "Voltage Rating", type: "number", unit: "V", tooltip: "Maximum voltage the component is rated for" },
      { key: "material", label: "Material", type: "dropdown", options: ["Copper", "Aluminum", "PVC", "EMT"], tooltip: "Primary material of the electrical component" },
    ],
  },
  MONITORING: {
    label: "Relay Device",
    enumValue: "MONITORING",
    hubspotValue: "Relay Device",
    zuperCategory: "Relay Device",

    specTable: "relayDeviceSpec",
    fields: [
      { key: "deviceType", label: "Device Type", type: "dropdown", options: ["Gateway", "Meter", "CT", "Consumption Monitor"], tooltip: "Type of monitoring or relay device" },
      { key: "connectivity", label: "Connectivity", type: "dropdown", options: ["WiFi", "Cellular", "Ethernet", "Zigbee"], tooltip: "Communication method for data transmission" },
      { key: "compatibleInverters", label: "Compatible Inverters", type: "text", tooltip: "Inverter brands/models this device works with" },
    ],
  },
  RAPID_SHUTDOWN: {
    label: "Rapid Shutdown",
    enumValue: "RAPID_SHUTDOWN",
    hubspotValue: "Rapid Shutdown",
    zuperCategory: "Electrical Hardwire",

    fields: [],
  },
  OPTIMIZER: {
    label: "Optimizer",
    enumValue: "OPTIMIZER",
    hubspotValue: "Optimizer",
    zuperCategory: "Optimizer",

    fields: [],
  },
  GATEWAY: {
    label: "Gateway",
    enumValue: "GATEWAY",
    hubspotValue: "Gateway",
    zuperCategory: "Relay Device",

    fields: [],
  },
  D_AND_R: {
    label: "D&R",
    enumValue: "D_AND_R",
    hubspotValue: "D&R",
    zuperCategory: "D&R",

    fields: [],
  },
  SERVICE: {
    label: "Service",
    enumValue: "SERVICE",
    hubspotValue: "Service",
    zuperCategory: "Service",

    fields: [],
  },
  ADDER_SERVICES: {
    label: "Adder & Services",
    enumValue: "ADDER_SERVICES",
    hubspotValue: "Adder",
    zuperCategory: "Service",

    fields: [],
  },
  TESLA_SYSTEM_COMPONENTS: {
    label: "Tesla System Components",
    enumValue: "TESLA_SYSTEM_COMPONENTS",
    hubspotValue: "Tesla System Components",
    zuperCategory: "Tesla System Components",

    fields: [],
  },
  PROJECT_MILESTONES: {
    label: "Project Milestones",
    enumValue: "PROJECT_MILESTONES",
    hubspotValue: "Project Milestones",
    zuperCategory: "Service",

    fields: [],
  },
};

// Battery Expansion shares Battery's fields
CATEGORY_CONFIGS.BATTERY_EXPANSION.fields = CATEGORY_CONFIGS.BATTERY.fields;

export const FORM_CATEGORIES = [
  "MODULE",
  "BATTERY",
  "BATTERY_EXPANSION",
  "INVERTER",
  "EV_CHARGER",
  "RAPID_SHUTDOWN",
  "RACKING",
  "ELECTRICAL_BOS",
  "MONITORING",
  "OPTIMIZER",
  "GATEWAY",
  "D_AND_R",
  "SERVICE",
  "ADDER_SERVICES",
  "TESLA_SYSTEM_COMPONENTS",
  "PROJECT_MILESTONES",
] as const;

export const MANUFACTURERS = [
  "ChargePoint", "CONNECTDER", "CONXT", "Enphase", "GENER", "Generac",
  "Hanwha", "Hyundai", "Iron Ridge", "Jinco", "LG", "LG Chem", "Longi",
  "Neurio", "North American Made", "Panasonic", "Photon", "Photon Service",
  "REC", "Rell Power", "Sense", "Silfab", "SMA", "SolarEdge", "Solaria",
  "SONBT", "Sunpower", "Tesla", "Trim-Lock", "Tygo", "URE", "Wallbox",
] as const;

export function getCategoryLabel(enumValue: string): string {
  return CATEGORY_CONFIGS[enumValue]?.label ?? enumValue;
}

export function getEnumFromLabel(label: string): string | undefined {
  return Object.values(CATEGORY_CONFIGS).find((c) => c.label === label)?.enumValue;
}

export function getCategoryFields(category: string): FieldDef[] {
  return CATEGORY_CONFIGS[category]?.fields ?? [];
}

export function getSpecTableName(category: string): string | undefined {
  return CATEGORY_CONFIGS[category]?.specTable;
}

/** Coerce a value to match the expected field type. Returns undefined if not coercible. */
function coerceFieldValue(value: unknown, field: FieldDef): unknown {
  if (value === null || value === undefined || value === "") return undefined;

  if (field.type === "number") {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    // Extract the highest number from strings like "8-10" or "100W"
    const matches = String(value).match(/[\d.]+/g);
    if (!matches) return undefined;
    const max = Math.max(...matches.map(Number).filter(Number.isFinite));
    return Number.isFinite(max) ? max : undefined;
  }
  if (field.type === "toggle") {
    if (typeof value === "boolean") return value;
    const s = String(value).toLowerCase();
    if (s === "true" || s === "yes" || s === "1") return true;
    if (s === "false" || s === "no" || s === "0") return false;
    return undefined;
  }
  // text / dropdown — keep as string
  return String(value);
}

/** Filter metadata to only include keys defined in the category's field config,
 *  coercing values to match expected Prisma column types. */
export function filterMetadataToSpecFields(
  category: string,
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const fields = getCategoryFields(category);
  const fieldMap = new Map(fields.map((f) => [f.key, f]));
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const field = fieldMap.get(key);
    if (!field) continue;
    const coerced = coerceFieldValue(value, field);
    if (coerced !== undefined) {
      filtered[key] = coerced;
    }
  }
  return filtered;
}

export function getHubspotCategoryValue(category: string): string | undefined {
  return CATEGORY_CONFIGS[category]?.hubspotValue;
}

export function getZuperCategoryValue(category: string): string | undefined {
  return CATEGORY_CONFIGS[category]?.zuperCategory;
}

export function getHubspotPropertiesFromMetadata(
  category: string,
  metadata: Record<string, unknown> | null | undefined
): Record<string, string | number | boolean> {
  if (!metadata || typeof metadata !== "object") return {};

  const mapped: Record<string, string | number | boolean> = {};
  const fields = getCategoryFields(category);
  for (const field of fields) {
    const propertyName = field.hubspotProperty;
    if (!propertyName) continue;

    const value = metadata[field.key];
    if (value === null || value === undefined || value === "") continue;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      mapped[propertyName] = value;
      continue;
    }
    mapped[propertyName] = String(value);
  }

  return mapped;
}

/** Default unit label per category for the Basics step. */
const CATEGORY_UNIT_LABELS: Record<string, string> = {
  MODULE: "W",
  INVERTER: "kW",
  BATTERY: "kWh",
  BATTERY_EXPANSION: "kWh",
  EV_CHARGER: "kW",
};

/** All categories get the same four system targets. Unit label varies by category. */
export function getCategoryDefaults(category: string): {
  unitLabel: string;
  systems: Set<string>;
} {
  return {
    unitLabel: CATEGORY_UNIT_LABELS[category] ?? "",
    systems: new Set(["INTERNAL", "HUBSPOT", "ZUPER", "ZOHO"]),
  };
}

export function generateZuperSpecification(category: string, specData: Record<string, unknown>): string {
  const parts: string[] = [];
  switch (category) {
    case "MODULE":
      if (specData.wattage) parts.push(`${specData.wattage}W`);
      if (specData.cellType) parts.push(String(specData.cellType));
      break;
    case "INVERTER":
      if (specData.acOutputKw) parts.push(`${specData.acOutputKw}kW`);
      if (specData.phase) parts.push(String(specData.phase));
      if (specData.inverterType) parts.push(String(specData.inverterType));
      break;
    case "BATTERY":
    case "BATTERY_EXPANSION":
      if (specData.capacityKwh) parts.push(`${specData.capacityKwh}kWh`);
      if (specData.chemistry) parts.push(String(specData.chemistry));
      break;
    case "EV_CHARGER":
      if (specData.powerKw) parts.push(`${specData.powerKw}kW`);
      if (specData.level) parts.push(String(specData.level));
      if (specData.connectorType) parts.push(String(specData.connectorType));
      break;
    default:
      break;
  }
  return parts.join(" ");
}
