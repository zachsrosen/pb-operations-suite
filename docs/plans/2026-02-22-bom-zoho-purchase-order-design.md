# BOM → Zoho Purchase Order

**Date:** 2026-02-22
**Status:** Approved

## Summary

From the BOM page, after a BOM is saved and a HubSpot project is linked, allow users to create a draft Purchase Order in Zoho Inventory with one click. Line items are matched to Zoho catalog items via a `zohoItemId` stored on `EquipmentSku`; unmatched items fall back to description-only lines.

## Architecture

### 1. Schema Change — `EquipmentSku.zohoItemId`

Add an optional `zohoItemId String?` field to the `EquipmentSku` Prisma model. This is the permanent mapping between a PB SKU and a Zoho Inventory item ID. Populated manually via the inventory admin UI or a future sync job.

### 2. Zoho Client — New Methods

Extend `ZohoInventoryClient` in `src/lib/zoho-inventory.ts` with:

- `listVendors()` — `GET /contacts?contact_type=vendor` → returns `{ contact_id, contact_name }[]`
- `createPurchaseOrder(payload)` — `POST /purchaseorders` → returns `{ purchaseorder_id, purchaseorder_number }`

The existing token refresh / retry logic applies to both new methods.

### 3. API Routes

**`GET /api/bom/zoho-vendors`**
Returns vendor list from Zoho for the vendor selector dropdown. Cached for 5 minutes (vendors rarely change). Auth: same roles as BOM save.

**`POST /api/bom/create-po`**
Body: `{ dealId, version, vendorId }`

Flow:
1. Load `ProjectBomSnapshot` for `(dealId, version)` — 404 if not found
2. For each BOM item, look up `EquipmentSku` by `(category, brand, model)` to find `zohoItemId`
3. Build Zoho PO payload:
   - `vendor_id`: from request body
   - `reference_number`: deal name (e.g. `PROJ-9082 Kling`)
   - `notes`: `"Generated from PB Ops BOM v{n} — {address}"`
   - `status`: `"draft"`
   - `line_items`: each BOM item as `{ item_id?, name, quantity, description }`
     - If `zohoItemId` exists: include `item_id`
     - If not: omit `item_id` (description-only line)
4. `POST /purchaseorders` to Zoho
5. Store returned `purchaseorder_id` on the snapshot (`zohoPoId String?` field on `ProjectBomSnapshot`)
6. Return `{ purchaseorder_id, purchaseorder_number, unmatchedCount }`

### 4. BOM Page UI

**Vendor selector + Create PO button** — shown in the action bar when:
- `savedVersion !== null` (BOM is saved)
- `linkedProject !== null` (project is linked)
- Zoho is configured (`ZOHO_INVENTORY_ORG_ID` env var present)

**States:**
- No PO yet: dropdown to select vendor + "Create PO in Zoho" button
- Creating: spinner + "Creating PO…"
- Success: button replaced by "View PO in Zoho →" link (opens `https://inventory.zoho.com/app#/purchaseorders/{id}`)
- Already exists: "View PO in Zoho →" shown immediately (from stored `zohoPoId`)

**Success toast:** "PO created in Zoho" + warning if `unmatchedCount > 0`: "{n} items had no Zoho SKU match — added as description-only lines"

## Data Flow

```
BOM page
  → GET /api/bom/zoho-vendors        (populate vendor dropdown)
  → POST /api/bom/create-po          (create PO)
      → DB: load ProjectBomSnapshot
      → DB: lookup EquipmentSku zohoItemId per item
      → Zoho: POST /purchaseorders
      → DB: store zohoPoId on snapshot
  → toast success + "View PO →" link
```

## Schema Changes

```prisma
model EquipmentSku {
  // ... existing fields ...
  zohoItemId  String?   // Zoho Inventory item_id for PO line item matching
}

model ProjectBomSnapshot {
  // ... existing fields ...
  zohoPoId    String?   // Zoho PO ID once created
}
```

## Error Handling

| Scenario | Behavior |
|---|---|
| BOM not saved | Button disabled, tooltip "Save BOM first" |
| No project linked | Button hidden |
| Zoho not configured | Button hidden |
| PO already exists | Show "View PO in Zoho →" instead of create button |
| Item has no `zohoItemId` | Description-only line; warn in toast after success |
| Zoho API error | Toast error, no partial PO |
| Vendor not selected | Button disabled |

## Out of Scope

- Automatically sending/issuing the PO (stays as draft)
- Pricing / cost fields (Zoho fills these in from item catalog)
- Splitting into multiple POs by vendor category
- Itemized receipts (separate future feature)
