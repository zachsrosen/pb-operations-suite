-- Add sales_documents link snapshot + customer-notes-task flag to IDR meeting items

ALTER TABLE "IdrMeetingItem" ADD COLUMN "salesFolderUrl" TEXT;
ALTER TABLE "IdrMeetingItem" ADD COLUMN "customerNotesCreateTask" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "IdrEscalationQueue" ADD COLUMN "customerNotesCreateTask" BOOLEAN NOT NULL DEFAULT false;
