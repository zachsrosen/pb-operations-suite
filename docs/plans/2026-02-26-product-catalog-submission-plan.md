# Product Catalog Submission Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the generic product submission modal with a full-page, category-specific form that stores specs in per-category DB tables and pushes to HubSpot, Zuper, and Zoho.

**Architecture:** Single page at `/dashboards/catalog/new` with dynamic field sections driven by a category config object. Per-category Prisma spec tables (1:1 with EquipmentSku). Push logic reads a field mapping config to decide what goes to each system.

**Tech Stack:** Next.js 16.1, React 19.2, Prisma 7.3, Tailwind v4, TypeScript 5

**Design doc:** `docs/plans/2026-02-26-product-catalog-submission-design.md`
**Property mapping:** `docs/product-property-mapping-simple.csv`

---

## Task 1: Prisma Schema — Update EquipmentCategory Enum

**Files:**
- Modify: `prisma/schema.prisma:571-580`

**Step 1: Update the enum**

Replace the `EquipmentCategory` enum at line 571 with the 15 HubSpot-aligned values:

```prisma
enum EquipmentCategory {
  MODULE
  BATTERY
  BATTERY_EXPANSION
  INVERTER
  OPTIMIZER
  GATEWAY
  D_AND_R
  SERVICE
  ADDER_SERVICES
  EV_CHARGER
  TESLA_SYSTEM_COMPONENTS
  PROJECT_MILESTONES
  RELAY_DEVICE
  ELECTRICAL_HARDWARE
  MOUNTING_HARDWARE
}
```

**Step 2: Create migration**

Run: `npx prisma migrate dev --name rename-equipment-categories`

This will fail if there are existing rows using old enum values. You'll need a manual SQL migration step:

```sql
-- In the migration SQL file, add BEFORE the enum change:
UPDATE "EquipmentSku" SET category = 'MOUNTING_HARDWARE' WHERE category = 'RACKING';
UPDATE "EquipmentSku" SET category = 'ELECTRICAL_HARDWARE' WHERE category = 'ELECTRICAL_BOS';
UPDATE "EquipmentSku" SET category = 'RELAY_DEVICE' WHERE category = 'MONITORING';
-- RAPID_SHUTDOWN rows: decide where they go (D_AND_R?)
UPDATE "EquipmentSku" SET category = 'D_AND_R' WHERE category = 'RAPID_SHUTDOWN';
```

**Step 3: Update all code references to old enum values**

Search for: `RACKING`, `ELECTRICAL_BOS`, `MONITORING`, `RAPID_SHUTDOWN` in TypeScript files and update.

Key files to check:
- `src/components/PushToSystemsModal.tsx:29-38` — CATEGORIES array
- `src/app/api/catalog/push-requests/[id]/approve/route.ts` — uses `EquipmentCategory`
- `src/app/dashboards/catalog/page.tsx` — category display logic

Run: `npx prisma generate` to regenerate client.

**Step 4: Commit**

```bash
git add prisma/ src/
git commit -m "feat(schema): align EquipmentCategory enum with HubSpot's 15 product categories"
```

---

## Task 2: Prisma Schema — Add Per-Category Spec Tables

**Files:**
- Modify: `prisma/schema.prisma` (after EquipmentSku model, ~line 626)
- Modify: `prisma/schema.prisma` EquipmentSku model — add relation fields

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

Add these lines inside the `EquipmentSku` model (after `stockLevels` relation at line 617):

```prisma
  moduleSpec            ModuleSpec?
  inverterSpec          InverterSpec?
  batterySpec           BatterySpec?
  evChargerSpec         EvChargerSpec?
  mountingHardwareSpec  MountingHardwareSpec?
  electricalHardwareSpec ElectricalHardwareSpec?
  relayDeviceSpec       RelayDeviceSpec?
```

**Step 3: Add `sku` field and `metadata` to PendingCatalogPush**

In `EquipmentSku` model (after `model` field, line 600): add `sku String?`

In `PendingCatalogPush` model (after `unitLabel` field, ~line 781): add `metadata Json?`

**Step 4: Run migration**

```bash
npx prisma migrate dev --name add-category-spec-tables
npx prisma generate
```

**Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add per-category spec tables and metadata column"
```

---

## Task 3: Category Field Config

**Files:**
- Create: `src/lib/catalog-fields.ts`

**Step 1: Create the config file**

This file defines the field schema for each category. It drives both the form UI and the push logic.

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
  label: string;
  enumValue: string;
  hubspotValue: string;
  zuperCategory?: string;      // Zuper category name (if exists)
  specTable?: string;          // Prisma relation name e.g. "moduleSpec"
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
    fields: [], // Same fields as BATTERY — reference BATTERY.fields at runtime
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
  MOUNTING_HARDWARE: {
    label: "Mounting Hardware",
    enumValue: "MOUNTING_HARDWARE",
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
  ELECTRICAL_HARDWARE: {
    label: "Electrical Hardware",
    enumValue: "ELECTRICAL_HARDWARE",
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
  RELAY_DEVICE: {
    label: "Relay Device",
    enumValue: "RELAY_DEVICE",
    hubspotValue: "Relay Device",
    zuperCategory: "Relay Device",
    specTable: "relayDeviceSpec",
    fields: [
      { key: "deviceType", label: "Device Type", type: "dropdown", options: ["Gateway", "Meter", "CT", "Consumption Monitor"] },
      { key: "connectivity", label: "Connectivity", type: "dropdown", options: ["WiFi", "Cellular", "Ethernet", "Zigbee"] },
      { key: "compatibleInverters", label: "Compatible Inverters", type: "text" },
    ],
  },
  // Categories with no spec fields — common fields only
  OPTIMIZER: { label: "Optimizer", enumValue: "OPTIMIZER", hubspotValue: "Optimizer", fields: [] },
  GATEWAY: { label: "Gateway", enumValue: "GATEWAY", hubspotValue: "Gateway", fields: [] },
  D_AND_R: { label: "D&R", enumValue: "D_AND_R", hubspotValue: "D&R", fields: [] },
  SERVICE: { label: "Service", enumValue: "SERVICE", hubspotValue: "Service", fields: [] },
  ADDER_SERVICES: { label: "Adder & Services", enumValue: "ADDER_SERVICES", hubspotValue: "Adder", fields: [] },
  TESLA_SYSTEM_COMPONENTS: { label: "Tesla System Components", enumValue: "TESLA_SYSTEM_COMPONENTS", hubspotValue: "Tesla System Components", fields: [] },
  PROJECT_MILESTONES: { label: "Project Milestones", enumValue: "PROJECT_MILESTONES", hubspotValue: "Project Milestones", fields: [] },
};

// Battery Expansion shares Battery's fields
CATEGORY_CONFIGS.BATTERY_EXPANSION.fields = CATEGORY_CONFIGS.BATTERY.fields;

// HubSpot manufacturer enum (source of truth for Brand dropdown)
export const MANUFACTURERS = [
  "ChargePoint", "CONNECTDER", "CONXT", "Enphase", "GENER", "Generac",
  "Hanwha", "Hyundai", "Iron Ridge", "Jinco", "LG", "LG Chem", "Longi",
  "Neurio", "North American Made", "Panasonic", "Photon", "Photon Service",
  "REC", "Rell Power", "Sense", "Silfab", "SMA", "SolarEdge", "Solaria",
  "SONBT", "Sunpower", "Tesla", "Trim-Lock", "Tygo", "URE", "Wallbox",
] as const;

// Helper to get fields for a category (handles Battery Expansion sharing)
export function getCategoryFields(category: string): FieldDef[] {
  return CATEGORY_CONFIGS[category]?.fields ?? [];
}

// Helper to generate Zuper Specification string from spec data
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
git commit -m "feat: add category field config for product catalog form"
```

---

## Task 4: API Route — Update Push Request to Accept Metadata

**Files:**
- Modify: `src/app/api/catalog/push-requests/route.ts`

**Step 1: Update POST handler to accept metadata**

The `POST` handler at line 10 currently accepts: brand, model, description, category, unitSpec, unitLabel, systems, dealId.

Add `metadata` (optional JSON) and `sku` (optional string) to the accepted fields. Store them on the `PendingCatalogPush` record.

Update the body destructuring (~line 18) to include:
```typescript
const { brand, model, description, category, unitSpec, unitLabel, sku, metadata, systems, dealId } = body;
```

Update the `prisma.pendingCatalogPush.create` call to include:
```typescript
sku: sku?.trim() || undefined,
metadata: metadata || undefined,
```

**Step 2: Commit**

```bash
git add src/app/api/catalog/push-requests/route.ts
git commit -m "feat(api): accept metadata and sku on catalog push requests"
```

---

## Task 5: API Route — Update Approval to Write Spec Tables

**Files:**
- Modify: `src/app/api/catalog/push-requests/[id]/approve/route.ts`

**Step 1: Update approval handler**

After the `EquipmentSku` upsert (~line 60), add spec table creation based on category and metadata:

