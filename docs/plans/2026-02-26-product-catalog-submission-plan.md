# Product Catalog Submission Redesign — Implementation Plan (Revised)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the generic product submission modal with a full-page, category-specific form that stores specs in per-category DB tables and pushes to HubSpot, Zuper, and Zoho.

**Architecture:** Single page at `/dashboards/catalog/new` with dynamic field sections driven by a category config object. Per-category Prisma spec tables (1:1 with EquipmentSku). Push logic reads a field mapping config to decide what goes to each system.

**Tech Stack:** Next.js 16.1, React 19.2, Prisma 7.3, Tailwind v4, TypeScript 5

**Design doc:** `docs/plans/2026-02-26-product-catalog-submission-design.md`
**Property mapping:** `docs/product-property-mapping-simple.csv`

**Revision notes:** This plan was revised to address 4 critical findings from code review:
1. **Keep internal `EquipmentCategory` enum unchanged** — no renames. Add new values only. Use a mapping layer for display labels and cross-system category names.
2. **Expand `PendingCatalogPush`** with all common form fields (sku, vendorName, vendorPartNumber, unitCost, sellPrice, hardToProcure, length, width, weight, metadata) so nothing is lost between submission and approval.
3. **Fix sku column consistency** — add `sku` to both `PendingCatalogPush` and `EquipmentSku` in the same migration.
4. **Approval route uses `$transaction`** to atomically write EquipmentSku + spec table + status update. Persists ALL common fields, not just description/unitSpec/unitLabel.
5. **Use Next.js `useRouter` for navigation** instead of `window.location.href`.

---

## Task 1: Prisma Schema — Additive Enum Expansion + New Fields

**Why:** We need 7 new category values and new columns on EquipmentSku and PendingCatalogPush. We do NOT rename any existing enum values — RACKING, ELECTRICAL_BOS, MONITORING, RAPID_SHUTDOWN stay as-is. The mapping layer (Task 3) handles display labels and cross-system name translation.

**Files:**
- Modify: `prisma/schema.prisma:571-580` — add 7 new enum values
- Modify: `prisma/schema.prisma:596-626` — add fields to EquipmentSku
- Modify: `prisma/schema.prisma:772-798` — add fields to PendingCatalogPush

**Step 1: Add 7 new values to EquipmentCategory enum**

At `prisma/schema.prisma:571`, update the enum to:

```prisma
enum EquipmentCategory {
  MODULE
  INVERTER
  BATTERY
  EV_CHARGER
  RAPID_SHUTDOWN
  RACKING
  ELECTRICAL_BOS
  MONITORING
  // New categories (added Feb 2026)
  BATTERY_EXPANSION
  OPTIMIZER
  GATEWAY
  D_AND_R
  SERVICE
  ADDER_SERVICES
  TESLA_SYSTEM_COMPONENTS
  PROJECT_MILESTONES
}
```

Note: RELAY_DEVICE is NOT added — existing MONITORING enum covers that concept. ELECTRICAL_HARDWARE is NOT added — existing ELECTRICAL_BOS covers it. MOUNTING_HARDWARE is NOT added — existing RACKING covers it. The mapping layer (Task 3) provides the user-facing display labels.

**Step 2: Add fields to EquipmentSku**

After `sellPrice Float?` (line 607), add:

```prisma
  sku         String?           // Cross-system product code
  hardToProcure Boolean         @default(false)
  length      Float?            // Physical dimension
  width       Float?
  weight      Float?
```

**Step 3: Add fields to PendingCatalogPush**

After `unitLabel String?` (line 781), add:

```prisma
  sku              String?
  vendorName       String?
  vendorPartNumber String?
  unitCost         Float?
  sellPrice        Float?
  hardToProcure    Boolean   @default(false)
  length           Float?
  width            Float?
  weight           Float?
  metadata         Json?     // Category-specific spec fields (stored until approval)
```

**Step 4: Create migration**

```bash
npx prisma migrate dev --name add-catalog-categories-and-fields
npx prisma generate
```

**Step 5: Verify build**

```bash
npx next build
```

Expected: Build passes. No existing code references new enum values yet, so no breakage.

