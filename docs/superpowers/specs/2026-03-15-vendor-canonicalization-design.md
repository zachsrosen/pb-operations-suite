# Vendor Canonicalization + Picker — Design Spec

**Date**: 2026-03-15
**Status**: Draft
**Scope**: Canonicalize the `vendorName` field (supplier/distributor) on catalog products using Zoho Inventory vendor records as the source of truth. Brand (manufacturer) is unchanged.

## Problem

`vendorName` on `EquipmentSku` and `PendingCatalogPush` is a free-text string. Users enter the same supplier differently ("Rell Power" vs "RELL POWER" vs "Rell power Inc"), creating inconsistency that propagates to Zoho Inventory, HubSpot, and Zuper. There is no validation, no canonical list, and no durable identity link.

## Design Decisions

| Question | Decision |
|----------|----------|
| Source of truth for vendor list | Zoho Inventory vendor records |
| Storage approach | `VendorLookup` table synced from Zoho; `brand` string on SKU/push unchanged |
| Free-text fallback | None — picker-only, must select from list |
| Identity model | `zohoVendorId` stored on SKU/push as durable identity; `vendorName` stored as point-in-time snapshot |
| Display name source | `VendorLookup.name` (whatever Zoho has) |
| Sync frequency | Every 6 hours via Vercel cron + manual admin trigger |
| Brand field | Unchanged — stays as `MANUFACTURERS` array + `BrandDropdown` |

## Section 1: Data Model & Sync

### New Prisma Model

```prisma
model VendorLookup {
  id              String   @id @default(cuid())
  zohoVendorId    String   @unique    // durable identity from Zoho
  name            String              // display name, updated on sync
  isActive        Boolean  @default(true)
  lastSyncedAt    DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([isActive, name])           // common query: active vendors sorted by name
}
```

### Changes to Existing Tables

Add nullable `zohoVendorId` to both product tables:

```prisma
model EquipmentSku {
  // existing vendorName: String? stays as point-in-time snapshot
  zohoVendorId    String?             // durable identity link
  @@index([zohoVendorId])
}

model PendingCatalogPush {
  // existing vendorName: String? stays as point-in-time snapshot
  zohoVendorId    String?             // set when user picks from dropdown
  @@index([zohoVendorId])
}
```

The picker writes both `vendorName` (from `VendorLookup.name`) and `zohoVendorId` into form state. If Zoho renames a vendor later, a sync updates `VendorLookup.name`. Existing `vendorName` on SKUs/pushes stays as a historical snapshot of what was selected at submission time.

### Sync Mechanism

**POST `/api/catalog/vendors/sync`**:
- **Auth**: Admin-only (role check via `getServerSession`) + Vercel cron via `Authorization: Bearer CRON_SECRET` env var
- **Pagination**: Reuses existing `zohoClient.listVendors()` which calls `listContacts("vendor")` with `page` + `per_page` + `has_more_page` loop (already implemented in `zoho-inventory.ts:919-944`)
- **Upsert logic**: Match by `zohoVendorId`. If Zoho returns a new name for the same ID, update `VendorLookup.name` (canonical source).
- **Soft delete**: If a Zoho vendor disappears from the response, set `isActive = false` rather than deleting (existing SKUs may reference that name)
- **Failure handling**: If Zoho is unreachable, log the error and leave existing `VendorLookup` rows untouched (stale data > no data). Return 502 so the admin UI can surface it.

**GET `/api/catalog/vendors`**:
- Default: returns active vendors only, sorted by name
- Accepts `?includeId=<zohoVendorId>`: if the caller's current value references an inactive vendor, include it in the response so edit screens still render

## Section 2: Form & UI Changes

### VendorPicker Component

New component modeled after existing `BrandDropdown`:
- Searchable dropdown reading from `GET /api/catalog/vendors`
- Shows vendor names as labels; stores both `vendorName` + `zohoVendorId` in form state
- No free-text / custom entry — if the vendor isn't in the list, user cannot submit it
- Empty/clear option since `vendorName` is optional
- "Refresh vendors" button triggers a client-side re-fetch of the vendor list
- If vendor still not found after refresh: show message "Vendor not found — contact admin to add it in Zoho" rather than a dead end

### Form State Changes (`catalog-form-state.ts`)

- Add `zohoVendorId: string` to `CatalogFormState` (defaults to `""`)
- New action `SET_VENDOR`: sets both `vendorName` and `zohoVendorId` atomically — this is what the picker dispatches
- `SET_FIELD` for `vendorName` also clears `zohoVendorId` as a defensive invariant (normal path is `SET_VENDOR`)

### DetailsStep Integration

- Replace the free-text vendor input in `DetailsStep.tsx` with `<VendorPicker>`
- Vendor Part Number input stays as free-text (unchanged)

### Clone/Import/Prefill Paths

