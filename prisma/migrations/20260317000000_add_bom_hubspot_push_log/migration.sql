-- CreateEnum
CREATE TYPE "HubSpotPushStatus" AS ENUM ('PENDING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "BomHubSpotPushLog" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "pushedBy" TEXT NOT NULL,
    "pushedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "deletedPriorCount" INTEGER NOT NULL DEFAULT 0,
    "catalogMissingCount" INTEGER NOT NULL DEFAULT 0,
    "hubspotLinkMissingCount" INTEGER NOT NULL DEFAULT 0,
    "status" "HubSpotPushStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BomHubSpotPushLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BomHubSpotPushLog_dealId_idx" ON "BomHubSpotPushLog"("dealId");

-- CreateIndex
CREATE INDEX "BomHubSpotPushLog_createdAt_idx" ON "BomHubSpotPushLog"("createdAt");

-- Partial unique index: only one PENDING push per deal at a time
CREATE UNIQUE INDEX "BomHubSpotPushLog_dealId_pending_unique"
  ON "BomHubSpotPushLog" ("dealId")
  WHERE "status" = 'PENDING';
