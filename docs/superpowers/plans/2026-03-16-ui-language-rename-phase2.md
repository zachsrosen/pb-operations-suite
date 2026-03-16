# UI Language Rename (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all user-facing text where "SKU" refers to a product record with "product" or "internal product", while preserving "SKU" where it refers to the vendor part number field.

**Architecture:** Pure string replacement in user-visible text — no logic changes, no API contracts, no Prisma queries. The critical distinction: "SKU" meaning "the product record" → rename. "SKU" meaning "the vendor part number value" (the `sku` field) → keep. Also renames the single `entityType: "equipment_sku"` audit log entry and the deferred display strings from Phase 1.

**Tech Stack:** Next.js 16.1, React 19.2, TypeScript 5

**Spec:** `docs/superpowers/specs/2026-03-15-equipment-sku-rename-design.md` (Phase 2 section)

---

## Key Distinction: What to Rename vs. What to Keep

**RENAME** — "SKU" meaning "the product record":
- "SKUs Tracked" → "Products Tracked"
- "internal SKU" → "internal product"
- "Failed to fetch SKUs" → "Failed to fetch products"
- "Equipment SKUs" (tab label) → "Products"
- "EquipmentSku" in display strings → "InternalProduct" or "internal product"

**KEEP** — "SKU" meaning "the vendor part number field value":
- `SKU: {product.sku}` — displaying the vendor part number
- Form labels/placeholders for the `sku` field
- "SKU exact" / "SKU partial" / "SKU differs" / "SKU mismatch" — match signals comparing vendor part numbers across sources
- "Search by name, SKU, key..." — searching by vendor part number value

---

## Chunk 1: Dashboard Pages

### Task 1: Inventory dashboard page

**Files:**
- Modify: `src/app/dashboards/inventory/page.tsx`

This file has ~16 user-facing strings where "SKU" means "product record", including Receive tab selectors and transaction table headers.

- [ ] **Step 1: Rename all user-facing SKU → product strings**

Apply these exact replacements (line numbers for reference, match on string content):

| Line | Old String | New String |
|------|-----------|------------|
| 540 | `SKU` (Receive tab selector label) | `Product` |
| 543 | `placeholder="Filter SKUs..."` | `placeholder="Filter products..."` |
| 554 | `Select SKU...` (dropdown default) | `Select product...` |
| 739 | `SKU` (transactions table column header) | `Product` |
| 946 | `Sync SKUs and ensure projects have equipment data.` | `Sync products and ensure projects have equipment data.` |
| 1018 | `{" SKUs"}` | `{" products"}` |
| 1053 | `({group.rows.length} SKU{group.rows.length !== 1 ? "s" : ""})` | `({group.rows.length} product{group.rows.length !== 1 ? "s" : ""})` |
| 1277 | `"Failed to fetch SKUs"` | `"Failed to fetch products"` |
| 1343 | `"SKU Sync Complete"` | `"Product Sync Complete"` |
| 1348 | `"SKU sync error:"` | `"Product sync error:"` |
| 1352 | `"Failed to sync SKUs"` | `"Failed to sync products"` |
| 1480 | `Sync SKUs from HubSpot or import stock from Zoho` | `Sync products from HubSpot or import stock from Zoho` |
| 1496 | `"Sync SKUs from HubSpot"` | `"Sync Products from HubSpot"` |
| 1524 | `` `${stats.totalSkus} SKUs` `` | `` `${stats.totalSkus} products` `` |
| 1540 | `"Sync SKUs"` | `"Sync Products"` |
| 1607 | `"SKUs Tracked"` | `"Products Tracked"` |

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit 2>&1 | grep "inventory/page" | head -5
```

Expected: Zero errors in this file.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/inventory/page.tsx
git commit -m "copy: rename SKU → product in inventory dashboard user-facing text"
```

---

### Task 2: Catalog pages

**Files:**
- Modify: `src/app/dashboards/catalog/page.tsx`
- Modify: `src/app/dashboards/catalog/edit/[id]/page.tsx`

**Critical: distinguish record-label "SKU" from field-value "SKU".** In the catalog page, `SKU: ${r.sku}`, `SKU: {p.sku}`, and the `sku` field label/placeholder are about the vendor part number — DO NOT rename those.

- [ ] **Step 1: Rename in catalog/page.tsx**