**Step 6: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add 7 equipment categories, sku/dimension fields on EquipmentSku, expand PendingCatalogPush"
```

---

## Task 2: Prisma Schema — Per-Category Spec Tables

**Files:**
- Modify: `prisma/schema.prisma` — add 7 spec models after EquipmentSku
- Modify: `prisma/schema.prisma` — add relation fields to EquipmentSku

**Step 1: Add spec tables to schema**

Add after the `EquipmentSku` model:

```prisma
model ModuleSpec {
  id               String @id @default(cuid())
  skuId            String @unique
  sku              EquipmentSku @relation(fields: [skuId], references: [id], onDelete: Cascade)
  wattage          Float?
  efficiency       Float?            // percentage
  cellType         String?           // "Mono PERC", "TOPCon", "HJT", "Poly", "Thin Film"
  voc              Float?            // Open Circuit Voltage (V)
  isc              Float?            // Short Circuit Current (A)
  vmp              Float?            // Max Power Voltage (V)
  imp              Float?            // Max Power Current (A)
  tempCoefficient  Float?            // %/°C
}

model InverterSpec {
  id               String @id @default(cuid())
  skuId            String @unique
  sku              EquipmentSku @relation(fields: [skuId], references: [id], onDelete: Cascade)
  acOutputKw       Float?
  maxDcInput       Float?
  phase            String?           // "Single", "Three-phase"
  nominalAcVoltage String?           // "240V", "208V", "480V"
  mpptChannels     Int?
  maxInputVoltage  Float?
  inverterType     String?           // "String", "Micro", "Hybrid", "Central"
}

model BatterySpec {
  id                      String @id @default(cuid())
  skuId                   String @unique
  sku                     EquipmentSku @relation(fields: [skuId], references: [id], onDelete: Cascade)
  capacityKwh             Float?
  energyStorageCapacity   Float?
  usableCapacityKwh       Float?
  continuousPowerKw       Float?
  peakPowerKw             Float?
  chemistry               String?    // "LFP", "NMC"
  roundTripEfficiency     Float?     // percentage
  nominalVoltage          Float?
}

model EvChargerSpec {
  id              String @id @default(cuid())
  skuId           String @unique
  sku             EquipmentSku @relation(fields: [skuId], references: [id], onDelete: Cascade)
  powerKw         Float?
  connectorType   String?           // "J1772", "NACS", "CCS"
  amperage        Float?
  voltage         Float?
  level           String?           // "Level 1", "Level 2", "DC Fast"
  smartFeatures   Boolean?
}

model MountingHardwareSpec {
  id              String @id @default(cuid())
  skuId           String @unique
  sku             EquipmentSku @relation(fields: [skuId], references: [id], onDelete: Cascade)
  mountType       String?           // "Roof", "Ground", "Carport", "Flat Roof"
  material        String?           // "Aluminum", "Steel"
  tiltRange       String?
  windRating      Float?            // mph
  snowLoad        Float?            // psf
  roofAttachment  String?           // "Comp Shingle", "Tile", "Metal", "S-Tile"
}

model ElectricalHardwareSpec {
  id              String @id @default(cuid())
  skuId           String @unique
  sku             EquipmentSku @relation(fields: [skuId], references: [id], onDelete: Cascade)
  componentType   String?           // "Conduit", "Wire", "Disconnect", "Breaker", "Combiner"
  gaugeSize       String?           // AWG or conduit size
  voltageRating   Float?
  material        String?           // "Copper", "Aluminum", "PVC", "EMT"
}

model RelayDeviceSpec {
  id                  String @id @default(cuid())
  skuId               String @unique
  sku                 EquipmentSku @relation(fields: [skuId], references: [id], onDelete: Cascade)
  deviceType          String?      // "Gateway", "Meter", "CT", "Consumption Monitor"
  connectivity        String?      // "WiFi", "Cellular", "Ethernet", "Zigbee"
  compatibleInverters String?
}
```

**Step 2: Add relation fields to EquipmentSku**

Add inside the `EquipmentSku` model (after `stockLevels` relation):

```prisma
  moduleSpec             ModuleSpec?
  inverterSpec           InverterSpec?
  batterySpec            BatterySpec?
  evChargerSpec          EvChargerSpec?
  mountingHardwareSpec   MountingHardwareSpec?
  electricalHardwareSpec ElectricalHardwareSpec?
  relayDeviceSpec        RelayDeviceSpec?
