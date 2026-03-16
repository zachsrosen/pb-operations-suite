# InternalProduct Rename (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `EquipmentSku` Prisma model to `InternalProduct` across all TypeScript source code while keeping the physical DB table unchanged via `@@map`.

**Architecture:** Logical-only rename using Prisma's `@@map`/`@map` annotations so the DB schema stays identical. All `prisma.equipmentSku.*` calls become `prisma.internalProduct.*`, all `EquipmentSku` type references become `InternalProduct`, and all `.skuId` FK property accesses on spec/inventory tables become `.internalProductId`. No DB migration, no route path changes (those are Phase 3), no UI text changes (Phase 2).

**Tech Stack:** Prisma 7.3, TypeScript 5, Next.js 16.1

**Spec:** `docs/superpowers/specs/2026-03-15-equipment-sku-rename-design.md`

---

## Chunk 1: Schema + Core Libraries

### Task 1: Rename Prisma model with @@map

**Files:**
- Modify: `prisma/schema.prisma`

This is the foundation — everything else depends on the generated types from this change.

- [ ] **Step 1: Rename the model and add @@map**

In `prisma/schema.prisma`, rename `model EquipmentSku` to `model InternalProduct` and add `@@map("EquipmentSku")` inside the model body. The table stays as `EquipmentSku` in the DB.

All field names inside the model stay the same (including `sku`, `vendorName`, etc.). Only the model name changes.

- [ ] **Step 2: Rename FK fields on all 8 related models**

For each of these 7 spec tables — `ModuleSpec`, `InverterSpec`, `BatterySpec`, `EvChargerSpec`, `MountingHardwareSpec`, `ElectricalHardwareSpec`, `RelayDeviceSpec` — rename:
- `skuId` → `internalProductId` with `@map("skuId")`
- `sku` relation field → `internalProduct` (the relation to `InternalProduct`)
- Update the `@relation(fields: [...])` to reference `internalProductId`

For `InventoryStock`:
- `skuId` → `internalProductId` with `@map("skuId")`
- `sku` relation field → `internalProduct`
- Update `@@unique([internalProductId, location])` with `map: "InventoryStock_skuId_location_key"`
- Update `@@index([internalProductId])` with `map: "InventoryStock_skuId_idx"`

**Note:** There is no `BomLineItem` model with an `equipmentSkuId` FK in the schema. The `equipmentSkuId` that appears in the codebase is a TypeScript interface property in `bom-snapshot.ts`, handled in Task 2.

- [ ] **Step 3: Run prisma generate and verify**

```bash
npx prisma generate
npx tsc --noEmit 2>&1 | head -50
```

