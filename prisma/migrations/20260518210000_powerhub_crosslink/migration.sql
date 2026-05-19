-- AlterTable
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN "teslaPortalUrl" TEXT,
ADD COLUMN "teslaSiteId" TEXT;

-- AlterTable
ALTER TABLE "PowerhubSite" ADD COLUMN "portalUrl" TEXT,
ADD COLUMN "primaryForProperty" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PowerhubCrosslinkBackfillRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cursor" TEXT,
    "totalCount" INTEGER,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "PowerhubCrosslinkBackfillRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PowerhubCrosslinkBackfillRun_status_idx" ON "PowerhubCrosslinkBackfillRun"("status");

-- Partial unique index: at most one primary PowerhubSite per property.
-- Includes "propertyId IS NOT NULL" so a "primaryForProperty=true, propertyId=NULL" row
-- can't slip through (PG treats NULL keys as distinct in unique indexes).
CREATE UNIQUE INDEX IF NOT EXISTS "PowerhubSite_primary_per_property"
  ON "PowerhubSite" ("propertyId")
  WHERE "primaryForProperty" = true AND "propertyId" IS NOT NULL;

-- Partial unique index: at most one PowerhubCrosslinkBackfillRun with status='running' at a time.
-- The ((1)) expression creates a singleton-style index where the column value is constant,
-- so any second insert with status='running' will hit the unique constraint and raise P2002.
CREATE UNIQUE INDEX IF NOT EXISTS "PowerhubCrosslinkBackfillRun_singleton_running"
  ON "PowerhubCrosslinkBackfillRun" ((1))
  WHERE "status" = 'running';
