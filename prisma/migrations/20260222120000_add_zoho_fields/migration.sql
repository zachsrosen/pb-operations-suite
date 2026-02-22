-- AlterTable: add zohoItemId to EquipmentSku
ALTER TABLE "EquipmentSku" ADD COLUMN IF NOT EXISTS "zohoItemId" TEXT;

-- AlterTable: add zohoPoId to ProjectBomSnapshot
ALTER TABLE "ProjectBomSnapshot" ADD COLUMN IF NOT EXISTS "zohoPoId" TEXT;