| Line | Old String | New String | Notes |
|------|-----------|------------|-------|
| 354 | `"Failed to load SKUs"` | `"Failed to load products"` | |
| 376 | `` `Deleted ${body?.name \|\| "SKU"}` `` | `` `Deleted ${body?.name \|\| "product"}` `` | |
| 380 | `"Failed to delete SKU"` | `"Failed to delete product"` | |
| 596 | `"SKU updated"` | `"Product updated"` | |
| 599 | `"Failed to update SKU"` | `"Failed to update product"` | |
| 948 | `"Equipment SKUs"` | `"Products"` | Tab label |
| 991 | `` SKU{skus.length !== 1 ? "s" : ""} `` | `` product{skus.length !== 1 ? "s" : ""} `` | Counter text |
| 1000 | `Loading SKUs…` | `Loading products…` | |
| 1005 | `No SKUs found.` | `No products found.` | |
| 1438 | `{cat.total} SKUs` | `{cat.total} products` | |
| 1488 | `All filtered SKUs are fully synced.` | `All filtered products are fully synced.` | |
| 1878 | `` active SKU{bulkSyncPreview.count === 1 ? "" : "s"} missing `` | `` active product{bulkSyncPreview.count === 1 ? "" : "s"} missing `` | |
| 1979 | `SKU Cleanup` | `Product Cleanup` | Section header |
| 2015 | `Deactivate SKU` | `Deactivate Product` | Button text |

**DO NOT rename** these (vendor part number field references):
- Line 1321: `SKU: ${r.sku}` — vendor part number display
- Line 1540: `SKU ${entry.sku}` — vendor part number display
- Line 1585: `SKU: {p.sku}` — vendor part number display
- Line 1643–1644: `SKU` label and placeholder for the `sku` field input

- [ ] **Step 2: Rename in catalog/edit/[id]/page.tsx**

| Line | Old String | New String |
|------|-----------|------------|
| 103 | `"Missing SKU id"` | `"Missing product id"` |
| 117 | `` `Failed to load SKUs (${res.status})` `` | `` `Failed to load products (${res.status})` `` |
| 120 | `"SKU not found"` | `"Product not found"` |
| 146 | `"Failed to load SKU"` | `"Failed to load product"` |
| 204 | `` `Failed to update SKU (${res.status})` `` | `` `Failed to update product (${res.status})` `` |
| 206 | `"SKU updated"` | `"Product updated"` |
| 215 | `"Failed to update SKU"` | `"Failed to update product"` |
| 216 | `"Failed to update SKU"` (toast) | `"Failed to update product"` |
| 234 | `` `Failed to delete SKU (${res.status})` `` | `` `Failed to delete product (${res.status})` `` |
| 236 | `` `Deleted ${body?.name \|\| "SKU"}` `` | `` `Deleted ${body?.name \|\| "product"}` `` |
| 239 | `"Failed to delete SKU"` | `"Failed to delete product"` |
| 540 | `This SKU is linked to` | `This product is linked to` |

