-- CreateEnum
CREATE TYPE "SolarEdgeLinkMethod" AS ENUM ('PROJ', 'ADDRESS', 'MANUAL', 'UNLINKED');

-- CreateTable
CREATE TABLE "SolarEdgeSite" (
    "id" TEXT NOT NULL,
    "siteId" INTEGER NOT NULL,
    "siteName" TEXT NOT NULL,
    "portalUrl" TEXT,
    "siteType" TEXT,
    "activationStatus" TEXT,
    "peakPowerKw" DOUBLE PRECISION,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "installDate" TIMESTAMP(3),
    "projNumber" TEXT,
    "propertyId" TEXT,
    "dealId" TEXT,
    "linkMethod" "SolarEdgeLinkMethod" NOT NULL DEFAULT 'UNLINKED',
    "inverterCount" INTEGER NOT NULL DEFAULT 0,
    "optimizerCount" INTEGER NOT NULL DEFAULT 0,
    "batteryCount" INTEGER NOT NULL DEFAULT 0,
    "hasStorage" BOOLEAN NOT NULL DEFAULT false,
    "lastPowerW" DOUBLE PRECISION,
    "lastEnergyTodayWh" DOUBLE PRECISION,
    "lastReportAt" TIMESTAMP(3),
    "highestAlertImpact" INTEGER NOT NULL DEFAULT 0,
    "openAlertCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolarEdgeSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolarEdgeAlert" (
    "id" TEXT NOT NULL,
    "siteId" INTEGER NOT NULL,
    "alertType" TEXT NOT NULL,
    "component" TEXT,
    "impact" INTEGER NOT NULL DEFAULT 0,
    "rmaStatus" TEXT,
    "rmaCaseNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "reportedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolarEdgeAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SolarEdgeSite_siteId_key" ON "SolarEdgeSite"("siteId");

-- CreateIndex
CREATE INDEX "SolarEdgeSite_propertyId_idx" ON "SolarEdgeSite"("propertyId");

-- CreateIndex
CREATE INDEX "SolarEdgeSite_dealId_idx" ON "SolarEdgeSite"("dealId");

-- CreateIndex
CREATE INDEX "SolarEdgeSite_projNumber_idx" ON "SolarEdgeSite"("projNumber");

-- CreateIndex
CREATE INDEX "SolarEdgeSite_activationStatus_idx" ON "SolarEdgeSite"("activationStatus");

-- CreateIndex
CREATE INDEX "SolarEdgeSite_highestAlertImpact_idx" ON "SolarEdgeSite"("highestAlertImpact");

-- CreateIndex
CREATE INDEX "SolarEdgeAlert_siteId_idx" ON "SolarEdgeAlert"("siteId");

-- CreateIndex
CREATE INDEX "SolarEdgeAlert_isActive_idx" ON "SolarEdgeAlert"("isActive");

-- CreateIndex
CREATE INDEX "SolarEdgeAlert_impact_idx" ON "SolarEdgeAlert"("impact");

-- CreateIndex
CREATE UNIQUE INDEX "SolarEdgeAlert_siteId_alertType_component_key" ON "SolarEdgeAlert"("siteId", "alertType", "component");

-- AddForeignKey
ALTER TABLE "SolarEdgeSite" ADD CONSTRAINT "SolarEdgeSite_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "HubSpotPropertyCache"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolarEdgeAlert" ADD CONSTRAINT "SolarEdgeAlert_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "SolarEdgeSite"("siteId") ON DELETE CASCADE ON UPDATE CASCADE;

