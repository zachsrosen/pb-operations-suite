# EquipmentSku → InternalProduct Rename — Design Spec

**Date**: 2026-03-15
**Status**: Draft
**Scope**: Rename the `EquipmentSku` Prisma model to `InternalProduct` across the codebase in a phased approach that separates the logical rename from physical DB changes.

## Problem

The `EquipmentSku` model represents a canonical product record in our catalog — the internal source of truth that syncs to Zoho Inventory, HubSpot, and Zuper. The name is confusing because `sku` is also a string field on the same model (a vendor part identifier). Developers and users regularly conflate "the SKU record" with "the SKU value," creating ambiguity in conversations, code reviews, and UI text.

## Design Decisions

| Question | Decision |
|----------|----------|
| New model name | `InternalProduct` — distinguishes from HubSpot product, Zoho item, Zuper part |
| New FK name on spec tables | `internalProductId` (mapped to existing `skuId` column) |
| DB table rename | Deferred (Phase 4, optional) — use `@@map("EquipmentSku")` |
| API route rename | Phase 3 with compatibility handlers on old paths |
| `PendingCatalogPush` | Unchanged — different concept (a request to push to all 4 catalogs) |
| `sku` field | Unchanged — still a real SKU string value, still labeled "SKU" in UI |
| Audit log `entityType` | Deferred — keep `equipment_sku` until consumers are updated |

## Phase 1: Logical Rename (Prisma Model + TypeScript)

### Prisma Schema Changes

Rename the model while mapping to the existing DB table and columns:

```prisma
model InternalProduct {
  @@map("EquipmentSku")

  id              String   @id @default(cuid())
  // ... all existing fields unchanged ...

  // Spec relations — FK column stays as skuId in DB
  moduleSpec             ModuleSpec?
  inverterSpec           InverterSpec?
  batterySpec            BatterySpec?
  evChargerSpec          EvChargerSpec?
  mountingHardwareSpec   MountingHardwareSpec?
  electricalHardwareSpec ElectricalHardwareSpec?
  relayDeviceSpec        RelayDeviceSpec?

  // Inventory relation — FK column stays as skuId in DB
  inventoryStocks        InventoryStock[]
}
```

Each spec table's FK field renames in the Prisma model but maps to the existing column:

```prisma
model ModuleSpec {
  internalProductId String @unique @map("skuId")
  internalProduct   InternalProduct @relation(fields: [internalProductId], references: [id], onDelete: Cascade)
  // ... rest unchanged ...
}
```

Same pattern for all 7 spec tables (`InverterSpec`, `BatterySpec`, `EvChargerSpec`, `MountingHardwareSpec`, `ElectricalHardwareSpec`, `RelayDeviceSpec`).

`InventoryStock` also has a `skuId` FK plus compound constraints:

```prisma
model InventoryStock {
  internalProductId String          @map("skuId")
  internalProduct   InternalProduct @relation(fields: [internalProductId], references: [id])
  // ... rest unchanged ...
  @@unique([internalProductId, location], map: "InventoryStock_skuId_location_key")
  @@index([internalProductId], map: "InventoryStock_skuId_idx")
}
```

### Source Code Changes

All references across ~38 source files (use grep to find the exact set — do not rely on this count):

- `prisma.equipmentSku.*` → `prisma.internalProduct.*`
- `EquipmentSku` type imports → `InternalProduct`
- `EquipmentCategory` enum — unchanged (still describes the category of equipment)
- `.skuId` property access on spec objects → `.internalProductId`

### Non-Prisma String References

TypeScript catches Prisma query renames, but these must be found manually:

- Log messages referencing "EquipmentSku" or "equipment_sku"
- Test fixture data and snapshot strings
- Script comments and doc references
- Analytics/reporting filters (if any)

**Exception**: `entityType: "equipment_sku"` in audit logs stays as-is in this phase (see Audit Log Strategy below).

Update `.claude/skills/` reference files that mention `EquipmentSku` — these are used by AI agents and should reflect current naming. Docs in `docs/plans/` and `docs/superpowers/` are historical artifacts and can be left as-is.

All TypeScript type references to `EquipmentSku` are renamed in Phase 1, including those in dashboard page components. Phase 2 only covers user-visible string literals and labels.

### Audit Log Strategy