**DO NOT rename** line 322: `SKU` label for the `sku` field input — that's the vendor part number.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/catalog/
git commit -m "copy: rename SKU → product in catalog dashboard user-facing text"
```

---

### Task 3: Product comparison page

**Files:**
- Modify: `src/app/dashboards/product-comparison/page.tsx`

This file has the most changes (~20+). **Critical:** "SKU mismatch", "SKU exact", "SKU partial", "SKU differs" are match signals about the vendor part number field — DO NOT rename those. Only rename "internal SKU" (meaning the product record).

- [ ] **Step 1: Rename "internal SKU" → "internal product" strings**

| Line | Old String | New String |
|------|-----------|------------|
| 567 | `with an internal SKU.` | `with an internal product.` |
| 569 | `with an internal SKU.` | `with an internal product.` |
| 884 | `"No internal SKU found for this row."` | `"No internal product found for this row."` |
| 952 | `"No internal SKU found for this row."` | `"No internal product found for this row."` |
| 1061 | `"Category, brand, and model are required to create an internal SKU."` | `"Category, brand, and model are required to create an internal product."` |
| 1090 | `` `Failed to create internal SKU (${response.status})` `` | `` `Failed to create internal product (${response.status})` `` |
| 1136 | `"Created internal SKU and linked available source IDs. Saved to inventory."` | `"Created internal product and linked available source IDs. Saved to inventory."` |
| 1141 | `"Failed to create internal SKU"` | `"Failed to create internal product"` |
| 1157 | `"Primary internal SKU is missing for this row."` | `"Primary internal product is missing for this row."` |
| 1180 | `` `Failed to merge duplicate internal SKU (${response.status})` `` | `` `Failed to merge duplicate internal product (${response.status})` `` |
| 1206 | `"Merged duplicate internal SKU into the primary SKU. Row pinned for further linking work."` | `"Merged duplicate internal product into the primary product. Row pinned for further linking work."` |
| 1211 | `"Failed to merge duplicate internal SKU"` | `"Failed to merge duplicate internal product"` |
| 1499 | `"No internal SKUs are available for this cleanup scope."` | `"No internal products are available for this cleanup scope."` |
| 1607 | `` `... for ${summary.total} SKU${summary.total === 1 ? "" : "s"}` `` | `` `... for ${summary.total} product${summary.total === 1 ? "" : "s"}` `` |
| 1929 | `` internal SKU{cleanupSkuIds.length === 1 ? "" : "s"} selected `` | `` internal product{cleanupSkuIds.length === 1 ? "" : "s"} selected `` |
| 1947 | `Unlink selected source IDs on internal SKU` | `Unlink selected source IDs on internal product` |
| 1960 | `Deactivate internal SKU` | `Deactivate internal product` |
| 2429 | `"Create internal SKU from this row"` | `"Create internal product from this row"` |
| 2517 | `Add or match an Internal SKU to enable link confirmation.` | `Add or match an internal product to enable link confirmation.` |
| 2671 | `Merge duplicate internal SKUs into this primary SKU to clean inventory links.` | `Merge duplicate internal products into this primary product to clean inventory links.` |
| 2683 | `"Unnamed internal SKU"` | `"Unnamed internal product"` |
| 1161 | `"Invalid duplicate SKU selected for merge."` | `"Invalid duplicate product selected for merge."` |
| 1858 | `the primary SKU is kept. Missing fields on primary are filled from duplicate.` | `the primary product is kept. Missing fields on primary are filled from duplicate.` |

**DO NOT rename** these (vendor part number comparison signals):
- Line 256, 338, 391: `"SKU mismatch"` — vendor SKU values disagree across sources
- Line 2150: `Search by name, SKU, key...` — searching by vendor part number
- Line 2686: `SKU: {candidate.sku || "—"}` — displaying vendor part number
- Any `"SKU exact"`, `"SKU partial"`, `"SKU differs"` in the comparison API route

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/product-comparison/page.tsx
git commit -m "copy: rename internal SKU → internal product in comparison dashboard"
```

---

### Task 4: BOM page, guide, handbook, and suite description

**Files:**
- Modify: `src/app/dashboards/bom/page.tsx`
- Modify: `src/app/guide/page.tsx`
- Modify: `src/app/handbook/page.tsx`
- Modify: `src/app/suites/operations/page.tsx`

- [ ] **Step 1: Rename in bom/page.tsx**

| Line | Old String | New String |
|------|-----------|------------|
| 277 | `internal SKU ↔ BOM item matching` (comment) | `internal product ↔ BOM item matching` |
| 703 | `placeholder="Search SKUs…"` | `placeholder="Search products…"` |
| 728 | `No matching SKUs` | `No matching products` |
| 1097 | `` `Inventory SKU fetch failed (${res.status})` `` | `` `Inventory product fetch failed (${res.status})` `` |
| 1915 | `"No catalog SKU selected — pick one from the SKU picker"` | `"No catalog product selected — pick one from the product picker"` |
| 1978 | `"No catalog SKU selected — pick one from the SKU picker"` | `"No catalog product selected — pick one from the product picker"` |
| 3300 | `title="Change SKU match"` | `title="Change product match"` |
| 3311 | `No catalog match — select SKU` | `No catalog match — select product` |

- [ ] **Step 2: Rename in guide/page.tsx**

| Line | Old String | New String |
|------|-----------|------------|
| 678 | `per SKU/location` | `per product/location` |
| 681 | `Auto-sync SKU catalog from HubSpot` | `Auto-sync product catalog from HubSpot` |
| 685 | `Click Sync SKUs to populate the catalog` | `Click Sync Products to populate the catalog` |

