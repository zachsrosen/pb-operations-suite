-- Add ENPHASE_STATUS_CHANGE to ActivityType enum
ALTER TYPE "ActivityType" ADD VALUE 'ENPHASE_STATUS_CHANGE';

-- CreateEnum
CREATE TYPE "EnphaseLinkMethod" AS ENUM ('PROPERTY', 'ADDRESS_MATCH', 'MANUAL', 'GEO', 'UNLINKED');

-- CreateEnum
CREATE TYPE "EnphaseLinkConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "EnphaseSite" (
    "id" TEXT NOT NULL,
    "systemId" INTEGER NOT NULL,
    "systemName" TEXT NOT NULL,
    "systemPublicName" TEXT,
    "portalUrl" TEXT,
    "primaryForProperty" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT,
    "addressHash" TEXT,
    "propertyId" TEXT,
    "dealId" TEXT,
    "linkMethod" "EnphaseLinkMethod" NOT NULL DEFAULT 'UNLINKED',
    "linkConfidence" "EnphaseLinkConfidence" NOT NULL DEFAULT 'LOW',
    "modules" INTEGER NOT NULL DEFAULT 0,
    "systemSizeW" DOUBLE PRECISION,
    "timezone" TEXT,
    "connectionType" TEXT,
    "envoySerial" TEXT,
    "status" TEXT NOT NULL DEFAULT 'normal',
    "operationalAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "linkDistanceM" DOUBLE PRECISION,
    "devices" JSONB NOT NULL DEFAULT '[]',
    "microinverterCount" INTEGER NOT NULL DEFAULT 0,
    "batteryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAssetSyncAt" TIMESTAMP(3) NOT NULL,
    "lastTelemetrySyncAt" TIMESTAMP(3),
    "lastStatusCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnphaseSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnphaseTelemetrySnapshot" (
    "id" TEXT NOT NULL,
    "systemId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "currentProductionW" DOUBLE PRECISION,
    "todayProductionWh" DOUBLE PRECISION,
    "lifetimeProductionWh" DOUBLE PRECISION,
    "lastDayProductionWh" DOUBLE PRECISION,
    "currentConsumptionW" DOUBLE PRECISION,
    "todayConsumptionWh" DOUBLE PRECISION,
    "lifetimeConsumptionWh" DOUBLE PRECISION,
    "batteryPercentCharge" DOUBLE PRECISION,
    "batteryCapacityWh" DOUBLE PRECISION,
    "batteryChargeW" DOUBLE PRECISION,
    "gridImportW" DOUBLE PRECISION,
    "gridExportW" DOUBLE PRECISION,
    "systemStatus" TEXT,
    "microReportingCount" INTEGER,
    "microTotalCount" INTEGER,
    "lastReportAt" TIMESTAMP(3),
    "raw" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnphaseTelemetrySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnphaseTelemetryHistory" (
    "id" TEXT NOT NULL,
    "systemId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "signalName" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "valueString" TEXT,
    "source" TEXT NOT NULL DEFAULT 'POLL',

    CONSTRAINT "EnphaseTelemetryHistory_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Add Enphase denormalized fields to HubSpotPropertyCache
ALTER TABLE "HubSpotPropertyCache"
    ADD COLUMN "enphasePortalUrl" TEXT,
    ADD COLUMN "enphaseSystemId" TEXT,
    ADD COLUMN "enphaseEnvoySerial" TEXT,
    ADD COLUMN "enphaseMicroCount" TEXT,
    ADD COLUMN "enphaseBatterySerials" TEXT,
    ADD COLUMN "enphaseBatteryModel" TEXT,
    ADD COLUMN "enphaseSystemSize" TEXT,
    ADD COLUMN "enphaseHardwareSummary" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EnphaseSite_systemId_key" ON "EnphaseSite"("systemId");

-- CreateIndex
CREATE INDEX "EnphaseSite_addressHash_idx" ON "EnphaseSite"("addressHash");

-- CreateIndex
CREATE INDEX "EnphaseSite_propertyId_idx" ON "EnphaseSite"("propertyId");

-- CreateIndex
CREATE INDEX "EnphaseSite_dealId_idx" ON "EnphaseSite"("dealId");

-- CreateIndex
CREATE INDEX "EnphaseSite_status_idx" ON "EnphaseSite"("status");

-- CreateIndex
CREATE INDEX "EnphaseSite_latitude_longitude_idx" ON "EnphaseSite"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "EnphaseTelemetrySnapshot_systemId_key" ON "EnphaseTelemetrySnapshot"("systemId");

-- CreateIndex
CREATE INDEX "EnphaseTelemetryHistory_systemId_signalName_timestamp_idx" ON "EnphaseTelemetryHistory"("systemId", "signalName", "timestamp");

-- CreateIndex
CREATE INDEX "EnphaseTelemetryHistory_systemId_timestamp_idx" ON "EnphaseTelemetryHistory"("systemId", "timestamp");

-- AddForeignKey
ALTER TABLE "EnphaseSite" ADD CONSTRAINT "EnphaseSite_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "HubSpotPropertyCache"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnphaseTelemetrySnapshot" ADD CONSTRAINT "EnphaseTelemetrySnapshot_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "EnphaseSite"("systemId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnphaseTelemetryHistory" ADD CONSTRAINT "EnphaseTelemetryHistory_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "EnphaseSite"("systemId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index: at most one primary EnphaseSite per property
-- Mirrors PowerhubSite_primary_per_property; propertyId IS NOT NULL guard lets
-- primaryForProperty=true rows with no property sit without conflict.
CREATE UNIQUE INDEX "EnphaseSite_primary_per_property"
  ON "EnphaseSite" ("propertyId")
  WHERE "primaryForProperty" = true AND "propertyId" IS NOT NULL;
