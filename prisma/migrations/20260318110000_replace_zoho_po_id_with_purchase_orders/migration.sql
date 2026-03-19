-- AlterTable
ALTER TABLE "ProjectBomSnapshot" ADD COLUMN "zohoPurchaseOrders" JSONB;

-- Migrate existing single PO IDs into JSON array format
UPDATE "ProjectBomSnapshot"
SET "zohoPurchaseOrders" = jsonb_build_array(
  jsonb_build_object(
    'vendorId', 'unknown',
    'vendorName', 'Unknown (migrated)',
    'poId', "zohoPoId",
    'poNumber', null::text,
    'itemCount', 0
  )
)
WHERE "zohoPoId" IS NOT NULL;

-- AlterTable
ALTER TABLE "ProjectBomSnapshot" DROP COLUMN "zohoPoId";

-- AlterEnum
ALTER TYPE "BomPipelineStep" ADD VALUE IF NOT EXISTS 'CREATE_PO';
