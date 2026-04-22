# Catalog & Product Sync System

Developer reference for how products are created, approved, and synced across systems in PB Tech Ops Suite.

---

## Architecture Overview

```
┌─────────────────────┐
│   Catalog Form UI    │  /dashboards/catalog/new
│  (category, specs,   │
│   pricing, systems)  │
└────────┬────────────┘
         │ POST /api/catalog/push-requests
         ▼
┌─────────────────────┐
│  PendingCatalogPush  │  status: PENDING
│  (approval queue)    │  stores all form data + metadata JSON
└────────┬────────────┘
         │ Admin approves: POST .../approve
         ▼
┌─────────────────────────────────────────────────┐
│              Approval Transaction                │
│                                                  │
│  1. INTERNAL  ──► EquipmentSku + Spec Table      │
│  2. HUBSPOT   ──► HubSpot Product (CRM)          │
│  3. ZOHO      ──► Zoho Inventory Item            │
│  4. ZUPER     ──► Zuper Product (field service)   │
│                                                  │
│  Each system: search-first (upsert), then link   │
│  external IDs back to EquipmentSku               │
└─────────────────────────────────────────────────┘
```

---

## Database Models

### EquipmentSku (Internal Catalog)

The single source of truth. All external system IDs link back here.

| Field | Type | Purpose |
|-------|------|---------|
| `category` | EquipmentCategory enum | MODULE, INVERTER, BATTERY, etc. |
| `brand` + `model` | String (unique pair) | `@@unique([category, brand, model])` |
| `sku` | String | Cross-reference identifier |
| `vendorName`, `vendorPartNumber` | String | Supplier data |
| `unitCost`, `sellPrice` | Float | Pricing |
| `hubspotProductId` | String? | Link to HubSpot product |
| `zohoItemId` | String? | Link to Zoho Inventory item |
| `zuperItemId` | String? | Link to Zuper product |

**Spec tables** (one-to-one via `skuId`): `ModuleSpec`, `InverterSpec`, `BatterySpec`, `EvChargerSpec`, `MountingHardwareSpec`, `ElectricalHardwareSpec`, `RelayDeviceSpec`.

### PendingCatalogPush (Approval Queue)

Holds product submissions until an admin approves/rejects them.

| Field | Purpose |
|-------|---------|
| `status` | PENDING → APPROVED or REJECTED |
| `systems[]` | Which systems to push to (INTERNAL, HUBSPOT, ZOHO, ZUPER) |
| `metadata` | JSON blob of category-specific spec fields |
| `requestedBy` | Submitter's email |
| `internalSkuId`, `hubspotProductId`, `zohoItemId`, `zuperItemId` | Populated after approval |

---

## Product Creation Flow

### Step 1: Form Submission

**Page**: `/dashboards/catalog/new` (~677 lines)
**API**: `POST /api/catalog/push-requests`

The form collects:
1. **Category** — grid selector from `FORM_CATEGORIES` (16 categories)
2. **Identity** — brand (from approved manufacturer list), model, SKU, vendor fields
3. **Existing product lookup** — searches `/api/inventory/products` to prevent duplicates
4. **Category specs** — dynamic fields from `getCategoryFields(category)` in `catalog-fields.ts`
5. **Pricing & dimensions** — unitCost, sellPrice, weight, length, width
6. **Target systems** — checkboxes for INTERNAL (required), HUBSPOT, ZOHO, ZUPER

Creates a `PendingCatalogPush` record with status `PENDING`. A fire-and-forget email notification is sent to admins via `notifyAdminsOfNewCatalogRequest()` (from `src/lib/catalog-notify.ts`).

### Step 2: Admin Approval

**API**: `POST /api/catalog/push-requests/[id]/approve`
**Auth**: ADMIN, OWNER, or MANAGER role required

The approve handler pushes to each selected system sequentially. Each system follows a **search-first upsert** pattern: find existing → return if found → create if not.

#### INTERNAL (Prisma Transaction)

```
1. Upsert EquipmentSku using @@unique([category, brand, model])
2. Write category-specific spec table from metadata
   (e.g., ModuleSpec with wattage, efficiency, cellType)
3. Store internalSkuId on the push request
```

