-- AlterTable
ALTER TABLE "IdrMeetingItem" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
