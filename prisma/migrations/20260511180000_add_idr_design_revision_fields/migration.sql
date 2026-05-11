-- AlterTable: IdrMeetingItem
ALTER TABLE "IdrMeetingItem" ADD COLUMN "designRevisionNeeded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "IdrMeetingItem" ADD COLUMN "designRevisionReason" TEXT;

-- AlterTable: IdrEscalationQueue
ALTER TABLE "IdrEscalationQueue" ADD COLUMN "designRevisionNeeded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "IdrEscalationQueue" ADD COLUMN "designRevisionReason" TEXT;
