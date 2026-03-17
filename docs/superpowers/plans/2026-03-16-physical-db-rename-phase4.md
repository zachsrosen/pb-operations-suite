# Physical DB Rename (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all `@@map` and `@map` Prisma directives so the physical Postgres table, columns, indexes, and constraints match the logical model names — completing the `EquipmentSku` → `InternalProduct` rename at the database level.

**Architecture:** Hand-write a Prisma migration SQL file that uses `ALTER ... RENAME` statements (metadata-only, instant). Edit `prisma/schema.prisma` to remove mapping directives and rename the `INVENTORY_SKU_SYNCED` enum value. Update 6 source files: 4 enum value references plus 2 raw-SQL files that hardcode the table name. Deploy as a brief coordinated cutover (code + migration applied together). Validate with `prisma migrate dev` to confirm Prisma agrees the schema is in sync after our manual migration.

**Tech Stack:** Prisma 7.3, Neon Postgres, TypeScript 5

**Depends on:** Phase 1 (PR #87) ✅, Phase 2 (PR #90) ✅, Phase 3 (PR #93) ✅

---

## DB Object Inventory

Everything that changes in Postgres. All operations are `ALTER ... RENAME` (metadata-only, instant, no locks beyond AccessExclusiveLock for the brief rename).

### Table rename (1)

| Old Name | New Name |
|---|---|
| `"EquipmentSku"` | `"InternalProduct"` |

### Enum value rename (1)

| Type | Old Value | New Value |
|---|---|---|
| `"ActivityType"` | `INVENTORY_SKU_SYNCED` | `INVENTORY_PRODUCT_SYNCED` |

### Column renames (8 — all `"skuId"` → `"internalProductId"`)

| Table | Old Column | New Column |
|---|---|---|
| `ModuleSpec` | `skuId` | `internalProductId` |
| `InverterSpec` | `skuId` | `internalProductId` |
| `BatterySpec` | `skuId` | `internalProductId` |
| `EvChargerSpec` | `skuId` | `internalProductId` |
| `MountingHardwareSpec` | `skuId` | `internalProductId` |
| `ElectricalHardwareSpec` | `skuId` | `internalProductId` |
| `RelayDeviceSpec` | `skuId` | `internalProductId` |
| `InventoryStock` | `skuId` | `internalProductId` |

### Index renames (18)

**On InternalProduct (was EquipmentSku):**

| Old Name | New Name |
|---|---|
| `EquipmentSku_pkey` | `InternalProduct_pkey` |
| `EquipmentSku_category_brand_model_key` | `InternalProduct_category_brand_model_key` |
| `EquipmentSku_category_idx` | `InternalProduct_category_idx` |
| `EquipmentSku_isActive_idx` | `InternalProduct_isActive_idx` |
| `EquipmentSku_vendorPartNumber_idx` | `InternalProduct_vendorPartNumber_idx` |
| `EquipmentSku_hubspotProductId_idx` | `InternalProduct_hubspotProductId_idx` |
| `EquipmentSku_zuperItemId_idx` | `InternalProduct_zuperItemId_idx` |
| `EquipmentSku_zohoItemId_idx` | `InternalProduct_zohoItemId_idx` |
| `EquipmentSku_canonicalKey_idx` | `InternalProduct_canonicalKey_idx` |
| `EquipmentSku_canonicalBrand_canonicalModel_idx` | `InternalProduct_canonicalBrand_canonicalModel_idx` |
| `EquipmentSku_zohoVendorId_idx` | `InternalProduct_zohoVendorId_idx` |

**On spec tables (unique indexes on renamed columns):**

| Old Name | New Name |
|---|---|
| `ModuleSpec_skuId_key` | `ModuleSpec_internalProductId_key` |
| `InverterSpec_skuId_key` | `InverterSpec_internalProductId_key` |
| `BatterySpec_skuId_key` | `BatterySpec_internalProductId_key` |
| `EvChargerSpec_skuId_key` | `EvChargerSpec_internalProductId_key` |
| `MountingHardwareSpec_skuId_key` | `MountingHardwareSpec_internalProductId_key` |
| `ElectricalHardwareSpec_skuId_key` | `ElectricalHardwareSpec_internalProductId_key` |
| `RelayDeviceSpec_skuId_key` | `RelayDeviceSpec_internalProductId_key` |

### Constraint renames (10)

**FK constraints (8):**

| Table | Old Name | New Name |
|---|---|---|
| `ModuleSpec` | `ModuleSpec_skuId_fkey` | `ModuleSpec_internalProductId_fkey` |
| `InverterSpec` | `InverterSpec_skuId_fkey` | `InverterSpec_internalProductId_fkey` |
| `BatterySpec` | `BatterySpec_skuId_fkey` | `BatterySpec_internalProductId_fkey` |
| `EvChargerSpec` | `EvChargerSpec_skuId_fkey` | `EvChargerSpec_internalProductId_fkey` |
| `MountingHardwareSpec` | `MountingHardwareSpec_skuId_fkey` | `MountingHardwareSpec_internalProductId_fkey` |
| `ElectricalHardwareSpec` | `ElectricalHardwareSpec_skuId_fkey` | `ElectricalHardwareSpec_internalProductId_fkey` |
| `RelayDeviceSpec` | `RelayDeviceSpec_skuId_fkey` | `RelayDeviceSpec_internalProductId_fkey` |
| `InventoryStock` | `InventoryStock_skuId_fkey` | `InventoryStock_internalProductId_fkey` |

**InventoryStock named constraints (2):**

| Old Name | New Name |
|---|---|
| `InventoryStock_skuId_location_key` | `InventoryStock_internalProductId_location_key` |
| `InventoryStock_skuId_idx` | `InventoryStock_internalProductId_idx` |

### Code changes (6 files)

**Enum value renames (4 files):**

| File | Line | Old | New |
|---|---|---|---|
| `src/app/api/inventory/sync-products/route.ts` | 175 | `"INVENTORY_SKU_SYNCED"` | `"INVENTORY_PRODUCT_SYNCED"` |
| `src/app/api/bom/save/route.ts` | 35 | `"INVENTORY_SKU_SYNCED"` | `"INVENTORY_PRODUCT_SYNCED"` |
| `src/lib/bom-snapshot.ts` | 640 | `"INVENTORY_SKU_SYNCED"` | `"INVENTORY_PRODUCT_SYNCED"` |
| `src/lib/audit/alerts.ts` | 318 | `"INVENTORY_SKU_SYNCED"` | `"INVENTORY_PRODUCT_SYNCED"` |

**Raw SQL table name (2 files):**

| File | Lines | Old | New |
|---|---|---|---|
| `src/lib/bom-snapshot.ts` | 580, 583-588 | `"EquipmentSku"` (7 occurrences in `$queryRawUnsafe`) | `"InternalProduct"` |
| `scripts/backfill-canonical-keys.ts` | 27 | `"EquipmentSku"` (1 occurrence in `$executeRawUnsafe`) | `"InternalProduct"` |

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Prisma generates DROP+CREATE instead of RENAME | Hand-write migration SQL; use `--create-only` only to verify schema sync |
| Migration fails mid-way on production | All statements are independent RENAMEs — partial apply is safe, just re-run |
| Rollback needed after deploy | Reverse migration SQL included (Task 3); see Coordinated Cutover below |
| Existing `ActivityLog` rows have `INVENTORY_SKU_SYNCED` | Enum RENAME VALUE updates all existing rows automatically in Postgres |
| Code/DB name mismatch during deploy | Phase 4 code only works with the renamed DB objects; see Coordinated Cutover below |

### Coordinated Cutover

Phase 4 is **not zero-downtime**. Once `@@map`/`@map` are removed, the new app only works against the renamed DB objects, and the previous app only works against the old names. This creates a brief incompatible window.

**Forward deploy procedure:**
1. Schedule during low-traffic window (early morning or weekend)
2. Run `prisma migrate deploy` against production DB (sub-second — all ALTER RENAME)
3. Immediately trigger Vercel production deploy with the Phase 4 code
4. The window between steps 2 and 3 is the only downtime — Prisma queries from the still-running old code will fail until the new code deploys (~30-60s on Vercel)

**Rollback procedure (if issues found after deploy):**
1. Revert the Phase 4 code commit and push (triggers Vercel redeploy with old `@@map`/`@map` code)
2. **While Vercel redeploys**, run `rollback.sql` against production DB
3. The old code + old DB names are compatible again once both complete
4. Brief error window exists between rollback.sql completing and Vercel finishing the redeploy — unavoidable, same as forward deploy

**To minimize risk:** Deploy to a Vercel preview branch first, point it at a staging DB with the migration applied, and smoke test before touching production.

---

## Chunk 1: Migration

### Task 1: Write the migration SQL

**Files:**
- Create: `prisma/migrations/<timestamp>_rename_equipment_sku_to_internal_product/migration.sql`

The migration timestamp should follow the pattern of existing migrations. Use the current date in `YYYYMMDDHHMMSS` format.

- [ ] **Step 1: Create migration directory**

```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_rename_equipment_sku_to_internal_product
```

Note the exact directory name created — you'll need it for subsequent steps.

- [ ] **Step 2: Write the migration SQL**

Create `migration.sql` in the directory from Step 1:

```sql
-- Phase 4: Physical DB rename — EquipmentSku → InternalProduct
-- All operations are ALTER ... RENAME (metadata-only, instant, no data rewrite)

-- 1. Rename the table
ALTER TABLE "EquipmentSku" RENAME TO "InternalProduct";

-- 2. Rename enum value
ALTER TYPE "ActivityType" RENAME VALUE 'INVENTORY_SKU_SYNCED' TO 'INVENTORY_PRODUCT_SYNCED';

-- 3. Rename FK columns (8 tables)
ALTER TABLE "ModuleSpec" RENAME COLUMN "skuId" TO "internalProductId";
ALTER TABLE "InverterSpec" RENAME COLUMN "skuId" TO "internalProductId";
ALTER TABLE "BatterySpec" RENAME COLUMN "skuId" TO "internalProductId";
ALTER TABLE "EvChargerSpec" RENAME COLUMN "skuId" TO "internalProductId";
ALTER TABLE "MountingHardwareSpec" RENAME COLUMN "skuId" TO "internalProductId";
ALTER TABLE "ElectricalHardwareSpec" RENAME COLUMN "skuId" TO "internalProductId";
ALTER TABLE "RelayDeviceSpec" RENAME COLUMN "skuId" TO "internalProductId";
ALTER TABLE "InventoryStock" RENAME COLUMN "skuId" TO "internalProductId";

-- 4. Rename unique indexes on spec FK columns
ALTER INDEX "ModuleSpec_skuId_key" RENAME TO "ModuleSpec_internalProductId_key";
ALTER INDEX "InverterSpec_skuId_key" RENAME TO "InverterSpec_internalProductId_key";
ALTER INDEX "BatterySpec_skuId_key" RENAME TO "BatterySpec_internalProductId_key";
ALTER INDEX "EvChargerSpec_skuId_key" RENAME TO "EvChargerSpec_internalProductId_key";
ALTER INDEX "MountingHardwareSpec_skuId_key" RENAME TO "MountingHardwareSpec_internalProductId_key";
ALTER INDEX "ElectricalHardwareSpec_skuId_key" RENAME TO "ElectricalHardwareSpec_internalProductId_key";
ALTER INDEX "RelayDeviceSpec_skuId_key" RENAME TO "RelayDeviceSpec_internalProductId_key";

-- 5. Rename InventoryStock named constraints/indexes
ALTER INDEX "InventoryStock_skuId_location_key" RENAME TO "InventoryStock_internalProductId_location_key";
ALTER INDEX "InventoryStock_skuId_idx" RENAME TO "InventoryStock_internalProductId_idx";

-- 6. Rename FK constraints (8 tables)
ALTER TABLE "ModuleSpec" RENAME CONSTRAINT "ModuleSpec_skuId_fkey" TO "ModuleSpec_internalProductId_fkey";
ALTER TABLE "InverterSpec" RENAME CONSTRAINT "InverterSpec_skuId_fkey" TO "InverterSpec_internalProductId_fkey";
ALTER TABLE "BatterySpec" RENAME CONSTRAINT "BatterySpec_skuId_fkey" TO "BatterySpec_internalProductId_fkey";
ALTER TABLE "EvChargerSpec" RENAME CONSTRAINT "EvChargerSpec_skuId_fkey" TO "EvChargerSpec_internalProductId_fkey";
ALTER TABLE "MountingHardwareSpec" RENAME CONSTRAINT "MountingHardwareSpec_skuId_fkey" TO "MountingHardwareSpec_internalProductId_fkey";
ALTER TABLE "ElectricalHardwareSpec" RENAME CONSTRAINT "ElectricalHardwareSpec_skuId_fkey" TO "ElectricalHardwareSpec_internalProductId_fkey";
ALTER TABLE "RelayDeviceSpec" RENAME CONSTRAINT "RelayDeviceSpec_skuId_fkey" TO "RelayDeviceSpec_internalProductId_fkey";
ALTER TABLE "InventoryStock" RENAME CONSTRAINT "InventoryStock_skuId_fkey" TO "InventoryStock_internalProductId_fkey";

-- 7. Rename InternalProduct (was EquipmentSku) PK and indexes
ALTER INDEX "EquipmentSku_pkey" RENAME TO "InternalProduct_pkey";
ALTER INDEX "EquipmentSku_category_brand_model_key" RENAME TO "InternalProduct_category_brand_model_key";
ALTER INDEX "EquipmentSku_category_idx" RENAME TO "InternalProduct_category_idx";
ALTER INDEX "EquipmentSku_isActive_idx" RENAME TO "InternalProduct_isActive_idx";
ALTER INDEX "EquipmentSku_vendorPartNumber_idx" RENAME TO "InternalProduct_vendorPartNumber_idx";
ALTER INDEX "EquipmentSku_hubspotProductId_idx" RENAME TO "InternalProduct_hubspotProductId_idx";
ALTER INDEX "EquipmentSku_zuperItemId_idx" RENAME TO "InternalProduct_zuperItemId_idx";
ALTER INDEX "EquipmentSku_zohoItemId_idx" RENAME TO "InternalProduct_zohoItemId_idx";
ALTER INDEX "EquipmentSku_canonicalKey_idx" RENAME TO "InternalProduct_canonicalKey_idx";
ALTER INDEX "EquipmentSku_canonicalBrand_canonicalModel_idx" RENAME TO "InternalProduct_canonicalBrand_canonicalModel_idx";
ALTER INDEX "EquipmentSku_zohoVendorId_idx" RENAME TO "InternalProduct_zohoVendorId_idx";
```

- [ ] **Step 3: Commit the migration SQL**

```bash
git add prisma/migrations/
git commit -m "migration: add SQL for EquipmentSku → InternalProduct physical rename"
```

### Task 2: Update Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

Remove all `@@map`, `@map`, and explicit `map:` directives that reference the old names. Rename the enum value.

- [ ] **Step 1: Rename the enum value**

In `prisma/schema.prisma` line 153, change:
```
  INVENTORY_SKU_SYNCED
```
to:
```
  INVENTORY_PRODUCT_SYNCED
```

- [ ] **Step 2: Remove `@@map("EquipmentSku")` from InternalProduct**

Line 781 — delete the entire line:
```
  @@map("EquipmentSku")
```

- [ ] **Step 3: Remove `@map("skuId")` from all 8 FK columns**

For each of these lines, remove the `@map("skuId")` directive (keep everything else on the line):

| Line | Model | Before | After |
|---|---|---|---|
| 798 | ModuleSpec | `internalProductId String @unique @map("skuId")` | `internalProductId String @unique` |
| 812 | InverterSpec | `internalProductId String @unique @map("skuId")` | `internalProductId String @unique` |
| 825 | BatterySpec | `internalProductId       String @unique @map("skuId")` | `internalProductId       String @unique` |
| 839 | EvChargerSpec | `internalProductId String @unique @map("skuId")` | `internalProductId String @unique` |
| 851 | MountingHardwareSpec | `internalProductId String @unique @map("skuId")` | `internalProductId String @unique` |
| 863 | ElectricalHardwareSpec | `internalProductId String @unique @map("skuId")` | `internalProductId String @unique` |
| 873 | RelayDeviceSpec | `internalProductId   String @unique @map("skuId")` | `internalProductId   String @unique` |
| 905 | InventoryStock | `internalProductId String          @map("skuId")` | `internalProductId String` |

- [ ] **Step 4: Remove explicit `map:` names from InventoryStock constraints**

Lines 917-918 — remove the `map:` arguments:

Before:
```prisma
  @@unique([internalProductId, location], map: "InventoryStock_skuId_location_key")
  @@index([internalProductId], map: "InventoryStock_skuId_idx")
```

After:
```prisma
  @@unique([internalProductId, location])
  @@index([internalProductId])
```

- [ ] **Step 5: Commit the schema changes**

```bash
git add prisma/schema.prisma
git commit -m "schema: remove @@map/​@map directives, rename INVENTORY_SKU_SYNCED enum value"
```

### Task 3: Write rollback SQL

**Files:**
- Create: `prisma/migrations/<same-timestamp>_rename_equipment_sku_to_internal_product/rollback.sql`

This file is NOT applied automatically — it's a manual safety net. Place it alongside the migration SQL.

- [ ] **Step 1: Write the rollback script**

Create `rollback.sql` in the same migration directory:

```sql
-- ROLLBACK: InternalProduct → EquipmentSku (reverse of Phase 4 migration)
-- Run manually if emergency revert is needed.

-- Reverse enum
ALTER TYPE "ActivityType" RENAME VALUE 'INVENTORY_PRODUCT_SYNCED' TO 'INVENTORY_SKU_SYNCED';

-- Reverse column renames
ALTER TABLE "ModuleSpec" RENAME COLUMN "internalProductId" TO "skuId";
ALTER TABLE "InverterSpec" RENAME COLUMN "internalProductId" TO "skuId";
ALTER TABLE "BatterySpec" RENAME COLUMN "internalProductId" TO "skuId";
ALTER TABLE "EvChargerSpec" RENAME COLUMN "internalProductId" TO "skuId";
ALTER TABLE "MountingHardwareSpec" RENAME COLUMN "internalProductId" TO "skuId";
ALTER TABLE "ElectricalHardwareSpec" RENAME COLUMN "internalProductId" TO "skuId";
ALTER TABLE "RelayDeviceSpec" RENAME COLUMN "internalProductId" TO "skuId";
ALTER TABLE "InventoryStock" RENAME COLUMN "internalProductId" TO "skuId";

-- Reverse spec unique indexes
ALTER INDEX "ModuleSpec_internalProductId_key" RENAME TO "ModuleSpec_skuId_key";
ALTER INDEX "InverterSpec_internalProductId_key" RENAME TO "InverterSpec_skuId_key";
ALTER INDEX "BatterySpec_internalProductId_key" RENAME TO "BatterySpec_skuId_key";
ALTER INDEX "EvChargerSpec_internalProductId_key" RENAME TO "EvChargerSpec_skuId_key";
ALTER INDEX "MountingHardwareSpec_internalProductId_key" RENAME TO "MountingHardwareSpec_skuId_key";
ALTER INDEX "ElectricalHardwareSpec_internalProductId_key" RENAME TO "ElectricalHardwareSpec_skuId_key";
ALTER INDEX "RelayDeviceSpec_internalProductId_key" RENAME TO "RelayDeviceSpec_skuId_key";

-- Reverse InventoryStock named constraints
ALTER INDEX "InventoryStock_internalProductId_location_key" RENAME TO "InventoryStock_skuId_location_key";
ALTER INDEX "InventoryStock_internalProductId_idx" RENAME TO "InventoryStock_skuId_idx";

-- Reverse FK constraints
ALTER TABLE "ModuleSpec" RENAME CONSTRAINT "ModuleSpec_internalProductId_fkey" TO "ModuleSpec_skuId_fkey";
ALTER TABLE "InverterSpec" RENAME CONSTRAINT "InverterSpec_internalProductId_fkey" TO "InverterSpec_skuId_fkey";
ALTER TABLE "BatterySpec" RENAME CONSTRAINT "BatterySpec_internalProductId_fkey" TO "BatterySpec_skuId_fkey";
ALTER TABLE "EvChargerSpec" RENAME CONSTRAINT "EvChargerSpec_internalProductId_fkey" TO "EvChargerSpec_skuId_fkey";
ALTER TABLE "MountingHardwareSpec" RENAME CONSTRAINT "MountingHardwareSpec_internalProductId_fkey" TO "MountingHardwareSpec_skuId_fkey";
ALTER TABLE "ElectricalHardwareSpec" RENAME CONSTRAINT "ElectricalHardwareSpec_internalProductId_fkey" TO "ElectricalHardwareSpec_skuId_fkey";
ALTER TABLE "RelayDeviceSpec" RENAME CONSTRAINT "RelayDeviceSpec_internalProductId_fkey" TO "RelayDeviceSpec_skuId_fkey";
ALTER TABLE "InventoryStock" RENAME CONSTRAINT "InventoryStock_internalProductId_fkey" TO "InventoryStock_skuId_fkey";

-- Reverse PK and indexes on main table
ALTER INDEX "InternalProduct_pkey" RENAME TO "EquipmentSku_pkey";
ALTER INDEX "InternalProduct_category_brand_model_key" RENAME TO "EquipmentSku_category_brand_model_key";
ALTER INDEX "InternalProduct_category_idx" RENAME TO "EquipmentSku_category_idx";
ALTER INDEX "InternalProduct_isActive_idx" RENAME TO "EquipmentSku_isActive_idx";
ALTER INDEX "InternalProduct_vendorPartNumber_idx" RENAME TO "EquipmentSku_vendorPartNumber_idx";
ALTER INDEX "InternalProduct_hubspotProductId_idx" RENAME TO "EquipmentSku_hubspotProductId_idx";
ALTER INDEX "InternalProduct_zuperItemId_idx" RENAME TO "EquipmentSku_zuperItemId_idx";
ALTER INDEX "InternalProduct_zohoItemId_idx" RENAME TO "EquipmentSku_zohoItemId_idx";
ALTER INDEX "InternalProduct_canonicalKey_idx" RENAME TO "EquipmentSku_canonicalKey_idx";
ALTER INDEX "InternalProduct_canonicalBrand_canonicalModel_idx" RENAME TO "EquipmentSku_canonicalBrand_canonicalModel_idx";
ALTER INDEX "InternalProduct_zohoVendorId_idx" RENAME TO "EquipmentSku_zohoVendorId_idx";

-- Reverse table rename (LAST — after all references are reverted)
ALTER TABLE "InternalProduct" RENAME TO "EquipmentSku";
```

- [ ] **Step 2: Commit**

```bash
git add prisma/migrations/
git commit -m "migration: add rollback SQL for Phase 4 emergency revert"
```

---

## Chunk 2: Code Changes

### Task 4: Update source code references

**Files:**
- Modify: `src/app/api/inventory/sync-products/route.ts`
- Modify: `src/app/api/bom/save/route.ts`
- Modify: `src/lib/bom-snapshot.ts`
- Modify: `src/lib/audit/alerts.ts`
- Modify: `scripts/backfill-canonical-keys.ts`

4 files reference the `INVENTORY_SKU_SYNCED` enum value. Additionally, `bom-snapshot.ts` and `scripts/backfill-canonical-keys.ts` both have raw SQL that hardcodes `"EquipmentSku"` as the table name — these must be updated to `"InternalProduct"` or they will fail at runtime after the table rename.

- [ ] **Step 1: Update `sync-products/route.ts`**

Line ~175:
```
type: "INVENTORY_SKU_SYNCED",
```
→
```
type: "INVENTORY_PRODUCT_SYNCED",
```

- [ ] **Step 2: Update `bom/save/route.ts`**

Line ~35:
```
type: outcome === "failed" ? "API_ERROR" : "INVENTORY_SKU_SYNCED",
```
→
```
type: outcome === "failed" ? "API_ERROR" : "INVENTORY_PRODUCT_SYNCED",
```

- [ ] **Step 3: Update `bom-snapshot.ts`**

Line ~640:
```
type: outcome === "failed" ? "API_ERROR" : "INVENTORY_SKU_SYNCED",
```
→
```
type: outcome === "failed" ? "API_ERROR" : "INVENTORY_PRODUCT_SYNCED",
```

- [ ] **Step 4: Update `audit/alerts.ts`**

Line ~318:
```
type: "INVENTORY_SKU_SYNCED",
```
→
```
type: "INVENTORY_PRODUCT_SYNCED",
```

- [ ] **Step 5: Update raw SQL table name in `bom-snapshot.ts`**

Lines 580-588 — replace all 7 occurrences of `"EquipmentSku"` with `"InternalProduct"` in the `$queryRawUnsafe` upsert:

```
INSERT INTO "EquipmentSku" ...
```
→
```
INSERT INTO "InternalProduct" ...
```

And the 6 `ON CONFLICT ... DO UPDATE SET` column references:
```
"EquipmentSku"."description"
"EquipmentSku"."unitSpec"
"EquipmentSku"."unitLabel"
"EquipmentSku"."canonicalBrand"
"EquipmentSku"."canonicalModel"
"EquipmentSku"."canonicalKey"
```
→
```
"InternalProduct"."description"
"InternalProduct"."unitSpec"
"InternalProduct"."unitLabel"
"InternalProduct"."canonicalBrand"
"InternalProduct"."canonicalModel"
"InternalProduct"."canonicalKey"
```

- [ ] **Step 6: Update raw SQL table name in `scripts/backfill-canonical-keys.ts`**

Line 27:
```
UPDATE "EquipmentSku"
```
→
```
UPDATE "InternalProduct"
```

- [ ] **Step 7: Verify no other references remain**

```bash
grep -r "INVENTORY_SKU_SYNCED\|\"EquipmentSku\"" src/ scripts/ --include="*.ts" --include="*.tsx"
```

Expected: No matches (only `src/generated/` would match before regeneration, but that's auto-generated).

- [ ] **Step 8: Commit**

```bash
git add src/app/api/inventory/sync-products/route.ts src/app/api/bom/save/route.ts src/lib/bom-snapshot.ts src/lib/audit/alerts.ts scripts/backfill-canonical-keys.ts
git commit -m "refactor: rename INVENTORY_SKU_SYNCED enum and EquipmentSku raw SQL references"
```

---

## Chunk 3: Validation

### Task 5: Validate migration locally

This task applies the migration to a local/dev database, regenerates the Prisma client, and verifies everything works.

**Prerequisites:** A local `.env` with `DATABASE_URL` pointing to a dev database (not production).

- [ ] **Step 1: Generate Prisma client to verify schema parses**

```bash
npx prisma generate
```

Expected: Clean generation, no errors. The generated enums should now include `INVENTORY_PRODUCT_SYNCED` instead of `INVENTORY_SKU_SYNCED`.

- [ ] **Step 2: Verify the generated enum**

```bash
grep "INVENTORY_PRODUCT_SYNCED\|INVENTORY_SKU_SYNCED" src/generated/prisma/enums.ts
```

Expected: Only `INVENTORY_PRODUCT_SYNCED` appears.

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -i "inventory_sku\|inventory_product" || echo "No enum-related errors"
```

Expected: No errors related to the enum rename.

- [ ] **Step 4: Apply migration to dev database**

```bash
npx prisma migrate dev
```

Expected: Migration applies successfully. If Prisma detects drift (schema doesn't match after migration), it will warn — investigate before proceeding.

- [ ] **Step 5: Verify DB state**

Connect to the dev database and confirm:

```sql
-- Table exists with new name
SELECT tablename FROM pg_tables WHERE tablename = 'InternalProduct';

-- Old table name is gone
SELECT tablename FROM pg_tables WHERE tablename = 'EquipmentSku';

-- Enum value is renamed
SELECT enumlabel FROM pg_enum
JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
WHERE pg_type.typname = 'ActivityType' AND enumlabel LIKE 'INVENTORY_%';

-- FK columns are renamed
SELECT column_name FROM information_schema.columns
WHERE table_name = 'ModuleSpec' AND column_name IN ('skuId', 'internalProductId');
```

- [ ] **Step 6: Run tests**

```bash
npm run test
```

Expected: All tests pass. Any test that used `INVENTORY_SKU_SYNCED` should now use the new value.

- [ ] **Step 7: Run build**

```bash
npm run build
```

Expected: Clean TypeScript compilation. Page data collection may fail due to missing env vars (pre-existing) — the important check is that compilation succeeds.

- [ ] **Step 8: Commit any final fixes**

If `prisma generate` produced changes to `src/generated/`:

```bash
git add src/generated/
git commit -m "chore: regenerate Prisma client after Phase 4 migration"
```

### Task 6: Remove Phase 3 compatibility wrappers

**This task is OPTIONAL and should only be done if Phase 3 has been deployed for at least one full release cycle.**

Phase 3 created 11 wrapper files at the old `/api/inventory/skus/**` paths. If the bake period has passed and Vercel access logs confirm no external traffic on old paths, remove them now.

**Files to delete:**
- `src/app/api/inventory/skus/route.ts`
- `src/app/api/inventory/skus/stats/route.ts`
- `src/app/api/inventory/skus/merge/route.ts`
- `src/app/api/inventory/skus/sync-enabled/route.ts`
- `src/app/api/inventory/skus/sync-bulk/route.ts`
- `src/app/api/inventory/skus/sync-bulk/confirm/route.ts`
- `src/app/api/inventory/skus/sync-hubspot-bulk/route.ts`
- `src/app/api/inventory/skus/sync-hubspot-bulk/confirm/route.ts`
- `src/app/api/inventory/skus/[id]/sync/route.ts`
- `src/app/api/inventory/skus/[id]/sync/confirm/route.ts`
- `src/app/api/inventory/sync-skus/route.ts`
- `src/__tests__/api/inventory/route-compat.test.ts`

- [ ] **Step 1: Check Vercel access logs**

Verify zero traffic on `/api/inventory/skus` paths in the past release cycle.

- [ ] **Step 2: Delete wrapper files and test**

```bash
rm -rf src/app/api/inventory/skus/
rm -rf src/app/api/inventory/sync-skus/
rm src/__tests__/api/inventory/route-compat.test.ts
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A src/app/api/inventory/skus/ src/app/api/inventory/sync-skus/ src/__tests__/api/inventory/route-compat.test.ts
git commit -m "cleanup: remove Phase 3 compatibility wrappers after bake period"
```

---

## Deploy Checklist

**Pre-deploy (any time):**
- [ ] Dev database migration applied successfully (Task 5)
- [ ] All tests pass locally
- [ ] TypeScript compilation clean
- [ ] Rollback SQL reviewed and ready (`rollback.sql`)
- [ ] Optional: deploy Phase 4 code to Vercel preview branch + staging DB to smoke test

**Coordinated cutover (low-traffic window):**
- [ ] 1. Run `prisma migrate deploy` against production DB
- [ ] 2. Immediately push Phase 4 code to main (triggers Vercel production deploy)
- [ ] 3. Monitor Vercel build — expect ~30-60s of errors from old code hitting renamed DB
- [ ] 4. Once new deploy is live, smoke test: catalog, inventory, BOM, product-comparison dashboards
- [ ] 5. Monitor Sentry for new errors in the 30 minutes after deploy

**If rollback needed:**
- [ ] 1. Revert Phase 4 code commit and push to main (triggers Vercel redeploy)
- [ ] 2. Run `rollback.sql` against production DB
- [ ] 3. Wait for Vercel redeploy to complete — old code + old DB names are compatible again
- [ ] 4. Investigate root cause before re-attempting