```typescript
// After EquipmentSku upsert, write category spec if metadata exists
const metadata = push.metadata as Record<string, unknown> | null;
if (metadata && skuRecord) {
  const specData = metadata;
  switch (push.category) {
    case "MODULE":
      await prisma.moduleSpec.upsert({
        where: { skuId: skuRecord.id },
        create: { skuId: skuRecord.id, ...specData },
        update: specData,
      });
      break;
    case "INVERTER":
      await prisma.inverterSpec.upsert({ ... });
      break;
    // ... etc for each category with a spec table
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/catalog/push-requests/[id]/approve/route.ts
git commit -m "feat(api): write category spec tables on catalog push approval"
```

---

## Task 6: New Product Page — Layout and Common Fields

**Files:**
- Create: `src/app/dashboards/catalog/new/page.tsx`

**Step 1: Create the page**

Full-page form wrapped in `<DashboardShell>`. Uses `CATEGORY_CONFIGS` and `MANUFACTURERS` from `src/lib/catalog-fields.ts`.

Sections:
1. Category selector — card-style buttons, one per category
2. Product Identity — Brand (searchable dropdown), Model, SKU, Description, Vendor Name, Vendor Part Number
3. Category Specs — dynamic `<CategoryFields>` component (Task 7)
4. Pricing & Details — Unit Cost, Sell Price, Hard to Procure, Length, Width, Weight
5. Push to Systems — checkboxes for Internal, HubSpot, Zuper, Zoho
6. Footer — Cancel + Submit for Approval

Support `?category=MODULE&brand=Tesla&model=...&description=...` query params for BOM prefill.

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

Uses `getCategoryFields(category)` to get the field list. Renders nothing if `fields` is empty (categories without specs).

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

**Step 2: Commit**

```bash
git add src/components/catalog/BrandDropdown.tsx
git commit -m "feat: add searchable brand dropdown with HubSpot manufacturer enum"
```

---

## Task 9: Wire Up BOM Page to New Route

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx:3109-3112` — replace PushToSystemsModal usage
- Modify: `src/app/dashboards/catalog/page.tsx:967-970` — replace PushToSystemsModal usage

**Step 1: Replace modal with navigation**

In both files, replace the `<PushToSystemsModal>` render with a function that navigates to the new page:

```typescript
function handlePushToSystems(item: PushItem) {
  const params = new URLSearchParams({
    brand: item.brand,
    model: item.model,
    description: item.description,
    category: item.category,
    ...(item.unitSpec != null && { unitSpec: String(item.unitSpec) }),
    ...(item.unitLabel && { unitLabel: item.unitLabel }),
    ...(item.dealId && { dealId: item.dealId }),
  });
  window.location.href = `/dashboards/catalog/new?${params}`;
}
```

Remove the `PushToSystemsModal` import and any related state (`pushItem`, `newProductItem`, `setPushItem`, `setNewProductItem`).

**Step 2: Verify PushToSystemsModal has no other consumers**

If no other files import it, the component file can be deleted or deprecated.

**Step 3: Commit**

```bash
git add src/app/dashboards/bom/page.tsx src/app/dashboards/catalog/page.tsx
git commit -m "feat: replace PushToSystemsModal with navigation to /dashboards/catalog/new"
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

In `fetchZohoProducts()` (~line 729 of comparison route), replace `const price = null;` with:

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
- Modify: `src/__tests__/api/catalog-push-requests.test.ts`
- Create: `src/__tests__/lib/catalog-fields.test.ts`

**Step 1: Update existing push request tests**

Add test cases for:
- POST with `metadata` field (JSON spec data)
- POST with `sku` field
- Verify metadata is stored on the created record

**Step 2: Add catalog-fields tests**

Test:
- `getCategoryFields("MODULE")` returns 8 fields
- `getCategoryFields("BATTERY_EXPANSION")` returns Battery's fields
- `getCategoryFields("OPTIMIZER")` returns empty array
- `generateZuperSpecification("MODULE", { wattage: 410, cellType: "Mono PERC" })` returns "410W Mono PERC"
- `generateZuperSpecification("BATTERY", { capacityKwh: 13.5, chemistry: "LFP" })` returns "13.5kWh LFP"
- `MANUFACTURERS` array has 33 entries

**Step 3: Run tests**

```bash
npm run test
```

**Step 4: Commit**

```bash
git add src/__tests__/
git commit -m "test: add catalog field config and push request metadata tests"
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
2. Select each category — verify correct fields appear
3. Fill in Module form, submit for approval
4. Check Catalog dashboard pending tab — verify metadata is visible
5. Navigate from BOM unmatched row "Add to Systems" — verify redirect with prefill

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: build and lint fixes for product catalog submission"
```