- **`PREFILL_FROM_PRODUCT` (clone)**: if source SKU has both `vendorName` and `zohoVendorId`, copy both (valid pair). If source SKU has `vendorName` but no `zohoVendorId` (legacy data), treat `vendorName` as a hint — show it as placeholder text in the picker but leave `zohoVendorId` blank, requiring the user to re-select from the list. Clears `vendorPartNumber` (existing behavior).
- **`PREFILL_FROM_DATASHEET` (AI import)**: extraction may return a vendor string. Server-side matching rule:
  - Exact match or normalized-exact match against `VendorLookup.name` → set `zohoVendorId`
  - **Normalization rule**: case-insensitive, trim whitespace, strip trailing suffixes (Inc, LLC, Corp, Ltd, Co). Example: "SolarEdge Technologies Inc" normalizes to "solaredge technologies" for comparison.
  - If no match: return the extracted string as a hint (shown as placeholder text in the picker), but leave `zohoVendorId` blank — user must pick manually
- **URL query param prefill**: if `vendorName` is provided via query param, attempt exact match against `VendorLookup` to resolve `zohoVendorId`; if no match, leave `zohoVendorId` blank for user selection

## Section 3: Server Validation & Downstream Sync

### POST `/api/catalog/push-requests` — Pair-Aware Validation

All four cases handled explicitly:

| `vendorName` | `zohoVendorId` | Result |
|--------------|----------------|--------|
| blank | blank | Allowed (vendor is optional) |
| present | blank | 400: "Vendor must be selected from the list" |
| blank | present | 400: "Vendor ID provided without vendor name" |
| present | present | Load `VendorLookup` by `zohoVendorId`; verify `vendorName === VendorLookup.name` → 400 if mismatched or not found |

On the valid case (both present, matching): `VendorLookup.name` is the canonical source for the equality check. The submitted `vendorName` is persisted as the point-in-time snapshot after validation passes.

### Approval Route (`/api/catalog/push-requests/[id]/approve`)

- Copies `zohoVendorId` from push record to `EquipmentSku` on upsert
- Downstream systems receive both values where applicable:
  - **Zoho Inventory**: send both `vendor_id` (from `zohoVendorId`) and `vendor_name` when `zohoVendorId` is present. The `ZohoItemPayload` interface already has a `vendor_id` field (line 31 of `zoho-inventory.ts`) — currently unused. Phase 1 wires it up. **Important**: `createOrUpdateItem()` currently only does a best-effort `group_name` update on existing item matches — it does not update vendor fields on the existing-item path. This must be extended so that `vendor_id` and `vendor_name` are included in the existing-item update payload too, not just new-item creation. Otherwise vendor canonicalization silently misses already-matched Zoho items.
  - **HubSpot**: continues receiving `vendorName` string for the `vendor_name` property (no vendor ID concept in HubSpot)
  - **Zuper**: continues receiving `vendorName` string

### All-Writers Constraint

Any code path that creates or updates an `EquipmentSku` must preserve or update `zohoVendorId` alongside `vendorName`. This applies to:
- Approval route (covered above)
- Future SKU edit flows
- Any bulk sync or import scripts

This constraint prevents the identity field from quietly drifting out of sync with the display name.

## Section 4: Migration & Backfill

### Schema Migration

1. Create `VendorLookup` table with `@unique` on `zohoVendorId` and `@@index([isActive, name])`
2. Add nullable `zohoVendorId String?` to `EquipmentSku` and `PendingCatalogPush`
3. Add `@@index([zohoVendorId])` on both tables

The `@unique` constraint on `zohoVendorId` must be explicit in the migration SQL, not just implied by the Prisma model annotation.

### Initial Data Seed

- Run vendor sync once after migration to populate `VendorLookup` from Zoho
- No automatic backfill of `zohoVendorId` on existing SKUs — existing records predate the picker and their `vendorName` values may not match Zoho names exactly

### Optional Manual Backfill (Admin Tool, Not Blocking)

Script at `scripts/backfill-vendor-ids.ts`, invoked as `npx tsx scripts/backfill-vendor-ids.ts [--apply]`. Run manually after the initial vendor sync populates `VendorLookup`.

- **Default mode (dry-run)**: prints a report of matched and unmatched records, no writes
- **Apply mode (`--apply`)**: writes `zohoVendorId` for confirmed matches
- Matching rule: exact or normalized-exact (same normalization as datasheet import — case-insensitive, trim, strip suffixes) against `VendorLookup.name` only — no fuzzy auto-linking
- Logs unmatched records for manual review
- Not blocking: SKUs without a `zohoVendorId` remain functional, they just lack the durable identity link

### `MANUFACTURERS` Array

Stays as-is. It powers the brand picker (`BrandDropdown`), which is unchanged in this work. Brand and vendor are separate concerns.

## Out of Scope

- Brand/manufacturer canonicalization (separate follow-up track)
- Vendor creation UI (vendors are managed in Zoho, not in this app)
- Upgrading to FK-based vendor linkage (Approach A from brainstorming — additive later if needed)
- Automatic backfill of historical SKUs (manual tool provided, not auto-run)