The `entityType: "equipment_sku"` value in `logActivity()` calls is **not renamed in Phase 1**. Reason: existing audit log rows use this value, and any dashboard/report/filter querying by entity type would fragment if new rows use a different string.

Before renaming:
1. Identify all consumers that filter on `entityType` (admin dashboards, reporting queries)
2. Update them to accept both `"equipment_sku"` and `"internal_product"`
3. Only then switch the write-side value

This can happen in Phase 2 or later.

### Success Criteria

- `npx tsc --noEmit` passes with zero errors
- `npm run test` — all currently-passing tests still pass
- `npm run build` completes successfully
- App starts and loads the inventory/catalog pages without runtime errors
- Prisma queries work against the existing DB with no migration needed
- Grep for `EquipmentSku` and `equipmentSku` in source files (excluding `generated/`, `node_modules/`, `@@map`/`@map` annotations) returns zero results
- Rollback: git revert the PR. No DB migration was created, so no DB rollback is needed

## Phase 2: UI Language

Update user-facing text where "SKU" refers to the record (not the `sku` field value):

- Inventory page headings/labels that say "SKU" meaning "product record"
- Toast messages like "Deleted {name or SKU}" → "Deleted {name or product}"
- Product comparison page references to "internal SKU" → "internal product"
- Error messages like "No internal SKU found" → "No internal product found"

The `sku` field label stays "SKU" everywhere — that's the actual vendor part identifier.

### Success Criteria

- No user-facing text uses "SKU" to mean "the product record"
- The `sku` field is still labeled "SKU" in forms and display

## Phase 3: API Route Paths

### New Routes

Move route implementations from `src/app/api/inventory/skus/` to `src/app/api/inventory/products/`:

- `/api/inventory/products` — main CRUD
- `/api/inventory/products/[id]/sync` — sync single product
- `/api/inventory/products/[id]/sync/confirm` — confirm sync
- `/api/inventory/products/merge` — merge duplicates
- `/api/inventory/products/stats` — statistics
- `/api/inventory/products/sync-bulk` — bulk sync
- `/api/inventory/products/sync-bulk/confirm` — confirm bulk sync
- `/api/inventory/products/sync-enabled` — sync enabled
- `/api/inventory/products/sync-hubspot-bulk` — HubSpot bulk sync
- `/api/inventory/products/sync-hubspot-bulk/confirm` — confirm HubSpot sync

Also rename the standalone route outside the `skus/` tree:

- `/api/inventory/sync-skus` → `/api/inventory/sync-products` (with compatibility wrapper at old path)

### Compatibility Handlers

Keep `/api/inventory/skus/**` as thin wrappers that call the same implementation — **not HTTP redirects**. POST/PATCH/DELETE redirects are unreliable across clients. Each old route file imports and re-exports the handler from the new location:

```typescript
// src/app/api/inventory/skus/route.ts (compatibility wrapper)
export { GET, POST, PATCH, DELETE } from "@/app/api/inventory/products/route";
```

Same pattern for all sub-routes. Wrappers stay for at least one release cycle.

### Internal Callers

Update all `fetch("/api/inventory/skus/...")` calls in the app to use `/api/inventory/products/...`. The compatibility wrappers exist for external/bookmark/script callers, not for the app itself.

### Success Criteria

- Both `/api/inventory/products/**` and `/api/inventory/skus/**` return identical responses for all methods
- All internal fetch calls use the new paths
- Old paths logged as deprecated (optional)

## Phase 4: Physical DB Rename (Optional, Later)

Only pursue if the `@@map`/`@map` indirection becomes annoying in practice.

- Single Prisma migration renames table `EquipmentSku` → `InternalProduct`
- Renames FK columns `skuId` → `internalProductId` on all 8 related tables (7 spec tables + `InventoryStock`)
- Remove `@@map` and `@map` annotations from schema
- Requires brief downtime or careful deploy ordering

This phase has no deadline and may never be needed.

## Out of Scope

- Renaming `PendingCatalogPush` (different concept, name is accurate)
- Renaming `EquipmentCategory` enum (still describes equipment categories)
- Renaming the `sku` field (it's a real SKU value, not the model name)
- Renaming `/api/products/**` comparison routes (separate concern)
- Renaming `/api/catalog/**` routes (already well-named)
