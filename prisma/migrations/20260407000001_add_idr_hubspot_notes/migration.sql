-- AlterTable
ALTER TABLE "IdrMeetingItem" ADD COLUMN "salesNotes" TEXT;
ALTER TABLE "IdrMeetingItem" ADD COLUMN "salesChangeOrderNotes" TEXT;
ALTER TABLE "IdrMeetingItem" ADD COLUMN "salesChangeOrderNeeded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "IdrMeetingItem" ADD COLUMN "notesForDesign" TEXT;
ALTER TABLE "IdrMeetingItem" ADD COLUMN "specificNotesForDesign" TEXT;
