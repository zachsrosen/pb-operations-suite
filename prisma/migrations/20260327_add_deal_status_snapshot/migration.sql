-- CreateTable
CREATE TABLE "DealStatusSnapshot" (
    "id" SERIAL NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "dealId" TEXT NOT NULL,
    "dealName" TEXT NOT NULL,
    "pipeline" TEXT NOT NULL,
    "dealStage" TEXT NOT NULL,
    "pbLocation" TEXT,
    "ownerId" TEXT NOT NULL,
    "designStatus" TEXT,
    "layoutStatus" TEXT,
    "permittingStatus" TEXT,
    "interconnectionStatus" TEXT,
    "ptoStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealStatusSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DealStatusSnapshot_snapshotDate_dealId_ownerId_key" ON "DealStatusSnapshot"("snapshotDate", "dealId", "ownerId");

-- CreateIndex
CREATE INDEX "DealStatusSnapshot_snapshotDate_idx" ON "DealStatusSnapshot"("snapshotDate");
