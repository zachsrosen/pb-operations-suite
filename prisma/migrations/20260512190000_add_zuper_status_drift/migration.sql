-- CreateEnum
CREATE TYPE "ZuperDriftType" AS ENUM ('STATUS', 'FAIL_DISAGREEMENT', 'COMPLETION_DATE', 'INSPECTION_PASS_DATE', 'INSPECTION_FAIL_DATE');

-- CreateEnum
CREATE TYPE "ZuperDriftStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "ZuperStatusDrift" (
    "id" TEXT NOT NULL,
    "zuperJobUid" TEXT NOT NULL,
    "hubspotDealId" TEXT,
    "projectNumber" TEXT,
    "dealName" TEXT,
    "pbLocation" TEXT,
    "category" TEXT NOT NULL,
    "zuperJobTitle" TEXT,
    "zuperStatus" TEXT NOT NULL,
    "hubspotStatus" TEXT,
    "driftTypes" "ZuperDriftType"[],
    "zuperCompletedAt" TIMESTAMP(3),
    "hubspotCompletionAt" TIMESTAMP(3),
    "zuperFailedAt" TIMESTAMP(3),
    "hubspotFailAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ZuperDriftStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolveNote" TEXT,

    CONSTRAINT "ZuperStatusDrift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZuperStatusDrift_zuperJobUid_key" ON "ZuperStatusDrift"("zuperJobUid");

-- CreateIndex
CREATE INDEX "ZuperStatusDrift_status_idx" ON "ZuperStatusDrift"("status");

-- CreateIndex
CREATE INDEX "ZuperStatusDrift_hubspotDealId_idx" ON "ZuperStatusDrift"("hubspotDealId");

-- CreateIndex
CREATE INDEX "ZuperStatusDrift_category_idx" ON "ZuperStatusDrift"("category");
