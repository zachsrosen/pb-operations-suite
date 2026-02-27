// src/lib/catalog-fields.ts

export interface FieldDef {
  key: string;
  label: string;
  type: "number" | "text" | "dropdown" | "toggle";
  options?: string[];
  unit?: string;
  placeholder?: string;
  required?: boolean;
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
    specTable: "moduleSpec",
    fields: [
      { key: "wattage", label: "DC Size (Wattage)", type: "number", unit: "W", hubspotProperty: "dc_size" },
      { key: "efficiency", label: "Efficiency", type: "number", unit: "%" },
      { key: "cellType", label: "Cell Type", type: "dropdown", options: ["Mono PERC", "TOPCon", "HJT", "Poly", "Thin Film"] },
      { key: "voc", label: "Voc (Open Circuit Voltage)", type: "number", unit: "V" },
      { key: "isc", label: "Isc (Short Circuit Current)", type: "number", unit: "A" },
      { key: "vmp", label: "Vmp (Max Power Voltage)", type: "number", unit: "V" },
      { key: "imp", label: "Imp (Max Power Current)", type: "number", unit: "A" },
      { key: "tempCoefficient", label: "Temp Coefficient (Pmax)", type: "number", unit: "%/°C" },
    ],
  },
  INVERTER: {
    label: "Inverter",
    enumValue: "INVERTER",
    hubspotValue: "Inverter",
    zuperCategory: "Inverter",
    specTable: "inverterSpec",
    fields: [
      { key: "acOutputKw", label: "AC Output Size", type: "number", unit: "kW", hubspotProperty: "ac_size" },
      { key: "maxDcInput", label: "Max DC Input", type: "number", unit: "kW" },
      { key: "phase", label: "Phase", type: "dropdown", options: ["Single", "Three-phase"] },
      { key: "nominalAcVoltage", label: "Nominal AC Voltage", type: "dropdown", options: ["240V", "208V", "480V"] },
      { key: "mpptChannels", label: "MPPT Channels", type: "number" },
      { key: "maxInputVoltage", label: "Max Input Voltage", type: "number", unit: "V" },
      { key: "inverterType", label: "Inverter Type", type: "dropdown", options: ["String", "Micro", "Hybrid", "Central"] },
    ],
  },
  BATTERY: {
    label: "Battery",
    enumValue: "BATTERY",
    hubspotValue: "Battery",
    zuperCategory: "Battery",
    specTable: "batterySpec",
    fields: [
      { key: "capacityKwh", label: "Capacity", type: "number", unit: "kWh", hubspotProperty: "size__kwh_" },
      { key: "energyStorageCapacity", label: "Energy Storage Capacity", type: "number", hubspotProperty: "energy_storage_capacity" },
      { key: "usableCapacityKwh", label: "Usable Capacity", type: "number", unit: "kWh" },
      { key: "continuousPowerKw", label: "Continuous Power", type: "number", unit: "kW", hubspotProperty: "capacity__kw_" },
      { key: "peakPowerKw", label: "Peak Power", type: "number", unit: "kW" },
      { key: "chemistry", label: "Chemistry", type: "dropdown", options: ["LFP", "NMC"] },
      { key: "roundTripEfficiency", label: "Round-Trip Efficiency", type: "number", unit: "%" },
      { key: "nominalVoltage", label: "Nominal Voltage", type: "number", unit: "V" },
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
    specTable: "evChargerSpec",
    fields: [
      { key: "powerKw", label: "Charger Power", type: "number", unit: "kW", hubspotProperty: "capacity__kw_" },
      { key: "connectorType", label: "Connector Type", type: "dropdown", options: ["J1772", "NACS", "CCS"] },
      { key: "amperage", label: "Amperage", type: "number", unit: "A" },
      { key: "voltage", label: "Voltage", type: "number", unit: "V" },
      { key: "level", label: "Level", type: "dropdown", options: ["Level 1", "Level 2", "DC Fast"] },
      { key: "smartFeatures", label: "WiFi / Smart Features", type: "toggle" },
    ],
  },
  RACKING: {
    label: "Mounting Hardware",
    enumValue: "RACKING",
    hubspotValue: "Mounting Hardware",
    zuperCategory: "Mounting Hardware",
    specTable: "mountingHardwareSpec",
    fields: [
      { key: "mountType", label: "Mount Type", type: "dropdown", options: ["Roof", "Ground", "Carport", "Flat Roof"] },
      { key: "material", label: "Material", type: "dropdown", options: ["Aluminum", "Steel"] },
      { key: "tiltRange", label: "Tilt Range", type: "text" },
      { key: "windRating", label: "Wind Rating", type: "number", unit: "mph" },
      { key: "snowLoad", label: "Snow Load", type: "number", unit: "psf" },
      { key: "roofAttachment", label: "Roof Attachment", type: "dropdown", options: ["Comp Shingle", "Tile", "Metal", "S-Tile"] },
    ],
  },
  ELECTRICAL_BOS: {
    label: "Electrical Hardware",
    enumValue: "ELECTRICAL_BOS",
    hubspotValue: "Electrical Hardware",
    zuperCategory: "Electrical Hardwire",
    specTable: "electricalHardwareSpec",
    fields: [
      { key: "componentType", label: "Component Type", type: "dropdown", options: ["Conduit", "Wire", "Disconnect", "Breaker", "Combiner"] },
      { key: "gaugeSize", label: "Gauge / Size", type: "text" },
      { key: "voltageRating", label: "Voltage Rating", type: "number", unit: "V" },
      { key: "material", label: "Material", type: "dropdown", options: ["Copper", "Aluminum", "PVC", "EMT"] },
    ],
  },
  MONITORING: {
    label: "Relay Device",
    enumValue: "MONITORING",
    hubspotValue: "Relay Device",
    zuperCategory: "Relay Device",
    specTable: "relayDeviceSpec",
    fields: [
      { key: "deviceType", label: "Device Type", type: "dropdown", options: ["Gateway", "Meter", "CT", "Consumption Monitor"] },
      { key: "connectivity", label: "Connectivity", type: "dropdown", options: ["WiFi", "Cellular", "Ethernet", "Zigbee"] },
      { key: "compatibleInverters", label: "Compatible Inverters", type: "text" },
    ],
  },
  RAPID_SHUTDOWN: {
    label: "Rapid Shutdown",
    enumValue: "RAPID_SHUTDOWN",
    hubspotValue: "Rapid Shutdown",
    fields: [],
  },
  OPTIMIZER: {
    label: "Optimizer",
    enumValue: "OPTIMIZER",
    hubspotValue: "Optimizer",
    fields: [],
  },
  GATEWAY: {
    label: "Gateway",
    enumValue: "GATEWAY",
    hubspotValue: "Gateway",
    fields: [],
  },
  D_AND_R: {
    label: "D&R",
    enumValue: "D_AND_R",
    hubspotValue: "D&R",
    fields: [],
  },
  SERVICE: {
    label: "Service",
    enumValue: "SERVICE",
    hubspotValue: "Service",
    fields: [],
  },
  ADDER_SERVICES: {
    label: "Adder & Services",
    enumValue: "ADDER_SERVICES",
    hubspotValue: "Adder",
    fields: [],
  },
  TESLA_SYSTEM_COMPONENTS: {
    label: "Tesla System Components",
    enumValue: "TESLA_SYSTEM_COMPONENTS",
    hubspotValue: "Tesla System Components",
    fields: [],
  },
  PROJECT_MILESTONES: {
    label: "Project Milestones",
    enumValue: "PROJECT_MILESTONES",
    hubspotValue: "Project Milestones",
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

/** Filter metadata to only include keys defined in the category's field config. */
export function filterMetadataToSpecFields(
  category: string,
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const validKeys = new Set(getCategoryFields(category).map((f) => f.key));
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (validKeys.has(key) && value !== null && value !== undefined && value !== "") {
      filtered[key] = value;
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