#### HUBSPOT

**Lib**: `src/lib/hubspot.ts` → `createOrUpdateHubSpotProduct()`

```
Input mapping:
  name         = "Brand Model"
  hs_sku       = sku || model
  price        = sellPrice
  description  = description
  manufacturer = brand
  product_category = getHubspotCategoryValue(category)  // e.g., "Module"
  hs_cost_of_goods_sold = unitCost
  + additionalProperties from getHubspotPropertiesFromMetadata()
    (maps spec fields → HubSpot properties via FieldDef.hubspotProperty)

Flow:
  1. Search HubSpot products by SKU/name
  2. If found → update, return existing ID
  3. If not found → create, return new ID
  4. Link hubspotProductId back to EquipmentSku
```

#### ZOHO

**Lib**: `src/lib/zoho-inventory.ts` → `createOrUpdateZohoItem()`

```
Input mapping:
  name           = "Brand Model"
  sku            = sku || model
  rate           = sellPrice
  purchase_rate  = unitCost
  description    = description
  part_number    = vendorPartNumber || model
  unit           = unitLabel
  vendor_name    = vendorName
  + weight, length, width

Flow: Same search-first upsert pattern
```

#### ZUPER

**Lib**: `src/lib/zuper-catalog.ts` → `createOrUpdateZuperPart()`

```
Input mapping:
  product_name        = "Brand Model"
  product_type        = "PRODUCT" (auto-uppercased, validated against whitelist)
  product_category    = resolveZuperCategoryUid(category)  // UUID, not string name
  product_description = description + specification (pipe-joined)
  uom                 = unitLabel
  price               = sellPrice (as Number)
  purchase_price      = unitCost (as String — Zuper expects string here)
  brand               = brand
  specification       = generateZuperSpecification(category, specData)
                        e.g., "400W | Mono PERC" for modules

Flow:
  1. Search Zuper products by SKU/model/name across multiple query params
  2. If found → return existing ID (created: false)
  3. If not found → POST /product with { product: { ... } }
  4. If create response lacks ID → re-search to discover
  5. Link zuperItemId back to EquipmentSku
```

**Zuper API gotchas** (things that WILL break if wrong):

| Field | Wrong | Correct |
|-------|-------|---------|
| `product_type` | `"product"` (lowercase) | `"PRODUCT"` (uppercase only: PRODUCT, SERVICE, PARTS, BUNDLE, LABOR) |
| `product_category` | `"Solar Panel"` (string name) | `"de36210d-534a-..."` (category UUID) |
| `product_no` | `"SKU-001"` (string) | Omit entirely — Zuper auto-assigns as sequential integer, sending a string causes CastError |

**Zuper category resolution** (in `zuper-catalog.ts`):

Categories are resolved via `resolveZuperCategoryUid()` which:
1. Returns the value as-is if it's already a UUID
2. Fetches live categories from Zuper API (`/product_categories`) with 10-minute in-memory cache
3. Falls back to a static map if the API call fails

**Static fallback map** (used only when live fetch fails):

| Category Name | UUID |
|---------------|------|
| Battery | `7e926259-0552-41e6-b936-547543c209c6` |
| Battery Expansion | `7b1c6e98-e26f-4c2b-8ef6-d3e5471269ce` |
| Inverter | `e21286e7-33a1-4e19-8981-790fb1c16d56` |
| Relay Device | `ea843bd0-dd5f-4211-8c59-c5dccaac2fa9` |
| Invoicing | `24afea80-4196-4db6-a4f1-59260390f563` |
| General (default fallback) | `de36210d-534a-48cb-980d-1bb1eb2f8201` |

Categories not in the live or fallback map (Solar Panel, EV Charger, Optimizer, etc.) default to "General" with a `console.warn`.

### Step 3: Outcome Tracking

The approve handler returns per-system outcomes:

