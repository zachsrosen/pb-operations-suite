-- AlterTable: TrueDesign design export file references on EagleViewOrder.
ALTER TABLE "EagleViewOrder" ADD COLUMN "designVersionId" TEXT;
ALTER TABLE "EagleViewOrder" ADD COLUMN "dxfDriveFileId" TEXT;
ALTER TABLE "EagleViewOrder" ADD COLUMN "dwgDriveFileId" TEXT;
ALTER TABLE "EagleViewOrder" ADD COLUMN "designPdfDriveFileId" TEXT;
ALTER TABLE "EagleViewOrder" ADD COLUMN "designFilesPulledAt" TIMESTAMP(3);