```

**Step 3: Run migration**

```bash
npx prisma migrate dev --name add-category-spec-tables
npx prisma generate
```

**Step 4: Verify build**

```bash
npx next build
```

**Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add per-category spec tables with 1:1 EquipmentSku relations"
```

---

## Task 3: Category Field Config + Mapping Layer

**Why:** This is the mapping layer that translates between internal enum values (RACKING, ELECTRICAL_BOS, MONITORING) and user-facing display labels (Mounting Hardware, Electrical Hardware, Relay Device) and cross-system names (HubSpot, Zuper, Zoho).

**Files:**
- Create: `src/lib/catalog-fields.ts`

**Step 1: Create the config file**

```typescript
// src/lib/catalog-fields.ts

export interface FieldDef {
  key: string;
  label: string;
  type: "number" | "text" | "dropdown" | "toggle";
  options?: string[];       // for dropdown type
  unit?: string;            // display unit e.g. "W", "kWh", "%"
  placeholder?: string;
  required?: boolean;
  // Cross-system push mapping (TBD fields left as undefined)
  hubspotProperty?: string;    // HubSpot custom property name
  zuperCustomField?: string;   // Zuper custom field name (if pushing)
  zohoCustomField?: string;    // Zoho custom field name (if pushing)
}

export interface CategoryConfig {
  /** User-facing display label */
  label: string;
  /** Internal Prisma EquipmentCategory enum value */
  enumValue: string;
  /** HubSpot product_category enum value */
  hubspotValue: string;
  /** Zuper Parts category name (undefined if category needs adding to Zuper) */
  zuperCategory?: string;
  /** Prisma relation name on EquipmentSku, e.g. "moduleSpec" */
  specTable?: string;
  /** Category-specific fields (empty for categories with no specs) */
  fields: FieldDef[];
}

/**
 * Master category config.
 *
 * IMPORTANT: Keys are the internal EquipmentCategory enum values.
 * Some internal enum values differ from display labels:
 *   RACKING         → "Mounting Hardware"
 *   ELECTRICAL_BOS  → "Electrical Hardware"
 *   MONITORING      → "Relay Device"
 *   RAPID_SHUTDOWN  → "Optimizer" (historically RSD; now re-labeled)
 *
 * The mapping layer lets us keep the DB enum stable while showing
 * HubSpot-aligned labels in the UI and pushing the right category
 * names to each external system.
 */
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
    fields: [], // Populated at bottom — shares Battery's fields
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
  // --- Legacy enum values with updated display labels ---
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
    zuperCategory: "Electrical Hardwire", // Zuper has a typo — "Hardwire" not "Hardware"
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
    label: "Optimizer",
    enumValue: "RAPID_SHUTDOWN",
    hubspotValue: "Optimizer",
    fields: [],
  },
  // --- New categories (no legacy enum baggage) ---
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

/**
 * Categories to show in the "Add Product" form.
 * Uses display labels, ordered for the UI.
 * Excludes RAPID_SHUTDOWN (legacy alias for Optimizer) to avoid duplication.
 */
export const FORM_CATEGORIES = [
  "MODULE",
  "BATTERY",
  "BATTERY_EXPANSION",
  "INVERTER",
  "EV_CHARGER",
  "RACKING",          // displays as "Mounting Hardware"
  "ELECTRICAL_BOS",   // displays as "Electrical Hardware"
  "MONITORING",       // displays as "Relay Device"
  "OPTIMIZER",
  "GATEWAY",
  "D_AND_R",
  "SERVICE",
  "ADDER_SERVICES",
  "TESLA_SYSTEM_COMPONENTS",
  "PROJECT_MILESTONES",
] as const;

// HubSpot manufacturer enum (source of truth for Brand dropdown)
export const MANUFACTURERS = [
  "ChargePoint", "CONNECTDER", "CONXT", "Enphase", "GENER", "Generac",
  "Hanwha", "Hyundai", "Iron Ridge", "Jinco", "LG", "LG Chem", "Longi",
  "Neurio", "North American Made", "Panasonic", "Photon", "Photon Service",
  "REC", "Rell Power", "Sense", "Silfab", "SMA", "SolarEdge", "Solaria",
  "SONBT", "Sunpower", "Tesla", "Trim-Lock", "Tygo", "URE", "Wallbox",
] as const;

/** Get the display label for a category enum value */
export function getCategoryLabel(enumValue: string): string {
  return CATEGORY_CONFIGS[enumValue]?.label ?? enumValue;
}

/** Get the internal enum value from a display label (reverse lookup) */
export function getEnumFromLabel(label: string): string | undefined {
  return Object.values(CATEGORY_CONFIGS).find((c) => c.label === label)?.enumValue;
}

/** Get fields for a category (handles Battery Expansion sharing) */
export function getCategoryFields(category: string): FieldDef[] {
  return CATEGORY_CONFIGS[category]?.fields ?? [];
}

/** Get the spec table relation name for a category */
export function getSpecTableName(category: string): string | undefined {
  return CATEGORY_CONFIGS[category]?.specTable;
}

/** Generate Zuper Specification string from spec data */
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
```