```json
{
  "outcomes": {
    "INTERNAL": { "status": "success", "externalId": "sku_abc123" },
    "HUBSPOT":  { "status": "success", "externalId": "12345678" },
    "ZOHO":     { "status": "failed",  "message": "401 Unauthorized" },
    "ZUPER":    { "status": "success", "externalId": "ea841834-..." }
  },
  "summary": { "selected": 4, "success": 3, "failed": 1 },
  "retryable": true
}
```

- **All succeed** → push status = `APPROVED`
- **Any fail** → push stays `PENDING` with a retry note, `retryable: true`
- External IDs are linked to `EquipmentSku` with guarded writes (only if still null, prevents race conditions)

---

## Post-Creation Sync

After initial creation, products can be synced when internal data changes.

**Lib**: `src/lib/catalog-sync.ts`

### Preview Sync

`previewSyncToLinkedSystems(sku, systems?)` — compares current EquipmentSku state against each external system's current data, returning field-by-field diffs.

### Execute Sync

`executeSyncToLinkedSystems(sku, expectedHash, systems)` — applies changes. Uses a SHA256 hash of the preview to detect concurrent modifications (optimistic concurrency).

```
Field mappings per system:

Zoho:   name, sku, rate, purchase_rate, description, part_number, unit, vendor_name
HubSpot: name, hs_sku, price, description, manufacturer, product_category, hs_cost_of_goods_sold + spec properties
Zuper:  name, sku, description, category, specification
```

---

## Catalog Harvest & Deduplication

For bulk analysis and cross-source matching.

### Harvest (`src/lib/catalog-harvest.ts`)

Read-only pull of all product data from every source:

```
harvestAll() runs in parallel:
  ├── harvestInternal()  → reads EquipmentSku table
  ├── harvestHubSpot()   → HubSpot Products API
  ├── harvestZoho()      → Zoho Inventory API
  └── harvestZuper()     → Zuper Products API

Returns: HarvestedProduct[] with normalized fields
```

**API**: `POST /api/catalog/harvest` (ADMIN/OWNER only)

### Deduplication (`src/lib/catalog-dedupe.ts`)

Intra-source dedup using Union-Find:

```
1. Build canonical keys from brand + model + vendor part number
2. Union products matching on ANY key
3. Select best representative per cluster
4. Output: DedupeCluster[] with members and deduplication reason
```

### Cross-Source Matching (`src/lib/catalog-matcher.ts`)

Matches deduped clusters across sources:

```
1. Build weighted edges between clusters:
   - VPN exact match: highest score
   - Brand + model match: medium score
   - Brand-only match: lowest score
2. Threshold: 50 points to create edge
3. Connected components become MatchGroups
4. Confidence: HIGH (>80), MEDIUM (>60), LOW

Output: MatchGroup[] with stable SHA256 key, confidence, members
```

**API**: `POST /api/catalog/match` (ADMIN/OWNER only) — upserts `CatalogMatchGroup` records

### Admin Review (`/dashboards/catalog/review`)

**API**: `GET/POST /api/catalog/review`

Admins review match groups and decide: APPROVED, REJECTED, or MERGED. Decisions are "sticky" — preserved across re-harvests if membership unchanged.

---

## Category Configuration

All category metadata lives in `src/lib/catalog-fields.ts`.

### CategoryConfig Structure

```typescript
interface CategoryConfig {
  label: string;           // "Module", "Inverter", etc.
  enumValue: string;       // "MODULE", "INVERTER" (Prisma enum)
  hubspotValue: string;    // HubSpot product_category value
  zuperCategory?: string;  // Zuper category name (resolved to UID at runtime)
  specTable?: string;      // Prisma model name (e.g., "moduleSpec")
  fields: FieldDef[];      // Category-specific form fields
}
```

### FieldDef Structure

```typescript
interface FieldDef {
  key: string;              // "wattage", "cellType"
  label: string;            // "Wattage", "Cell Type"
  type: "number" | "text" | "dropdown" | "toggle";
  options?: string[];       // For dropdown type
  unit?: string;            // "W", "%", "V", "kW", "kWh"
  hubspotProperty?: string; // Maps to HubSpot property name
  zuperCustomField?: string;
  zohoCustomField?: string;
}
```

