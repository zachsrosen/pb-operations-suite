# Preferred-Vendor PO Splitting — Design Spec

**Date:** 2026-03-18
**Status:** Approved
**Goal:** Auto-split BOM items by their Zoho Inventory preferred vendor and create one draft Purchase Order per vendor, with a UI preview showing the grouping before creation.

---

## Context

The current `POST /api/bom/create-po` route creates a single PO for a single user-selected vendor. All BOM items go onto that one PO regardless of which vendor actually supplies each item.

Zoho Inventory items already carry `vendor_id` and `vendor_name` fields (the "preferred vendor"). These are set by the purchasing team directly in Zoho. The `findItemIdByName()` method in `zoho-inventory.ts` matches BOM items to cached Zoho items — the vendor data is already present on the matched objects but not returned to callers.

**Key principle:** Zoho is the source of truth for preferred vendor, not `InternalProduct.zohoVendorId`. Vendor assignments made in Zoho are picked up automatically via the item cache (60-min TTL).

---

## 1. Data Layer

### 1a. `findItemIdByName()` Enhancement

**File:** `src/lib/zoho-inventory.ts` (line ~633)

Currently returns:
```ts
{ item_id: string; zohoName: string; zohoSku?: string } | null
```

Add to return type:
```ts
{
  item_id: string;
  zohoName: string;
  zohoSku?: string;
  vendor_id?: string;   // NEW — from matched ZohoInventoryItem
  vendor_name?: string; // NEW — from matched ZohoInventoryItem
}
```

The matched `ZohoInventoryItem` objects already carry these optional fields. The method has ~6 non-null return sites (exact name, exact SKU, SKU-contains, name-contains, static overrides, and normalized fallback) plus 1 null return. Each non-null return constructs a new object literal — update all of them to include `vendor_id: matchedItem.vendor_id, vendor_name: matchedItem.vendor_name`.

### 1b. `ProjectBomSnapshot` Schema Change

**File:** `prisma/schema.prisma`

Replace `zohoPoId: String?` with `zohoPurchaseOrders: Json?`.

JSON shape (TypeScript):
```ts
Array<{
  vendorId: string;
  vendorName: string;
  poId: string;
  poNumber: string | null;  // nullable — migration cannot recover PO numbers for old rows
  itemCount: number;
}>
```

**Migration strategy:** Any row with non-null `zohoPoId` gets migrated to:
```json
[{ "vendorId": "unknown", "vendorName": "Unknown (migrated)", "poId": "<old zohoPoId>", "poNumber": null, "itemCount": 0 }]
```

Then drop the `zohoPoId` column.

**Downstream updates:**
- `GET /api/bom/history` select: replace `zohoPoId` with `zohoPurchaseOrders`
- BOM page `BomSnapshot` interface: replace `zohoPoId: string | null` with `zohoPurchaseOrders: ZohoPurchaseOrderEntry[] | null`

---

## 2. Shared Library: `src/lib/bom-po-create.ts`

Extracted grouping/matching logic used by `po-preview`, `create-po`, and the automated pipeline. Prevents behavior drift across callers.

### 2a. `resolvePoVendorGroups(bomSnapshot)`

Core function. Takes a `ProjectBomSnapshot`, returns vendor-grouped items:

```ts
interface PoVendorGroup {
  vendorId: string;
  vendorName: string;
  items: PoLineItem[];
}

interface PoLineItem {
  bomName: string;      // what the BOM called it
  zohoName: string;     // what Zoho matched it to
  zohoSku?: string;     // Zoho SKU for verification
  zohoItemId: string;   // Zoho item_id for PO line item
  quantity: number;
  description: string;
}

interface UnassignedItem {
  name: string;
  quantity: number;
  description: string;
  zohoItemId?: string;  // present if matched to Zoho but no vendor
  zohoName?: string;
  reason: 'no_zoho_match' | 'no_vendor';
}

interface PoGroupingResult {
  vendorGroups: PoVendorGroup[];
  unassignedItems: UnassignedItem[];
}
```