Expected: TypeScript errors in ~50 files referencing the old names. This confirms the schema rename took effect and shows us exactly what needs updating.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "refactor: rename EquipmentSku → InternalProduct in Prisma schema with @@map"
```

---

### Task 2: Rename in core library files

**Files:**
- Modify: `src/lib/bom-snapshot.ts` (~32 references — largest file, has raw SQL)
- Modify: `src/lib/catalog-sync.ts` (~3 references)
- Modify: `src/lib/catalog-sync-confirmation.ts` (~6 references)
- Modify: `src/lib/catalog-harvest.ts` (~2 references)
- Modify: `src/lib/catalog-readiness.ts` (~1 reference)
- Modify: `src/lib/product-cleanup-engine.ts` (~1 reference)
- Modify: `src/lib/product-updates.ts` (~3 references, comments only)
- Modify: `src/lib/bom-post-process.ts` (~1 reference, comment only)
- Modify: `src/lib/canonical.ts` (~1 reference, comment only)

- [ ] **Step 1: Rename in bom-snapshot.ts**

This is the most complex file. Apply these renames:
- `syncEquipmentSkus` function → `syncInternalProducts`
- `prisma.equipmentSku.*` → `prisma.internalProduct.*`
- `.skuId` property accesses → `.internalProductId`
- `equipmentSkuId` variable/property names → `internalProductId`
- **Raw SQL strings**: Any `"EquipmentSku"` in raw SQL must stay as `"EquipmentSku"` since that's the actual DB table name. Only rename Prisma query method calls and TypeScript references.
- Comments referencing `EquipmentSku` → `InternalProduct`

**Critical**: Read the file first. Look for any `prisma.$queryRaw` or `prisma.$executeRaw` with `"EquipmentSku"` — those reference the physical table name and must NOT be renamed.

- [ ] **Step 2: Rename in catalog-sync.ts**

- `prisma.equipmentSku.*` → `prisma.internalProduct.*`
- `.skuId` destructuring/access → `.internalProductId`

- [ ] **Step 3: Rename in catalog-sync-confirmation.ts**

- Interface properties `skuId: string` → `internalProductId: string`
- All property accesses `.skuId` → `.internalProductId`
- Function parameters using `skuId` → `internalProductId`

- [ ] **Step 4: Rename in remaining library files**

For each of `catalog-harvest.ts`, `catalog-readiness.ts`, `product-cleanup-engine.ts`:
- `prisma.equipmentSku.*` → `prisma.internalProduct.*`
- Comments mentioning `EquipmentSku` → `InternalProduct`

For `product-updates.ts`, `bom-post-process.ts`, `canonical.ts`:
- Comments only — update mentions of `EquipmentSku` → `InternalProduct`

- [ ] **Step 5: Run type check**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: Error count should decrease significantly from Step 3 of Task 1. Remaining errors should be in API routes, dashboards, tests, and scripts.

- [ ] **Step 6: Commit**

```bash
git add src/lib/
git commit -m "refactor: rename EquipmentSku → InternalProduct in library files"
```

---

## Chunk 2: API Routes

### Task 3: Rename in inventory API routes

**Files:**
- Modify: `src/app/api/inventory/skus/route.ts` (~10 references)
- Modify: `src/app/api/inventory/skus/merge/route.ts` (~16 references)
- Modify: `src/app/api/inventory/skus/sync-bulk/route.ts` (~9 references)
- Modify: `src/app/api/inventory/skus/sync-hubspot-bulk/route.ts` (~10 references)
- Modify: `src/app/api/inventory/skus/[id]/sync/route.ts` (~5 references)
- Modify: `src/app/api/inventory/skus/[id]/sync/confirm/route.ts` (~1 reference)
- Modify: `src/app/api/inventory/skus/stats/route.ts` (~2 references)
- Modify: `src/app/api/inventory/sync-skus/route.ts` (~3 references)
- Modify: `src/app/api/inventory/sync-zoho/route.ts` (~8 references)
- Modify: `src/app/api/inventory/transactions/route.ts` (~12 references)
- Modify: `src/app/api/inventory/stock/route.ts` (~1 reference)
- Modify: `src/app/api/inventory/stock/[id]/route.ts` (~1 reference)
- Modify: `src/app/api/inventory/needs/route.ts` (~4 references)

For every file in this task, apply these rename patterns:
- `prisma.equipmentSku.*` → `prisma.internalProduct.*`
- `EquipmentSku` type references → `InternalProduct`
- `.skuId` property accesses on spec/inventory objects → `.internalProductId`
- `skuId_location` compound unique accessor → `internalProductId_location` (Prisma renames this automatically when the FK field is renamed)
- `include: { sku: true }` on InventoryStock queries → `include: { internalProduct: true }`
- `.sku.` property chains on stock results (e.g., `row.sku.brand`) → `.internalProduct.` (e.g., `row.internalProduct.brand`)
- `key === "skuId"` string literal filters → `key === "internalProductId"`
- Variable names like `skuId` when they refer to the record's ID → leave as-is if they refer to the URL param `[id]`, rename if they refer to the FK
- Comments mentioning `EquipmentSku` → `InternalProduct`
- `entityType: "equipment_sku"` in audit log calls → **leave as-is** (deferred per spec)

- [ ] **Step 1: Rename in skus/route.ts (main CRUD)**

This is the largest inventory route. Read the full file first. Apply all renames. Watch for:
- The `EquipmentCategory` enum import — this stays unchanged
- `entityType: "equipment_sku"` — leave as-is
- `key === "skuId"` string literal in spec-key filtering → `key === "internalProductId"`
- Dynamic spec table access patterns that might use string literals

- [ ] **Step 2: Rename in skus/merge/route.ts**

This file has transaction-wrapped operations and dynamic table updates. Watch for:
- Dynamic spec table name strings (these reference Prisma model names, so they should be updated if they reference `equipmentSku`)
- `.skuId` in spec update logic
- `skuId_location` compound unique accessor → `internalProductId_location`
- `key === "skuId"` string literal → `key === "internalProductId"`

- [ ] **Step 3: Rename in remaining skus/ routes**

Apply the standard renames to: `sync-bulk/route.ts`, `sync-hubspot-bulk/route.ts`, `[id]/sync/route.ts`, `[id]/sync/confirm/route.ts`, `stats/route.ts`, `sync-skus/route.ts`, `sync-zoho/route.ts`.

For `[id]/sync/confirm/route.ts`: the call to `buildSyncConfirmation({ skuId: id })` must become `buildSyncConfirmation({ internalProductId: id })` to match the interface rename in Task 2 Step 3.

For `sync-zoho/route.ts`: watch for `skuId_location` compound unique accessor — rename to `internalProductId_location`.

- [ ] **Step 4: Rename in inventory stock, transactions, and needs routes**

For `transactions/route.ts` (~12 references):
- `skuId_location` compound unique accessor → `internalProductId_location`
- `skuId` in create data → `internalProductId`
- `include: { sku: true }` → `include: { internalProduct: true }`
- `.stock.sku` property chains → `.stock.internalProduct`
- `skuId` in metadata objects → `internalProductId`

For `stock/route.ts` and `stock/[id]/route.ts`:
- `include: { sku: true }` → `include: { internalProduct: true }`

For `needs/route.ts`:
- `include: { sku: true }` → `include: { internalProduct: true }`
- `.sku.category`, `.sku.brand`, `.sku.model` → `.internalProduct.category`, `.internalProduct.brand`, `.internalProduct.model`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/inventory/
git commit -m "refactor: rename EquipmentSku → InternalProduct in inventory API routes"
```