**Step 2: Commit**

```bash
git add src/lib/catalog-fields.ts
git commit -m "feat: add category field config with mapping layer (enum→display→HubSpot→Zuper)"
```

---

## Task 4: API Route — Update Push Request to Accept All Fields

**Files:**
- Modify: `src/app/api/catalog/push-requests/route.ts`

**Step 1: Update POST handler**

The POST handler currently accepts: brand, model, description, category, unitSpec, unitLabel, systems, dealId.

Update body destructuring (~line 21) to:

```typescript
const {
  brand, model, description, category, unitSpec, unitLabel,
  sku, vendorName, vendorPartNumber, unitCost, sellPrice,
  hardToProcure, length, width, weight, metadata,
  systems, dealId,
} = body as Record<string, unknown>;
```

Update `prisma.pendingCatalogPush.create` data (~line 37) to:

```typescript
data: {
  brand: String(brand).trim(),
  model: String(model).trim(),
  description: String(description).trim(),
  category: String(category).trim(),
  unitSpec: unitSpec ? String(unitSpec).trim() : null,
  unitLabel: unitLabel ? String(unitLabel).trim() : null,
  sku: sku ? String(sku).trim() : null,
  vendorName: vendorName ? String(vendorName).trim() : null,
  vendorPartNumber: vendorPartNumber ? String(vendorPartNumber).trim() : null,
  unitCost: unitCost != null ? Number(unitCost) || null : null,
  sellPrice: sellPrice != null ? Number(sellPrice) || null : null,
  hardToProcure: hardToProcure === true,
  length: length != null ? Number(length) || null : null,
  width: width != null ? Number(width) || null : null,
  weight: weight != null ? Number(weight) || null : null,
  metadata: metadata || undefined,
  systems: systems as string[],
  requestedBy: authResult.email,
  dealId: dealId ? String(dealId) : null,
},
```

**Step 2: Commit**

```bash
git add src/app/api/catalog/push-requests/route.ts
git commit -m "feat(api): accept all common fields + metadata on catalog push requests"
```

---

## Task 5: API Route — Rewrite Approval with Transaction + Full Field Persistence

**Why:** The current approval route only writes description, unitSpec, unitLabel to EquipmentSku. It ignores sku, vendorName, vendorPartNumber, unitCost, sellPrice, hardToProcure, length, width, weight. It also doesn't write spec tables or use a transaction.

**Files:**
- Modify: `src/app/api/catalog/push-requests/[id]/approve/route.ts`

**Step 1: Rewrite the INTERNAL catalog block**

Replace the existing EquipmentSku upsert (lines 37-70) with a `$transaction` that:
1. Upserts EquipmentSku with ALL common fields
2. Upserts the category spec table from metadata (if applicable)
3. Updates PendingCatalogPush status

