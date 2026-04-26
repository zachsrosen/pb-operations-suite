-- Catalog Sync Observability
--
-- Adds 4 ActivityType enum values + watermark columns on EquipmentSku
-- (the InternalProduct table) to support the new logCatalogSync helper.
-- Purely additive — safe to apply before code that references the new values.
--
-- Plan: docs/superpowers/plans/2026-04-24-catalog-sync-quality-hardening.md (M1.1)

-- AlterEnum: add CATALOG_* activity types
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'CATALOG_PRODUCT_CREATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'CATALOG_PRODUCT_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'CATALOG_SYNC_EXECUTED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'CATALOG_SYNC_FAILED';

-- AlterTable: sync watermark columns on InternalProduct (table is named EquipmentSku per @@map)
ALTER TABLE "EquipmentSku" ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "EquipmentSku" ADD COLUMN IF NOT EXISTS "lastSyncedBy" TEXT;

-- CreateIndex: support stale-product queries
CREATE INDEX IF NOT EXISTS "EquipmentSku_lastSyncedAt_idx" ON "EquipmentSku"("lastSyncedAt");
