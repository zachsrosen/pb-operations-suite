-- Remove QuickBooks from CatalogProductSource enum and drop related columns/indexes

-- Drop index first
DROP INDEX IF EXISTS "EquipmentSku_quickbooksItemId_idx";

-- Remove quickbooksItemId from EquipmentSku
ALTER TABLE "EquipmentSku" DROP COLUMN IF EXISTS "quickbooksItemId";

-- Remove quickbooksItemId from PendingCatalogPush
ALTER TABLE "PendingCatalogPush" DROP COLUMN IF EXISTS "quickbooksItemId";

-- Remove QUICKBOOKS from CatalogProductSource enum
ALTER TYPE "CatalogProductSource" RENAME TO "CatalogProductSource_old";
CREATE TYPE "CatalogProductSource" AS ENUM ('HUBSPOT', 'ZUPER', 'ZOHO');
-- No columns currently use this enum type directly that need migration
DROP TYPE "CatalogProductSource_old";