---

### Task 4: Rename in catalog and BOM API routes

**Files:**
- Modify: `src/app/api/catalog/search/route.ts` (~1 reference)
- Modify: `src/app/api/catalog/push-requests/[id]/approve/route.ts` (~5 references)
- Modify: `src/app/api/bom/save/route.ts` (~3 references)
- Modify: `src/app/api/bom/linked-products/add-zuper-part/route.ts` (~5 references)
- Modify: `src/app/api/bom/linked-products/add-hubspot-line-item/route.ts` (~5 references)
- Modify: `src/app/api/bom/linked-products/sync-missing/route.ts` (~4 references)

- [ ] **Step 1: Rename in catalog routes**

For `catalog/search/route.ts`:
- `prisma.equipmentSku.*` → `prisma.internalProduct.*`

For `catalog/push-requests/[id]/approve/route.ts`:
- `prisma.equipmentSku.*` → `prisma.internalProduct.*`
- `.skuId` in spec upsert logic → `.internalProductId`

- [ ] **Step 2: Rename in BOM routes**

For `bom/save/route.ts`:
- `syncEquipmentSkus` import → `syncInternalProducts` (matches Task 2 rename)
- Function calls accordingly

For the 3 `bom/linked-products/` routes:
- `prisma.equipmentSku.*` → `prisma.internalProduct.*`
- `.skuId` parameter/property → `.internalProductId`
- `loadSku` helper function (if local) — rename parameter but keep function name if it's just a local helper
- Comments mentioning `EquipmentSku` → `InternalProduct`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/catalog/ src/app/api/bom/
git commit -m "refactor: rename EquipmentSku → InternalProduct in catalog and BOM API routes"
```

---

### Task 5: Rename in products API routes

**Files:**
- Modify: `src/app/api/products/comparison/create/route.ts` (~2 references)
- Modify: `src/app/api/products/comparison/route.ts` (~1 reference)
- Modify: `src/app/api/products/comparison/metrics/route.ts` (~5 references)
- Modify: `src/app/api/products/comparison/truth-set/route.ts` (~1 reference)
- Modify: `src/app/api/products/link-diagnostics/route.ts` (~1 reference)
- Modify: `src/app/api/products/cleanup/route.ts` (~1 reference)

- [ ] **Step 1: Rename in all products routes**

For every file:
- `prisma.equipmentSku.*` → `prisma.internalProduct.*`

Most are simple single Prisma query renames. **Exception**: `comparison/create/route.ts` has a `key === "skuId"` string literal filter (line ~89) that filters spec record property keys — this must become `key === "internalProductId"` since spec records now use the renamed FK.

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: Remaining errors should only be in dashboard/UI, tests, and scripts.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/products/
git commit -m "refactor: rename EquipmentSku → InternalProduct in products API routes"
```