### Categories with Spec Tables

| Category | Enum | Spec Table | Example Fields |
|----------|------|-----------|---------------|
| Module | MODULE | moduleSpec | wattage, efficiency, cellType, voc, isc |
| Inverter | INVERTER | inverterSpec | acOutputKw, phase, mpptChannels, inverterType |
| Battery | BATTERY | batterySpec | capacityKwh, continuousPowerKw, chemistry |
| Battery Expansion | BATTERY_EXPANSION | batterySpec | (same as Battery) |
| EV Charger | EV_CHARGER | evChargerSpec | powerKw, connectorType, level |
| Racking | RACKING | mountingHardwareSpec | mountType, material, windRating |
| Electrical BOS | ELECTRICAL_BOS | electricalHardwareSpec | componentType, gaugeSize |
| Monitoring | MONITORING | relayDeviceSpec | deviceType, connectivity |

Categories without spec tables (Rapid Shutdown, Optimizer, Gateway, D&R, Service, Adder Services, Tesla System Components, Project Milestones) store no additional metadata.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/lib/catalog-fields.ts` | Category configs, field definitions, system mappings |
| `src/lib/zuper-catalog.ts` | Zuper product CRUD with fallback variants |
| `src/lib/hubspot.ts` | HubSpot product CRUD (+ deals, contacts) |
| `src/lib/zoho-inventory.ts` | Zoho Inventory item CRUD |
| `src/lib/catalog-sync.ts` | Preview & execute sync to linked systems |
| `src/lib/catalog-harvest.ts` | Read-only harvest from all sources |
| `src/lib/catalog-dedupe.ts` | Intra-source deduplication (Union-Find) |
| `src/lib/catalog-matcher.ts` | Cross-source matching (graph-based) |
| `src/app/api/catalog/push-requests/route.ts` | Submit & list push requests |
| `src/app/api/catalog/push-requests/[id]/approve/route.ts` | Approve & push to systems |
| `src/app/api/catalog/push-requests/[id]/reject/route.ts` | Reject push request |
| `src/app/api/catalog/harvest/route.ts` | Trigger harvest |
| `src/app/api/catalog/match/route.ts` | Trigger cross-source matching |
| `src/app/api/catalog/review/route.ts` | Manage match decisions |
| `src/app/dashboards/catalog/new/page.tsx` | Product submission form |
| `src/app/dashboards/catalog/edit/[id]/page.tsx` | Edit SKU + sync preview |
| `src/app/dashboards/catalog/review/page.tsx` | Match group review queue |
| `prisma/schema.prisma` | EquipmentSku, PendingCatalogPush, CatalogMatchGroup, spec tables |

---

## Common Pitfalls

1. **Zuper product_type must be uppercase** — `"PRODUCT"` not `"product"`. The code now auto-uppercases and validates against `VALID_PRODUCT_TYPES`
2. **Zuper product_category is a UUID** — use `resolveZuperCategoryUid()`, not the string name. This was a root cause of Zuper creation failures before the fix
3. **Zuper product_no is auto-assigned** — never send it; Zuper expects a sequential integer, sending a string SKU causes a `CastError`. The code now omits it entirely
4. **`getCreateBodyVariants` is async** — it calls `resolveZuperCategoryUid()` which fetches from the Zuper API. Callers must `await` it
5. **Category configs drive everything** — adding a new category means updating `CATEGORY_CONFIGS` in `catalog-fields.ts`, the Prisma `EquipmentCategory` enum, and possibly creating a new spec table
6. **Guarded writes prevent races** — external ID linking uses `WHERE id = X AND zuperItemId IS NULL` to avoid overwriting concurrent updates
7. **Sticky match decisions** — `CatalogMatchGroup` preserves APPROVED/REJECTED decisions across re-harvests if the member set hasn't changed
8. **Manufacturer list is curated** — new brands need to be added to the approved list in `catalog-fields.ts`
9. **Admin notifications are fire-and-forget** — `notifyAdminsOfNewCatalogRequest()` runs without `await` so submission never blocks on email delivery