- [ ] **Step 3: Rename in handbook/page.tsx**

| Line | Old String | New String |
|------|-----------|------------|
| 240 | `per SKU/location` | `per product/location` |
| 243 | `Auto-sync SKU catalog from HubSpot` | `Auto-sync product catalog from HubSpot` |

- [ ] **Step 4: Rename in suites/operations/page.tsx**

| Line | Old String | New String |
|------|-----------|------------|
| 90 | `Manage equipment SKUs, sync health, pending approvals` | `Manage products, sync health, pending approvals` |

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/bom/ src/app/guide/ src/app/handbook/ src/app/suites/
git commit -m "copy: rename SKU → product in BOM, guide, handbook, and suite pages"
```

---

## Chunk 2: API Routes, Lib Files, and Verification

### Task 5: Inventory API route messages

**Files:**
- Modify: `src/app/api/inventory/skus/route.ts`
- Modify: `src/app/api/inventory/skus/merge/route.ts`
- Modify: `src/app/api/inventory/skus/[id]/sync/route.ts`
- Modify: `src/app/api/inventory/skus/sync-bulk/route.ts`
- Modify: `src/app/api/inventory/skus/sync-hubspot-bulk/route.ts`
- Modify: `src/app/api/inventory/skus/stats/route.ts`
- Modify: `src/app/api/inventory/sync-skus/route.ts`

These are error messages, console logs, and audit log descriptions returned from the API. Many surface directly in toast messages on the frontend.

**Audit log entityType note:** The spec requires verifying consumers before switching the write-side value. Verified: the only consumer is `src/app/api/admin/activity/route.ts` which passes `entityType` as a dynamic filter from user input — no hardcoded `"equipment_sku"` string. Existing DB rows will retain `"equipment_sku"`; new rows will use `"internal_product"`. This is an accepted migration gap.

- [ ] **Step 1: Rename in skus/route.ts**

| Line | Old String | New String |
|------|-----------|------------|
| 315 | `active SKUs` (API comment) | `active products` |
| 388 | `[Inventory SKUs] Falling back to legacy SKU query` | `[Inventory Products] Falling back to legacy product query` |
| 447 | `"Error fetching SKUs"` | `"Error fetching products"` |
| 450 | `"Failed to fetch SKUs"` | `"Failed to fetch products"` |
| 652 | `"SKU upsert failed"` | `"Product upsert failed"` |
| 662 | `"Created/upserted internal SKU with source links"` | `"Created/upserted internal product with source links"` |
| 685 | `"SKU upsert blocked by missing database columns:"` | `"Product upsert blocked by missing database columns:"` |
| 695 | `"Error creating/upserting SKU"` | `"Error creating/upserting product"` |
| 698 | `"Failed to create/upsert SKU"` | `"Failed to create/upsert product"` |
| 771 | `"SKU not found"` | `"Product not found"` |
| 931 | `"SKU not found"` | `"Product not found"` |
| 961 | `"SKU patch blocked by missing database columns:"` | `"Product patch blocked by missing database columns:"` |
| 975 | `"Another SKU already uses this category + brand + model"` | `"Another product already uses this category + brand + model"` |
| 980 | `"SKU not found"` | `"Product not found"` |
| 983 | `"Error updating SKU"` | `"Error updating product"` |
| 986 | `"Failed to update SKU"` | `"Failed to update product"` |
| 1050 | `"SKU not found"` | `"Product not found"` |
| 1080 | `"Permanently deleted SKU: ${existing.brand}..."` | `"Permanently deleted product: ${existing.brand}..."` |
| 1083 | `entityType: "equipment_sku"` | `entityType: "internal_product"` |
| 1108 | `"SKU not found"` | `"Product not found"` |
| 1111 | `"Error deleting SKU"` | `"Error deleting product"` |
| 1114 | `"Failed to delete SKU"` | `"Failed to delete product"` |

- [ ] **Step 2: Rename in merge/route.ts**

| Line | Old String | New String |
|------|-----------|------------|
| 86 | `"Source SKU not found"` | `"Source product not found"` |
| 87 | `"Target SKU not found"` | `"Target product not found"` |
| 113 | `"Source or target SKU no longer exists"` | `"Source or target product no longer exists"` |
| 253 | `"Merged duplicate internal SKUs"` | `"Merged duplicate internal products"` |

- [ ] **Step 3: Rename in remaining inventory routes**

For `[id]/sync/route.ts`:
- Line 55, 125: `"SKU not found"` → `"Product not found"`

For `sync-bulk/route.ts`:
- Line 361, 419: `"Run operation is not a SKU bulk sync"` → `"Run operation is not a product bulk sync"`
- Line 558: `"SKU no longer exists or is inactive"` → `"Product no longer exists or is inactive"`

For `sync-hubspot-bulk/route.ts`:
- Line 433: `"Guarded write — another process linked this SKU"` → `"Guarded write — another process linked this product"`
- Line 465: `"SKU no longer exists or is inactive"` → `"Product no longer exists or is inactive"`

For `stats/route.ts`:
- Line 55: `"[Inventory SKU Stats] Falling back to legacy query"` → `"[Inventory Product Stats] Falling back to legacy query"`
- Line 125: `"Error fetching SKU stats:"` → `"Error fetching product stats:"`
- Line 128: `"Failed to fetch SKU stats"` → `"Failed to fetch product stats"`

For `sync-skus/route.ts`:
- Line 175: `type: "INVENTORY_SKU_SYNCED"` → `type: "INVENTORY_PRODUCT_SYNCED"`
- Line 176: `"SKU sync: ${created} created, ${existing} existing..."` → `"Product sync: ${created} created, ${existing} existing..."`
- Line 200: `"Error syncing SKUs from HubSpot:"` → `"Error syncing products from HubSpot:"`
- Line 203: `"Failed to sync SKUs"` → `"Failed to sync products"`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/inventory/
git commit -m "copy: rename SKU → product in inventory API error messages and audit logs"
```

