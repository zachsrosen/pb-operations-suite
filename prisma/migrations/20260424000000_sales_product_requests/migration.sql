-- Sales product request — additive migration
-- Adds two nullable columns to PendingCatalogPush, new AdderRequest table + enum,
-- and three new ActivityType enum values. Safe to apply before code ships.

-- ActivityType enum additions (must run outside a transaction in Postgres)
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'SALES_PRODUCT_REQUEST_SUBMITTED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'SALES_PRODUCT_REQUEST_APPROVED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'SALES_PRODUCT_REQUEST_DECLINED';

-- PendingCatalogPush new columns
ALTER TABLE "PendingCatalogPush"
  ADD COLUMN IF NOT EXISTS "openSolarId" TEXT,
  ADD COLUMN IF NOT EXISTS "salesRequestNote" TEXT;

-- AdderRequestStatus enum
DO $$ BEGIN
  CREATE TYPE "AdderRequestStatus" AS ENUM ('PENDING', 'ADDED', 'DECLINED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AdderRequest table
CREATE TABLE IF NOT EXISTS "AdderRequest" (
  "id" TEXT NOT NULL,
  "status" "AdderRequestStatus" NOT NULL DEFAULT 'PENDING',
  "category" "AdderCategory" NOT NULL,
  "unit" "AdderUnit" NOT NULL DEFAULT 'FLAT',
  "name" TEXT NOT NULL,
  "estimatedPrice" DOUBLE PRECISION,
  "description" TEXT,
  "salesRequestNote" TEXT,
  "requestedBy" TEXT NOT NULL,
  "dealId" TEXT,
  "openSolarId" TEXT,
  "reviewerNote" TEXT,
  "adderCatalogId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),

  CONSTRAINT "AdderRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdderRequest_status_idx" ON "AdderRequest"("status");
CREATE INDEX IF NOT EXISTS "AdderRequest_requestedBy_idx" ON "AdderRequest"("requestedBy");
CREATE INDEX IF NOT EXISTS "AdderRequest_dealId_idx" ON "AdderRequest"("dealId");