```typescript
// INTERNAL catalog
if (push.systems.includes("INTERNAL") && INTERNAL_CATEGORIES.includes(push.category)) {
  const parsedUnitSpec = push.unitSpec ? parseFloat(push.unitSpec) : null;
  const unitSpecValue = parsedUnitSpec != null && !isNaN(parsedUnitSpec) ? parsedUnitSpec : null;

  const commonFields = {
    description: push.description || null,
    unitSpec: unitSpecValue,
    unitLabel: push.unitLabel || null,
    sku: push.sku || null,
    vendorName: push.vendorName || null,
    vendorPartNumber: push.vendorPartNumber || null,
    unitCost: push.unitCost,
    sellPrice: push.sellPrice,
    hardToProcure: push.hardToProcure,
    length: push.length,
    width: push.width,
    weight: push.weight,
  };

  const skuRecord = await prisma.$transaction(async (tx) => {
    // 1. Upsert EquipmentSku
    const sku = await tx.equipmentSku.upsert({
      where: {
        category_brand_model: {
          category: push.category as EquipmentCategory,
          brand: push.brand,
          model: push.model,
        },
      },
      update: { isActive: true, ...commonFields },
      create: {
        category: push.category as EquipmentCategory,
        brand: push.brand,
        model: push.model,
        ...commonFields,
      },
    });

    // 2. Write category spec table from metadata
    const metadata = push.metadata as Record<string, unknown> | null;
    if (metadata) {
      const specTable = getSpecTableName(push.category);
      if (specTable) {
        // Dynamic upsert for the correct spec table
        const prismaModel = tx[specTable as keyof typeof tx] as any;
        if (prismaModel?.upsert) {
          await prismaModel.upsert({
            where: { skuId: sku.id },
            create: { skuId: sku.id, ...metadata },
            update: metadata,
          });
        }
      }
    }

    return sku;
  });

  results.internalSkuId = skuRecord.id;
}
```

Add import at top of file:
```typescript
import { getSpecTableName } from "@/lib/catalog-fields";
```

**Step 2: Commit**

```bash
git add src/app/api/catalog/push-requests/[id]/approve/route.ts
git commit -m "feat(api): approval uses $transaction, persists all common fields + spec tables"
```

---

## Task 6: New Product Page — Layout and Common Fields

**Files:**
- Create: `src/app/dashboards/catalog/new/page.tsx`

**Step 1: Create the page**

Full-page form wrapped in `<DashboardShell>`. Uses `CATEGORY_CONFIGS`, `FORM_CATEGORIES`, `MANUFACTURERS`, `getCategoryLabel` from `src/lib/catalog-fields.ts`.

Sections:
1. **Category Selector** — card-style buttons using `FORM_CATEGORIES`, displaying `getCategoryLabel(enumValue)` for each
2. **Product Identity** — Brand (searchable dropdown from Task 8), Model/Part#, SKU, Description, Vendor Name, Vendor Part#
3. **Category Specs** — dynamic `<CategoryFields>` component (Task 7)
4. **Pricing & Details** — Unit Cost, Sell Price, Hard to Procure toggle, Length, Width, Weight
5. **Push to Systems** — checkboxes: Internal, HubSpot, Zuper, Zoho
6. **Footer** — Cancel + Submit for Approval

Support `?category=MODULE&brand=Tesla&model=...&description=...` query params for BOM prefill. Read params with `useSearchParams()`.

On submit, POST to `/api/catalog/push-requests` with:
```typescript
{
  brand, model, description,
  category: selectedCategory,  // internal enum value e.g. "RACKING"
  unitSpec, unitLabel,
  sku, vendorName, vendorPartNumber,
  unitCost, sellPrice, hardToProcure,
  length, width, weight,
  metadata: specValues,  // { wattage: 410, cellType: "Mono PERC", ... }
  systems: Array.from(selectedSystems),
  dealId,
}
```

Use theme tokens: `bg-surface`, `bg-surface-2`, `text-foreground`, `text-muted`, `border-t-border`, `shadow-card`. Follow `DashboardShell` pattern with `accentColor="cyan"`.

**Step 2: Commit**

```bash
git add src/app/dashboards/catalog/new/
git commit -m "feat: add /dashboards/catalog/new product submission page with common fields"
```

---

## Task 7: CategoryFields Component

**Files:**
- Create: `src/components/catalog/CategoryFields.tsx`

**Step 1: Create the dynamic field renderer**

Reads `FieldDef[]` from the config and renders the appropriate input for each field type:
- `number` → `<input type="number">` with unit suffix
- `text` → `<input type="text">`
- `dropdown` → `<select>` with options
- `toggle` → checkbox/toggle switch

Props:
```typescript
interface Props {
  category: string;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}
```

Uses `getCategoryFields(category)` to get the field list. Renders nothing if `fields` is empty.

Use theme tokens for inputs:
```
w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground
placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50
```

**Step 2: Commit**

```bash
git add src/components/catalog/
git commit -m "feat: add CategoryFields component for dynamic category-specific form sections"
```

---

## Task 8: Brand Searchable Dropdown

**Files:**
- Create: `src/components/catalog/BrandDropdown.tsx`