---

### Task 6: Products API routes + cleanup validation

**Files:**
- Modify: `src/app/api/products/cleanup/route.ts`
- Modify: `src/app/api/products/cleanup/confirm/route.ts`
- Modify: `src/app/api/products/comparison/create/route.ts`
- Modify: `src/lib/product-cleanup-engine.ts`

Only user-visible error/validation messages. Do NOT rename `"SKU exact"`, `"SKU partial"`, `"SKU differs"`, or `"SKU mismatch"` in the comparison route — those are match signals about the vendor part number field.

- [ ] **Step 1: Rename in cleanup/route.ts**

| Line | Old String | New String |
|------|-----------|------------|
| 130 | `` `Request must include between 1 and ${PRODUCT_CLEANUP_MAX_BATCH} unique SKU IDs.` `` | `` `...unique product IDs.` `` |
| 168 | `"Internal SKU not found."` | `"Internal product not found."` |
| 197 | `` `No ${source} link on internal SKU.` `` | `` `No ${source} link on internal product.` `` |
| 273 | `` `...product cleanup for ${internalSkuIds.length} SKU${...}` `` | `` `...product cleanup for ${internalSkuIds.length} product${...}` `` |

- [ ] **Step 2: Rename in cleanup/confirm/route.ts**

| Line | Old String | New String |
|------|-----------|------------|
| 33 | `"At least one internal SKU ID is required."` | `"At least one internal product ID is required."` |
| 42 | `` `A maximum of ${PRODUCT_CLEANUP_MAX_BATCH} unique SKU IDs is allowed per request.` `` | `` `...unique product IDs is allowed per request.` `` |
| 113 | `` `Request must include between 1 and ${PRODUCT_CLEANUP_MAX_BATCH} unique SKU IDs.` `` | `` `...unique product IDs.` `` |

- [ ] **Step 3: Rename in comparison/create/route.ts**

Check for user-visible error messages:
- `"Internal SKU not found"` → `"Internal product not found"`
- `"Internal SKU must have brand and model"` → `"Internal product must have brand and model"`

- [ ] **Step 4: Rename in product-cleanup-engine.ts**

This is the source of the cleanup messages. The route files import from here.

