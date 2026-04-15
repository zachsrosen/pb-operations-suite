-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'PROPERTY_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'PROPERTY_ASSOCIATION_ADDED';
ALTER TYPE "ActivityType" ADD VALUE 'PROPERTY_SYNC_FAILED';

-- CreateTable
CREATE TABLE "HubSpotPropertyCache" (
    "id" TEXT NOT NULL,
    "hubspotObjectId" TEXT NOT NULL,
    "googlePlaceId" TEXT,
    "addressHash" TEXT NOT NULL,
    "normalizedAddress" TEXT NOT NULL,
    "attomId" TEXT,
    "fullAddress" TEXT NOT NULL,
    "streetAddress" TEXT NOT NULL,
    "unitNumber" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "county" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "propertyType" TEXT,
    "yearBuilt" INTEGER,
    "squareFootage" INTEGER,
    "lotSizeSqft" INTEGER,
    "stories" INTEGER,
    "bedrooms" INTEGER,
    "bathrooms" DOUBLE PRECISION,
    "foundationType" TEXT,
    "constructionType" TEXT,
    "roofMaterial" TEXT,
    "roofAgeYears" INTEGER,
    "roofLastReplacedYear" INTEGER,
    "roofConditionNotes" TEXT,
    "parcelApn" TEXT,
    "zoning" TEXT,
    "assessedValue" INTEGER,
    "lastSaleDate" TIMESTAMP(3),
    "lastSalePrice" INTEGER,
    "publicRecordOwnerName" TEXT,
    "floodZone" TEXT,
    "wildfireRiskZone" TEXT,
    "hoaName" TEXT,
    "generalNotes" TEXT,
    "mainPanelAmperage" INTEGER,
    "mainPanelManufacturer" TEXT,
    "serviceEntranceType" TEXT,
    "firstInstallDate" TIMESTAMP(3),
    "mostRecentInstallDate" TIMESTAMP(3),
    "associatedDealsCount" INTEGER NOT NULL DEFAULT 0,
    "associatedTicketsCount" INTEGER NOT NULL DEFAULT 0,
    "openTicketsCount" INTEGER NOT NULL DEFAULT 0,
    "systemSizeKwDc" DOUBLE PRECISION,
    "hasBattery" BOOLEAN NOT NULL DEFAULT false,
    "hasEvCharger" BOOLEAN NOT NULL DEFAULT false,
    "lastServiceDate" TIMESTAMP(3),
    "earliestWarrantyExpiry" TIMESTAMP(3),
    "ahjObjectId" TEXT,
    "ahjName" TEXT,
    "utilityObjectId" TEXT,
    "utilityName" TEXT,
    "locationObjectId" TEXT,
    "pbLocation" TEXT,
    "geocodedAt" TIMESTAMP(3) NOT NULL,
    "attomLastSyncedAt" TIMESTAMP(3),
    "attomSyncStatus" TEXT,
    "attomMatchConfidence" TEXT,
    "lastReconciledAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HubSpotPropertyCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyContactLink" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "associatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyContactLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyDealLink" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "associatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyDealLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyTicketLink" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "associatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyTicketLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyCompanyLink" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "associatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyCompanyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertySyncWatermark" (
    "contactId" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertySyncWatermark_pkey" PRIMARY KEY ("contactId")
);

-- CreateTable
CREATE TABLE "PropertyBackfillRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "cursor" TEXT,
    "totalProcessed" INTEGER NOT NULL DEFAULT 0,
    "totalCreated" INTEGER NOT NULL DEFAULT 0,
    "totalAssociated" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyBackfillRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HubSpotPropertyCache_hubspotObjectId_key" ON "HubSpotPropertyCache"("hubspotObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "HubSpotPropertyCache_googlePlaceId_key" ON "HubSpotPropertyCache"("googlePlaceId");

-- CreateIndex
CREATE UNIQUE INDEX "HubSpotPropertyCache_addressHash_key" ON "HubSpotPropertyCache"("addressHash");

-- CreateIndex
CREATE UNIQUE INDEX "HubSpotPropertyCache_attomId_key" ON "HubSpotPropertyCache"("attomId");

-- CreateIndex
CREATE INDEX "HubSpotPropertyCache_normalizedAddress_idx" ON "HubSpotPropertyCache"("normalizedAddress");

-- CreateIndex
CREATE INDEX "HubSpotPropertyCache_city_state_idx" ON "HubSpotPropertyCache"("city", "state");

-- CreateIndex
CREATE INDEX "HubSpotPropertyCache_latitude_longitude_idx" ON "HubSpotPropertyCache"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "HubSpotPropertyCache_attomSyncStatus_idx" ON "HubSpotPropertyCache"("attomSyncStatus");

-- CreateIndex
CREATE INDEX "HubSpotPropertyCache_pbLocation_idx" ON "HubSpotPropertyCache"("pbLocation");

-- CreateIndex
CREATE INDEX "PropertyContactLink_contactId_idx" ON "PropertyContactLink"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyContactLink_propertyId_contactId_label_key" ON "PropertyContactLink"("propertyId", "contactId", "label");

-- CreateIndex
CREATE INDEX "PropertyDealLink_dealId_idx" ON "PropertyDealLink"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyDealLink_propertyId_dealId_key" ON "PropertyDealLink"("propertyId", "dealId");

-- CreateIndex
CREATE INDEX "PropertyTicketLink_ticketId_idx" ON "PropertyTicketLink"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyTicketLink_propertyId_ticketId_key" ON "PropertyTicketLink"("propertyId", "ticketId");

-- CreateIndex
CREATE INDEX "PropertyCompanyLink_companyId_idx" ON "PropertyCompanyLink"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyCompanyLink_propertyId_companyId_label_key" ON "PropertyCompanyLink"("propertyId", "companyId", "label");

-- CreateIndex
CREATE INDEX "PropertySyncWatermark_lastSyncAt_idx" ON "PropertySyncWatermark"("lastSyncAt");

-- CreateIndex
CREATE INDEX "PropertyBackfillRun_status_idx" ON "PropertyBackfillRun"("status");

-- CreateIndex
CREATE INDEX "PropertyBackfillRun_heartbeatAt_idx" ON "PropertyBackfillRun"("heartbeatAt");

-- AddForeignKey
ALTER TABLE "PropertyContactLink" ADD CONSTRAINT "PropertyContactLink_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "HubSpotPropertyCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyDealLink" ADD CONSTRAINT "PropertyDealLink_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "HubSpotPropertyCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyTicketLink" ADD CONSTRAINT "PropertyTicketLink_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "HubSpotPropertyCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyCompanyLink" ADD CONSTRAINT "PropertyCompanyLink_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "HubSpotPropertyCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce single-running backfill invariant (see Chunk 4 Task 4.1).
-- Prisma doesn't support WHERE-filtered unique indexes in its schema DSL,
-- so we add it as raw SQL. Re-running the migration is safe because of IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS property_backfill_run_single_running
  ON "PropertyBackfillRun" (status)
  WHERE status = 'running';
