-- Add QuickBooks linkage fields for internal SKU sync and push-request tracking
ALTER TABLE "EquipmentSku"
ADD COLUMN "quickbooksItemId" TEXT;

CREATE INDEX "EquipmentSku_quickbooksItemId_idx" ON "EquipmentSku"("quickbooksItemId");

ALTER TABLE "PendingCatalogPush"
ADD COLUMN "quickbooksItemId" TEXT;
