-- CreateEnum
CREATE TYPE "PowerhubLinkMethod" AS ENUM ('PROPERTY', 'ADDRESS_MATCH', 'MANUAL', 'UNLINKED');

-- CreateEnum
CREATE TYPE "PowerhubLinkConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "PowerhubSiteStatus" AS ENUM ('ACTIVE', 'OFFLINE', 'ERROR');

-- CreateEnum
CREATE TYPE "PowerhubAlertSeverity" AS ENUM ('INFORMATIONAL', 'PERFORMANCE', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PowerhubTelemetrySource" AS ENUM ('POLL', 'BULK');

-- CreateTable
CREATE TABLE "PowerhubSite" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT,
    "addressHash" TEXT,
    "propertyId" TEXT,
    "dealId" TEXT,
    "linkMethod" "PowerhubLinkMethod" NOT NULL DEFAULT 'UNLINKED',
    "linkConfidence" "PowerhubLinkConfidence" NOT NULL DEFAULT 'LOW',
    "devices" JSONB NOT NULL DEFAULT '[]',
    "totalBatteryEnergy" INTEGER,
    "totalBatteryPower" INTEGER,
    "totalGateways" INTEGER NOT NULL DEFAULT 0,
    "totalBatteries" INTEGER NOT NULL DEFAULT 0,
    "totalInverters" INTEGER NOT NULL DEFAULT 0,
    "status" "PowerhubSiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastAssetSyncAt" TIMESTAMP(3) NOT NULL,
    "lastTelemetryAt" TIMESTAMP(3),
    "lastAlertCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PowerhubSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PowerhubTelemetrySnapshot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "solarPowerW" DOUBLE PRECISION,
    "solarEnergyTodayWh" DOUBLE PRECISION,
    "batteryPowerW" DOUBLE PRECISION,
    "batterySocPercent" DOUBLE PRECISION,
    "batteryEnergyRemainingWh" DOUBLE PRECISION,
    "gridPowerW" DOUBLE PRECISION,
    "gridEnergyImportedWh" DOUBLE PRECISION,
    "gridEnergyExportedWh" DOUBLE PRECISION,
    "loadPowerW" DOUBLE PRECISION,
    "gridConnectedStatus" TEXT,
    "batteryMode" TEXT,
    "raw" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PowerhubTelemetrySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PowerhubTelemetryHistory" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "signalName" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "valueString" TEXT,
    "source" "PowerhubTelemetrySource" NOT NULL DEFAULT 'POLL',

    CONSTRAINT "PowerhubTelemetryHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PowerhubAlert" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "din" TEXT,
    "alertName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "PowerhubAlertSeverity" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "origin" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PowerhubAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PowerhubSite_siteId_key" ON "PowerhubSite"("siteId");

-- CreateIndex
CREATE INDEX "PowerhubSite_addressHash_idx" ON "PowerhubSite"("addressHash");

-- CreateIndex
CREATE INDEX "PowerhubSite_propertyId_idx" ON "PowerhubSite"("propertyId");

-- CreateIndex
CREATE INDEX "PowerhubSite_dealId_idx" ON "PowerhubSite"("dealId");

-- CreateIndex
CREATE INDEX "PowerhubSite_status_idx" ON "PowerhubSite"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PowerhubTelemetrySnapshot_siteId_key" ON "PowerhubTelemetrySnapshot"("siteId");

-- CreateIndex
CREATE INDEX "PowerhubTelemetryHistory_siteId_signalName_timestamp_idx" ON "PowerhubTelemetryHistory"("siteId", "signalName", "timestamp");

-- CreateIndex
CREATE INDEX "PowerhubTelemetryHistory_siteId_timestamp_idx" ON "PowerhubTelemetryHistory"("siteId", "timestamp");

-- CreateIndex
CREATE INDEX "PowerhubAlert_siteId_isActive_idx" ON "PowerhubAlert"("siteId", "isActive");

-- CreateIndex
CREATE INDEX "PowerhubAlert_severity_isActive_idx" ON "PowerhubAlert"("severity", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PowerhubAlert_siteId_deviceId_alertName_reportedAt_key" ON "PowerhubAlert"("siteId", "deviceId", "alertName", "reportedAt");

-- AddForeignKey
ALTER TABLE "PowerhubSite" ADD CONSTRAINT "PowerhubSite_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "HubSpotPropertyCache"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerhubTelemetrySnapshot" ADD CONSTRAINT "PowerhubTelemetrySnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "PowerhubSite"("siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerhubTelemetryHistory" ADD CONSTRAINT "PowerhubTelemetryHistory_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "PowerhubSite"("siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerhubAlert" ADD CONSTRAINT "PowerhubAlert_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "PowerhubSite"("siteId") ON DELETE RESTRICT ON UPDATE CASCADE;
