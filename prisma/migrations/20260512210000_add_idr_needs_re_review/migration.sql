-- AlterTable
ALTER TABLE "IdrMeetingItem" ADD COLUMN "needsReReview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "IdrEscalationQueue" ADD COLUMN "needsReReview" BOOLEAN NOT NULL DEFAULT false;
