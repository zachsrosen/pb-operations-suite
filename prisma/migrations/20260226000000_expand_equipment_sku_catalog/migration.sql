-- Expand EquipmentCategory enum to include full BOM category coverage
ALTER TYPE "EquipmentCategory" ADD VALUE IF NOT EXISTS 'RAPID_SHUTDOWN';
ALTER TYPE "EquipmentCategory" ADD VALUE IF NOT EXISTS 'RACKING';
ALTER TYPE "EquipmentCategory" ADD VALUE IF NOT EXISTS 'ELECTRICAL_BOS';
ALTER TYPE "EquipmentCategory" ADD VALUE IF NOT EXISTS 'MONITORING';

-- Extend EquipmentSku with richer catalog metadata + pricing/sync identifiers
ALTER TABLE "EquipmentSku"
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "vendorName" TEXT,
  ADD COLUMN IF NOT EXISTS "vendorPartNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "unitCost" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "sellPrice" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "hubspotProductId" TEXT,
  ADD COLUMN IF NOT EXISTS "zuperItemId" TEXT;

-- Indexes for lookup/sync workflows
CREATE INDEX IF NOT EXISTS "EquipmentSku_vendorPartNumber_idx" ON "EquipmentSku"("vendorPartNumber");
CREATE INDEX IF NOT EXISTS "EquipmentSku_hubspotProductId_idx" ON "EquipmentSku"("hubspotProductId");
CREATE INDEX IF NOT EXISTS "EquipmentSku_zuperItemId_idx" ON "EquipmentSku"("zuperItemId");
CREATE INDEX IF NOT EXISTS "EquipmentSku_zohoItemId_idx" ON "EquipmentSku"("zohoItemId");