**Algorithm:**
1. Parse `bomData.items` from snapshot
2. For each item, call `findItemIdByName()` (sequential — shared cache, no concurrency benefit)
3. If no Zoho match → unassigned (`reason: 'no_zoho_match'`)
4. If matched but no `vendor_id` → unassigned (`reason: 'no_vendor'`)
5. If matched with `vendor_id` → group into the vendor's bucket
6. Skip zero/negative quantity items (same as current behavior)

### 2b. `createPurchaseOrders(options)`

Orchestrates PO creation for one or more vendor groups:

```ts
interface CreatePosOptions {
  snapshot: ProjectBomSnapshot;
  vendorGroups: PoVendorGroup[];
  existingPos: ZohoPurchaseOrderEntry[];  // already-created POs from partial retry
  dealName: string;
  version: number;
  address?: string;
}
```

**Flow:**
1. Filter out vendor groups that already have a PO in `existingPos` (by `vendorId`) — partial-failure idempotency
2. For each remaining group, call `zohoInventory.createPurchaseOrder()` sequentially
3. Omit `purchaseorder_number` from the payload — Zoho auto-assigns a sequential PO number for draft orders. Use `reference_number` for project/vendor context: `PROJ-{id} V{version} — {vendorName}` (truncate vendor name portion to fit Zoho's 50-char limit, keeping the project identifier intact; append ellipsis if truncated)
4. After each successful PO creation, immediately append to `zohoPurchaseOrders` on the snapshot (persist-as-you-go, not all-at-end)
5. If a Zoho call fails, log the error and continue to next vendor group. Return partial results + errors.

**Return:**
```ts
interface CreatePosResult {
  created: ZohoPurchaseOrderEntry[];
  failed: Array<{ vendorId: string; vendorName: string; error: string }>;
  skippedExisting: ZohoPurchaseOrderEntry[];
}
```

---

## 3. API Route: `GET /api/bom/po-preview`

**File:** `src/app/api/bom/po-preview/route.ts`

Query params: `dealId`, `version`

Calls `resolvePoVendorGroups()` and returns the grouping. Used by the UI to show the preview before creation.

**Response:**
```ts
{
  vendorGroups: Array<{
    vendorId: string;
    vendorName: string;
    items: Array<{
      bomName: string;
      zohoName: string;     // actual Zoho item name — makes fuzzy match visible
      zohoSku?: string;     // Zoho SKU for verification
      zohoItemId: string;
      quantity: number;
      description: string;  // BOM description — included for PO line items
    }>;
  }>;
  unassignedItems: Array<{
    name: string;
    quantity: number;
    description: string;
    reason: 'no_zoho_match' | 'no_vendor';
    zohoName?: string;      // present if matched but no vendor
  }>;
}
```

Auth: same role set as current `create-po` route (normalize legacy `MANAGER`/`DESIGNER` to `PROJECT_MANAGER`/`TECH_OPS`).

Activity logging: log a `FEATURE_USED` entry consistent with other BOM API routes.

---

## 4. API Route: `POST /api/bom/create-po` (Reworked)

**File:** `src/app/api/bom/create-po/route.ts`

**Request body:**
```ts
{
  dealId: string;           // required
  version: number;          // required
  unassignedVendorId?: string;  // optional — vendor for items without a preferred vendor
}
```

Note: `vendorId` is removed — no longer one vendor for everything.

**Flow:**
1. Load BOM snapshot
2. Load existing `zohoPurchaseOrders` from snapshot (may be non-empty from partial retry)
3. Call `resolvePoVendorGroups()` to get current grouping
4. If `unassignedVendorId` is provided, merge unassigned items (that have a `zohoItemId`) into that vendor's group. Items with no Zoho match remain unassigned.
5. Call `createPurchaseOrders()` — handles partial-failure idempotency internally
6. Return results

**Response:**
```ts
{
  purchaseOrders: ZohoPurchaseOrderEntry[];  // all POs (newly created + previously existing)
  unassignedItems: Array<{ name: string; qty: number }>;
  failed: Array<{ vendorId: string; vendorName: string; error: string }>;
}
```

**Partial-failure idempotency:** If vendor A succeeded on a previous call but vendor B failed, the retry will:
- See vendor A's PO in `zohoPurchaseOrders` → skip it
- Recompute vendor B's group → create it
- Persist vendor B's PO

This replaces the current "non-empty = return existing" guard.

**Cache freshness note:** `create-po` recomputes the vendor grouping fresh (not relying on the preview). If vendor assignments changed in Zoho between preview and creation (item cache TTL is 60 min), the actual POs may differ from what the preview showed. The response reflects the actual result; this is acceptable behavior.

---

## 5. BOM Page UI

### 5a. Before POs Are Created

Replace the current single vendor dropdown + "Create PO" button:

1. "Preview Purchase Orders" button fetches `GET /api/bom/po-preview`
2. Shows a grouped preview panel:
   - Each vendor group as a card/section: **vendor name**, item count, expandable item list showing both `bomName` and `zohoName` (so fuzzy match discrepancies are visible)
   - **"Unassigned Items"** section at the bottom (if any) with:
     - Items listed with their `reason` (no Zoho match vs. no vendor)
     - Vendor dropdown (from existing `zoho-vendors` route) to assign a vendor to the group
   - Summary line: "X purchase orders will be created for Y items"
3. "Create N Purchase Orders" confirmation button

### 5b. After POs Are Created

- Replace preview with a list of created POs from `zohoPurchaseOrders`:
  - Each entry: **Vendor Name** — PO number (N items) → link to Zoho
  - PO number may be null for migrated rows — show "View in Zoho" without number
- If there were failures, show them as warnings with a "Retry Failed" button
- Persists across page reloads (read from `zohoPurchaseOrders` on snapshot)

### 5c. State Management

Replace:
- `zohoPoId: string | null` → `zohoPurchaseOrders: ZohoPurchaseOrderEntry[] | null`
- `selectedVendorId: string` → `unassignedVendorId: string` (only for unassigned items)
- Add: `poPreview: PoGroupingResult | null`, `previewLoading: boolean`
- Remove: single-vendor dropdown from the default view (moved into unassigned section)

---

## 6. Automated Pipeline Integration

`bom-pipeline.ts` calls `resolvePoVendorGroups()` + `createPurchaseOrders()` directly (shared lib). No `unassignedVendorId` — items without a preferred vendor are logged in `BomPipelineRun` metadata and skipped. Partial failures are logged but don't block the pipeline.

**Ordering:** PO creation is independent of SO creation. Both fields (`zohoPurchaseOrders` and `zohoSoId`) coexist on the same snapshot. In the pipeline, PO creation would run after SO creation as an optional step. `zohoSoId` is out of scope for this spec — no changes to it.

---

## 7. Backward Compatibility

- `GET /api/bom/zoho-vendors` route stays — powers the unassigned-items vendor dropdown
- Old snapshots with `zohoPoId` migrated to `zohoPurchaseOrders` via Prisma migration
- BOM page reads `zohoPurchaseOrders` instead of `zohoPoId`; handles null/empty as "no POs created"
- The `create-po` response shape is a breaking change, but only the BOM page UI consumes it

---

## 8. Files Changed

| File | Change |
|------|--------|
| `src/lib/zoho-inventory.ts` | Add `vendor_id`, `vendor_name` to `findItemIdByName()` return |
| `src/lib/bom-po-create.ts` | **New** — `resolvePoVendorGroups()`, `createPurchaseOrders()` |
| `prisma/schema.prisma` | Replace `zohoPoId` with `zohoPurchaseOrders` on `ProjectBomSnapshot` |
| `prisma/migrations/...` | Data migration for existing `zohoPoId` rows |
| `src/app/api/bom/po-preview/route.ts` | **New** — preview grouping endpoint |
| `src/app/api/bom/create-po/route.ts` | Rework to multi-vendor, partial-failure idempotency |
| `src/app/api/bom/history/route.ts` | Select `zohoPurchaseOrders` instead of `zohoPoId` |
| `src/app/dashboards/bom/page.tsx` | New preview panel, multi-PO display, updated state |
| `src/lib/bom-pipeline.ts` | Call shared lib for PO creation step |
| `src/lib/product-updates.ts` | Changelog strings reference `zohoPoId` — update to `zohoPurchaseOrders` (string only, no functional change) |
| `src/__tests__/api/bom-create-po.test.ts` | Update for new request/response shape |
| `src/__tests__/lib/bom-po-create.test.ts` | **New** — unit tests for shared grouping/creation logic |
