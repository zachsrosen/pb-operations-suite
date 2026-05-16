-- AlterTable
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN "shovelsEnrichmentStatus" TEXT,
ADD COLUMN "shovelsGeoId" TEXT,
ADD COLUMN "shovelsLastSyncedAt" TIMESTAMP(3),
ADD COLUMN "shovelsMatchConfidence" TEXT,
ADD COLUMN "shovelsPermitCount" INTEGER,
ADD COLUMN "shovelsRetryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "shovelsSolarPermitCount" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "HubSpotPropertyCache_shovelsGeoId_key" ON "HubSpotPropertyCache"("shovelsGeoId");

-- CreateIndex
CREATE INDEX "HubSpotPropertyCache_shovelsEnrichmentStatus_idx" ON "HubSpotPropertyCache"("shovelsEnrichmentStatus");

-- CreateTable
CREATE TABLE "ShovelsPermitRecord" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "shovelsId" TEXT NOT NULL,
    "permitNumber" TEXT,
    "description" TEXT,
    "jurisdiction" TEXT,
    "type" TEXT,
    "subtype" TEXT,
    "status" TEXT,
    "tags" TEXT[],
    "jobValueCents" INTEGER,
    "feesCents" INTEGER,
    "fileDate" TIMESTAMP(3),
    "issueDate" TIMESTAMP(3),
    "finalDate" TIMESTAMP(3),
    "contractorId" TEXT,
    "constructionDurationDays" INTEGER,
    "approvalDurationDays" INTEGER,
    "inspectionPassRate" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShovelsPermitRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShovelsResident" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT,
    "personalEmail" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "netWorth" TEXT,
    "incomeRange" TEXT,
    "isHomeowner" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShovelsResident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShovelsContractor" (
    "id" TEXT NOT NULL,
    "shovelsId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "license" TEXT,
    "classification" TEXT,
    "totalPermitsCount" INTEGER,
    "avgInspectionRate" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShovelsContractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShovelsBackfillRun" (
    "id" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "cursor" TEXT,
    "totalProcessed" INTEGER NOT NULL DEFAULT 0,
    "totalEnriched" INTEGER NOT NULL DEFAULT 0,
    "totalNoMatch" INTEGER NOT NULL DEFAULT 0,
    "totalRejected" INTEGER NOT NULL DEFAULT 0,
    "totalErrors" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShovelsBackfillRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShovelsPermitRecord_propertyId_shovelsId_key" ON "ShovelsPermitRecord"("propertyId", "shovelsId");

-- CreateIndex
CREATE INDEX "ShovelsPermitRecord_propertyId_idx" ON "ShovelsPermitRecord"("propertyId");

-- CreateIndex
CREATE INDEX "ShovelsPermitRecord_tags_idx" ON "ShovelsPermitRecord"("tags");

-- CreateIndex
CREATE INDEX "ShovelsResident_propertyId_idx" ON "ShovelsResident"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ShovelsContractor_shovelsId_key" ON "ShovelsContractor"("shovelsId");

-- AddForeignKey
ALTER TABLE "ShovelsPermitRecord" ADD CONSTRAINT "ShovelsPermitRecord_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "HubSpotPropertyCache"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShovelsResident" ADD CONSTRAINT "ShovelsResident_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "HubSpotPropertyCache"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
