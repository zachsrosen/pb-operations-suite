-- Remove OPENSOLAR from CatalogProductSource enum
-- First delete any rows that use the old value
DELETE FROM "CatalogProduct" WHERE source = 'OPENSOLAR';

-- Rename the old enum, create the new one without OPENSOLAR, migrate the column, drop the old enum
ALTER TYPE "CatalogProductSource" RENAME TO "CatalogProductSource_old";
CREATE TYPE "CatalogProductSource" AS ENUM ('HUBSPOT', 'ZUPER', 'ZOHO', 'QUICKBOOKS');
ALTER TABLE "CatalogProduct" ALTER COLUMN "source" TYPE "CatalogProductSource" USING source::text::"CatalogProductSource";
DROP TYPE "CatalogProductSource_old";
