-- AlterTable
ALTER TABLE "EquipmentSku" ADD COLUMN     "zohoVendorId" TEXT;

-- AlterTable
ALTER TABLE "PendingCatalogPush" ADD COLUMN     "zohoVendorId" TEXT;

-- CreateTable
CREATE TABLE "VendorLookup" (
    "id" TEXT NOT NULL,
    "zohoVendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorLookup_zohoVendorId_key" ON "VendorLookup"("zohoVendorId");

-- CreateIndex
CREATE INDEX "VendorLookup_isActive_name_idx" ON "VendorLookup"("isActive", "name");

-- CreateIndex
CREATE INDEX "EquipmentSku_zohoVendorId_idx" ON "EquipmentSku"("zohoVendorId");

-- CreateIndex
CREATE INDEX "PendingCatalogPush_zohoVendorId_idx" ON "PendingCatalogPush"("zohoVendorId");