- Line 197: `"Deactivated internal SKU."` → `"Deactivated internal product."`
- Line 198: `"Internal SKU already inactive."` → `"Internal product already inactive."`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/products/ src/lib/product-cleanup-engine.ts
git commit -m "copy: rename SKU → product in products API error and validation messages"
```

---

### Task 7: Deferred Phase 1 display strings + lib files

**Files:**
- Modify: `src/lib/product-updates.ts`
- Modify: `src/lib/catalog-readiness.ts`

These were explicitly deferred from Phase 1 because they are user-visible display strings, not code references.

- [ ] **Step 1: Rename in product-updates.ts**

These are release-note entries displayed on the Updates page. The terms appear in `type: "internal"` and `type: "fix"` change entries:

| Line | Old String | New String |
|------|-----------|------------|
| 124 | `Catalog SKU listing replaced with a responsive card layout` | `Catalog product listing replaced with a responsive card layout` |
| 134 | `richer SKU management` | `richer product management` |
| 145 | `full internal SKU edit surface` | `full internal product edit surface` |
| 149 | `catalog SKU hard-delete` | `catalog product hard-delete` |
| 188 | `legacy schema fallback for SKU lookup` | `legacy schema fallback for product lookup` |
| 220 | `with SKU visibility` | `with product visibility` |
| 248 | `` added `zohoItemId` on `EquipmentSku` `` | `` added `zohoItemId` on `InternalProduct` `` |
| 253 | `` categories not stored in `EquipmentSku` `` | `` categories not stored in `InternalProduct` `` |
| 616 | `SKU auto-sync: one-click catalog population` | `Product auto-sync: one-click catalog population` |
| 620 | `Total SKUs` | `Total Products` |
| 624 | `New Prisma models: EquipmentSku, InventoryStock` | `New Prisma models: InternalProduct, InventoryStock` |

**DO NOT rename** these (historical API path references or vendor field references):
- Line 167: `SKU/dimension fields` — refers to the actual `sku` database field alongside dimension fields
- Line 625: `/api/inventory/sku-sync` — historical route path (Phase 3 territory)

- [ ] **Step 2: Rename in catalog-readiness.ts**

| Line | Old String | New String |
|------|-----------|------------|
| 28 | `"Will create/update EquipmentSku"` | `"Will create/update internal product"` |

- [ ] **Step 3: Commit**

```bash
git add src/lib/product-updates.ts src/lib/catalog-readiness.ts
git commit -m "copy: rename EquipmentSku/SKU → product in deferred Phase 1 display strings"
```

---

### Task 8: Verification sweep

- [ ] **Step 1: Grep for stale user-facing "SKU" meaning product record**

```bash
grep -rn '".*SKU.*"' --include="*.ts" --include="*.tsx" src/app/ src/lib/ | \
  grep -v "node_modules\|generated\|\.sku\|sku:\|sku ?\|SKU exact\|SKU partial\|SKU differs\|SKU mismatch\|\.sku}" | \
  grep -iv "vendor.*sku\|part.*sku\|sku.*field"
```

Review results manually. Any remaining "SKU" in user-visible strings that means "product record" must be fixed. Strings where "SKU" means the vendor part number field value are fine.

- [ ] **Step 2: Grep for remaining "EquipmentSku" in display strings**

```bash
grep -rn "EquipmentSku" --include="*.ts" --include="*.tsx" src/ | \
  grep -v "node_modules\|generated\|@@map\|@map\|equipment_sku\|bom-snapshot"
```

Expected: Zero results. All `EquipmentSku` references in source code were handled in Phase 1 and the deferred strings in Task 7. Note: `bom-snapshot.ts` contains `"EquipmentSku"` in raw SQL strings — these reference the physical DB table name and are correct.

- [ ] **Step 3: Grep for remaining "equipment_sku" audit entity type**

```bash
grep -rn "equipment_sku" --include="*.ts" --include="*.tsx" src/
```

Expected: Zero results after Task 5 renamed it to `internal_product`.

- [ ] **Step 4: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: Same pass/fail counts as baseline (80 passing, 5 pre-existing failures).

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: Zero new errors. (Pre-existing errors in backfill scripts are acceptable.)

- [ ] **Step 6: Dev server smoke test**

Start `npm run dev` and verify:
1. `/dashboards/inventory` — "Products Tracked" stat card, "Sync Products" button, no "SKU" in headings/labels
2. `/dashboards/catalog` — "Products" tab label, "Product Cleanup" section, "Product updated" toast
3. `/dashboards/product-comparison` — "internal product" in action buttons and messages, "SKU mismatch" signal still appears correctly

- [ ] **Step 7: Commit any fixes from Steps 1–3**

```bash
git add -A
git commit -m "copy: fix remaining stale SKU-as-record references"
```