---

## Chunk 3: UI, Tests, Scripts, Skills, Verification

### Task 6: Rename in dashboard/UI components

**Files:**
- Modify: `src/app/dashboards/inventory/page.tsx` (~25 references — includes `.sku.` relation accesses)
- Modify: `src/app/dashboards/catalog/page.tsx` (~3 references)
- Modify: `src/app/dashboards/catalog/edit/[id]/page.tsx` (~10 references)
- Modify: `src/app/dashboards/bom/page.tsx` (~2 references)
- Modify: `src/app/dashboards/submit-product/page.tsx` (~1 reference)
- Modify: `src/components/catalog/SyncModal.tsx` (~6 references)

- [ ] **Step 1: Rename in inventory/page.tsx**

This is the most complex UI file. It has a local `interface EquipmentSku` type alias and many `.sku.` relation accesses on stock records. Rename:
- `interface EquipmentSku` → `interface InternalProduct`
- All uses of that type
- `.skuId` property accesses → `.internalProductId`
- `.sku.` relation accesses on stock records (e.g., `row.sku.brand`, `row.sku.model`, `row.sku.category`) → `.internalProduct.` (e.g., `row.internalProduct.brand`). These break because the API response shape changes when the Prisma `include` is renamed.

- [ ] **Step 2: Rename in catalog pages and SyncModal**

For `catalog/page.tsx`:
- `.skuId` property accesses → `.internalProductId`

For `catalog/edit/[id]/page.tsx`:
- The local `skuId` variable (derived from URL param or API response) may stay as-is if it's just a local name
- The `skuId={skuId}` JSX prop passed to `SyncModal` → `internalProductId={skuId}` (must match the renamed SyncModal interface property)

For `SyncModal.tsx`:
- Interface property `skuId: string` → `internalProductId: string`
- All property uses of `.skuId` → `.internalProductId`

- [ ] **Step 3: Rename in BOM and submit-product pages**

For `bom/page.tsx`:
- `.skuId` property accesses → `.internalProductId`

For `submit-product/page.tsx`:
- Any `equipmentSkuId` or `skuId` filter references → update accordingly

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/ src/components/catalog/
git commit -m "refactor: rename EquipmentSku → InternalProduct in dashboard and UI components"
```

---

### Task 7: Rename in test files

**Files:**
- Modify: `src/__tests__/api/catalog-push-approve.test.ts` (~4 references)
- Modify: `src/__tests__/api/bom-create-po.test.ts` (~1 reference)
- Modify: `src/__tests__/lib/catalog-harvest.test.ts` (~1 reference)
- Modify: `src/__tests__/lib/catalog-sync-confirmation.test.ts` (~16 references)
- Modify: `src/__tests__/lib/product-cleanup-engine.test.ts` (~1 reference)
- Modify: `src/__tests__/api/products-cleanup.test.ts` (~1 reference)

- [ ] **Step 1: Rename in catalog-sync-confirmation.test.ts**

This has the most references (~16). Rename:
- `skuId` in test fixtures and assertions → `internalProductId`
- Interface property references

- [ ] **Step 2: Rename in catalog-push-approve.test.ts**

- Mock data `equipmentSku: { ... }` → `internalProduct: { ... }` in Prisma mock setup
- `.skuId` assertions → `.internalProductId`

- [ ] **Step 3: Rename in remaining test files**

For each of `bom-create-po.test.ts`, `catalog-harvest.test.ts`, `product-cleanup-engine.test.ts`, `products-cleanup.test.ts`:
- `equipmentSku: {}` in mock data → `internalProduct: {}`

- [ ] **Step 4: Run tests**

```bash
npx jest --passWithNoTests 2>&1 | tail -5
```

Expected: All previously-passing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/
git commit -m "refactor: rename EquipmentSku → InternalProduct in test files"
```

