-- Add ops revision notes field to IdrMeetingItem
ALTER TABLE "IdrMeetingItem" ADD COLUMN "opsRevisionNotes" TEXT;

-- Add tier adder booleans to IdrMeetingItem
ALTER TABLE "IdrMeetingItem" ADD COLUMN "adderTier1" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "IdrMeetingItem" ADD COLUMN "adderTier2" BOOLEAN NOT NULL DEFAULT false;

-- Add ops revision notes + tier adder booleans to IdrEscalationQueue
ALTER TABLE "IdrEscalationQueue" ADD COLUMN "opsRevisionNotes" TEXT;
ALTER TABLE "IdrEscalationQueue" ADD COLUMN "adderTier1" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "IdrEscalationQueue" ADD COLUMN "adderTier2" BOOLEAN NOT NULL DEFAULT false;