**Step 1: Create searchable dropdown**

Combobox-style component that:
- Shows HubSpot's 33 manufacturers from `MANUFACTURERS` const
- Supports type-to-filter
- Has "Add new manufacturer" option at bottom that switches to a text input
- Returns the selected or custom brand string

Props:
```typescript
interface Props {
  value: string;
  onChange: (brand: string) => void;
}
```

Keyboard accessible: arrow keys to navigate, Enter to select, Escape to close.

**Step 2: Commit**

```bash
git add src/components/catalog/BrandDropdown.tsx
git commit -m "feat: add searchable brand dropdown with HubSpot manufacturer enum"
```

---

## Task 9: Wire Up BOM + Catalog Pages to New Route

**Why:** Replace PushToSystemsModal usage with navigation to the new full-page form. Use `useRouter().push()` instead of `window.location.href` for client-side navigation.

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx:3109-3112` — replace PushToSystemsModal usage
- Modify: `src/app/dashboards/catalog/page.tsx:967-970` — replace PushToSystemsModal usage

**Step 1: Replace modal with router navigation**

In both files, replace the `<PushToSystemsModal>` render with:

```typescript
import { useRouter } from "next/navigation";

// Inside the component:
const router = useRouter();

function handlePushToSystems(item: PushItem) {
  const params = new URLSearchParams();
  if (item.brand) params.set("brand", item.brand);
  if (item.model) params.set("model", item.model);
  if (item.description) params.set("description", item.description);
  if (item.category) params.set("category", item.category);
  if (item.unitSpec != null) params.set("unitSpec", String(item.unitSpec));
  if (item.unitLabel) params.set("unitLabel", item.unitLabel);
  if (item.dealId) params.set("dealId", item.dealId);
  router.push(`/dashboards/catalog/new?${params.toString()}`);
}
```

Remove the `PushToSystemsModal` import and any related state.

**Step 2: Verify PushToSystemsModal has no other consumers**

```bash
grep -r "PushToSystemsModal" src/ --include="*.tsx" --include="*.ts"
```

If no other files import it, mark the component as deprecated with a comment.

**Step 3: Commit**

```bash
git add src/app/dashboards/bom/page.tsx src/app/dashboards/catalog/page.tsx
git commit -m "feat: replace PushToSystemsModal with router.push to /dashboards/catalog/new"
```

---

## Task 10: Wire Zoho Standard Fields

**Files:**
- Modify: `src/lib/zoho-inventory.ts` — update `ZohoInventoryItem` interface
- Modify: `src/app/api/products/comparison/route.ts` — read `rate` instead of hardcoding null

**Step 1: Update ZohoInventoryItem interface**

Add fields that exist in Zoho's API but aren't typed:

```typescript
export interface ZohoInventoryItem {
  item_id: string;
  name: string;
  sku?: string;
  description?: string;
  status?: string;
  rate?: number;                    // sell price — ADD
  purchase_rate?: number;           // unit cost — ADD
  part_number?: string;             // model/part number — ADD
  vendor_id?: string;               // vendor reference — ADD
  vendor_name?: string;             // vendor name — ADD
  unit?: string;                    // unit of measurement — ADD
  stock_on_hand?: number | string;
  available_stock?: number | string;
  locations?: ZohoInventoryLocationStock[];
  warehouses?: ZohoInventoryLocationStock[];
}
```

**Step 2: Update comparison route**

In `fetchZohoProducts()`, replace `const price = null;` with:

```typescript
const price = typeof item.rate === "number" ? item.rate : null;
```

**Step 3: Commit**

```bash
git add src/lib/zoho-inventory.ts src/app/api/products/comparison/route.ts
git commit -m "feat: wire Zoho rate, purchase_rate, vendor, part_number, unit fields"
```

---

## Task 11: Tests

**Files:**
- Modify or create: `src/__tests__/api/catalog-push-requests.test.ts`
- Create: `src/__tests__/lib/catalog-fields.test.ts`
- Create: `src/__tests__/api/catalog-push-approve.test.ts`

**Step 1: Add catalog-fields unit tests**

```typescript
// src/__tests__/lib/catalog-fields.test.ts
import {
  getCategoryFields, getCategoryLabel, getEnumFromLabel,
  generateZuperSpecification, MANUFACTURERS, FORM_CATEGORIES,
  CATEGORY_CONFIGS,
} from "@/lib/catalog-fields";

