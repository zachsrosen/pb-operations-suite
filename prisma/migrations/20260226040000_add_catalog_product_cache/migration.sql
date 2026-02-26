-- Product source enum for persisted cross-system catalog cache
DO $$
BEGIN
  CREATE TYPE "CatalogProductSource" AS ENUM ('HUBSPOT', 'ZUPER', 'ZOHO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Cached external catalog products (HubSpot / Zuper / Zoho)
CREATE TABLE IF NOT EXISTS "CatalogProduct" (
  "id" TEXT NOT NULL,
  "source" "CatalogProductSource" NOT NULL,
  "externalId" TEXT NOT NULL,
  "name" TEXT,
  "sku" TEXT,
  "normalizedName" TEXT,
  "normalizedSku" TEXT,
  "description" TEXT,
  "price" DOUBLE PRECISION,
  "status" TEXT,
  "url" TEXT,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CatalogProduct_source_externalId_key" ON "CatalogProduct"("source", "externalId");
CREATE INDEX IF NOT EXISTS "CatalogProduct_source_idx" ON "CatalogProduct"("source");
CREATE INDEX IF NOT EXISTS "CatalogProduct_sku_idx" ON "CatalogProduct"("sku");
CREATE INDEX IF NOT EXISTS "CatalogProduct_normalizedSku_idx" ON "CatalogProduct"("normalizedSku");
CREATE INDEX IF NOT EXISTS "CatalogProduct_normalizedName_idx" ON "CatalogProduct"("normalizedName");
