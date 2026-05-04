-- CreateEnum
CREATE TYPE "DaDriftStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "DaStatusDrift" (
    "id" TEXT NOT NULL,
    "pandaDocId" TEXT NOT NULL,
    "hubspotDealId" TEXT NOT NULL,
    "templateId" TEXT,
    "documentName" TEXT,
    "pandaDocStatus" TEXT NOT NULL,
    "expectedHubspot" TEXT NOT NULL,
    "actualHubspot" TEXT,
    "pandaDocSentAt" TIMESTAMP(3),
    "pandaDocCompleted" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DaDriftStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolveNote" TEXT,

    CONSTRAINT "DaStatusDrift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DaStatusDrift_pandaDocId_key" ON "DaStatusDrift"("pandaDocId");

-- CreateIndex
CREATE INDEX "DaStatusDrift_status_detectedAt_idx" ON "DaStatusDrift"("status", "detectedAt");

-- CreateIndex
CREATE INDEX "DaStatusDrift_hubspotDealId_idx" ON "DaStatusDrift"("hubspotDealId");