describe("catalog-fields", () => {
  test("getCategoryFields('MODULE') returns 8 fields", () => {
    expect(getCategoryFields("MODULE")).toHaveLength(8);
  });

  test("getCategoryFields('BATTERY_EXPANSION') returns Battery's 8 fields", () => {
    expect(getCategoryFields("BATTERY_EXPANSION")).toHaveLength(8);
    expect(getCategoryFields("BATTERY_EXPANSION")).toBe(getCategoryFields("BATTERY"));
  });

  test("getCategoryFields('OPTIMIZER') returns empty array", () => {
    expect(getCategoryFields("OPTIMIZER")).toEqual([]);
  });

  test("getCategoryLabel maps legacy enums to display labels", () => {
    expect(getCategoryLabel("RACKING")).toBe("Mounting Hardware");
    expect(getCategoryLabel("ELECTRICAL_BOS")).toBe("Electrical Hardware");
    expect(getCategoryLabel("MONITORING")).toBe("Relay Device");
    expect(getCategoryLabel("MODULE")).toBe("Module");
  });

  test("getEnumFromLabel reverse-maps display labels to enum values", () => {
    expect(getEnumFromLabel("Mounting Hardware")).toBe("RACKING");
    expect(getEnumFromLabel("Electrical Hardware")).toBe("ELECTRICAL_BOS");
    expect(getEnumFromLabel("Relay Device")).toBe("MONITORING");
  });

  test("generateZuperSpecification produces correct strings", () => {
    expect(generateZuperSpecification("MODULE", { wattage: 410, cellType: "Mono PERC" })).toBe("410W Mono PERC");
    expect(generateZuperSpecification("BATTERY", { capacityKwh: 13.5, chemistry: "LFP" })).toBe("13.5kWh LFP");
    expect(generateZuperSpecification("INVERTER", { acOutputKw: 7.6, phase: "Single", inverterType: "String" })).toBe("7.6kW Single String");
    expect(generateZuperSpecification("EV_CHARGER", { powerKw: 11.5, level: "Level 2", connectorType: "NACS" })).toBe("11.5kW Level 2 NACS");
  });

  test("MANUFACTURERS has 31 entries", () => {
    expect(MANUFACTURERS).toHaveLength(31);
  });

  test("FORM_CATEGORIES excludes RAPID_SHUTDOWN", () => {
    expect(FORM_CATEGORIES).not.toContain("RAPID_SHUTDOWN");
    expect(FORM_CATEGORIES).toHaveLength(15);
  });

  test("all FORM_CATEGORIES have a config entry", () => {
    for (const cat of FORM_CATEGORIES) {
      expect(CATEGORY_CONFIGS[cat]).toBeDefined();
    }
  });
});
```

**Step 2: Add push-request tests (new fields)**

Test that POST to `/api/catalog/push-requests` accepts and stores:
- `sku`, `vendorName`, `vendorPartNumber`, `unitCost`, `sellPrice`
- `hardToProcure`, `length`, `width`, `weight`
- `metadata` as JSON

**Step 3: Add approval route tests**

Test that approval:
- Persists all common fields to EquipmentSku (not just description/unitSpec/unitLabel)
- Writes spec table from metadata for MODULE category
- Uses transaction (if approval fails partway, no partial writes)

**Step 4: Run tests**

```bash
npm run test
```

**Step 5: Commit**

```bash
git add src/__tests__/
git commit -m "test: add catalog field config, push request, and approval route tests"
```

---

## Task 12: Build Verification

**Step 1: Run full build**

```bash
npm run build
```

Fix any type errors.

**Step 2: Run lint**

```bash
npm run lint
```

**Step 3: Manual smoke test**

1. Navigate to `/dashboards/catalog/new`
2. Select each category — verify correct fields appear and display labels are right (RACKING shows "Mounting Hardware", etc.)
3. Fill in Module form with all fields, submit for approval
4. Check Catalog dashboard pending tab — verify all fields are visible (including sku, vendor, pricing, dimensions, metadata)
5. Approve the pending push — verify EquipmentSku has all common fields AND ModuleSpec has spec data
6. Navigate from BOM unmatched row "Add to Systems" — verify router.push with prefill works

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: build and lint fixes for product catalog submission"
```
