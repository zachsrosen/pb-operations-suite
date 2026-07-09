-- Add DNR_SERVICE to IdrItemType + pipeline snapshot column (additive)
ALTER TYPE "IdrItemType" ADD VALUE 'DNR_SERVICE';
ALTER TABLE "IdrMeetingItem" ADD COLUMN "pipeline" TEXT;