---

### Task 8: Rename in scripts

**Files:**
- Modify: `scripts/backfill-vendor-ids.ts` (~3 references)
- Modify: `scripts/backfill-canonical-keys.ts` (~5 references, includes raw SQL)
- Modify: `scripts/test-shadow.ts` (~2 references)

- [ ] **Step 1: Rename in all scripts**

For `backfill-vendor-ids.ts`:
- `prisma.equipmentSku.*` → `prisma.internalProduct.*`

For `backfill-canonical-keys.ts`:
- `prisma.equipmentSku.*` → `prisma.internalProduct.*`
- **Raw SQL strings**: Any `"EquipmentSku"` in `$executeRaw` or `$queryRaw` must stay as `"EquipmentSku"` — that's the physical table name
- Comments → update

For `test-shadow.ts`:
- `syncEquipmentSkus` import → `syncInternalProducts`

- [ ] **Step 2: Commit**

```bash
git add scripts/
git commit -m "refactor: rename EquipmentSku → InternalProduct in scripts"
```

---

### Task 9: Rename in .claude/skills reference files

**Files:**
- Modify: `.claude/skills/planset-bom/SKILL.md`
- Modify: `.claude/skills/planset-bom/references/bom-schema.md`
- Modify: `.claude/skills/planset-bom/references/extraction-guide.md`
- Modify: `.claude/skills/bom-to-so/SKILL.md`
- Modify: `.claude/skills/bom-to-so/references/post-processor-rules.md`

- [ ] **Step 1: Rename in all skill files**

For every file:
- `EquipmentSku` → `InternalProduct`
- `equipmentSku` → `internalProduct`
- `equipment_sku` → `internal_product` (only in descriptive text, not audit entityType)

These are documentation files used by AI agents — they should reflect current naming.

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/
git commit -m "refactor: rename EquipmentSku → InternalProduct in AI skill reference docs"
```

---

### Task 10: Verification sweep

- [ ] **Step 1: Grep for stale references**

```bash
# Should return zero results (excluding generated/, node_modules/, @@map/@map, migration files, docs/plans/, docs/superpowers/)
grep -r "EquipmentSku\|equipmentSku" --include="*.ts" --include="*.tsx" --include="*.md" \
  --exclude-dir=node_modules --exclude-dir=generated --exclude-dir=migrations \
  src/ scripts/ .claude/skills/ | grep -v "@@map\|@map\|equipment_sku"
```

Expected: Zero results. If any remain, fix them.

- [ ] **Step 2: Check for stale .skuId references (excluding the sku field itself)**

```bash
grep -rn "\.skuId\b" --include="*.ts" --include="*.tsx" src/ scripts/ | grep -v "node_modules\|generated"
```

Expected: Zero results. Any remaining `.skuId` references on spec/inventory objects need renaming to `.internalProductId`.

- [ ] **Step 2b: Check for stale `.sku` relation includes on InventoryStock queries**

```bash
grep -rn "include.*\bsku\b" --include="*.ts" --include="*.tsx" src/ scripts/ | grep -v "node_modules\|generated"
```

Expected: Zero results. Any remaining `include: { sku: true }` on InventoryStock queries must become `include: { internalProduct: true }`. Also check for `.sku.` property chains on stock query results.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: Zero new errors. Pre-existing errors (backfill script, expire-pending test) are acceptable.

- [ ] **Step 4: Run full test suite**

```bash
npm run test 2>&1 | tail -10
```

Expected: All previously-passing tests still pass. No new failures.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 6: Manual runtime check**

Start the dev server (`npm run dev`) and verify the inventory and catalog pages load without runtime errors. This matches the spec's success criteria.

- [ ] **Step 7: Final commit (if any fixes from Steps 1-2b)**

```bash
git add src/ scripts/ .claude/skills/
git commit -m "refactor: fix remaining stale EquipmentSku references"
```
