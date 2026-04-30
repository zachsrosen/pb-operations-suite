-- Add sales change dollar amount for 10% threshold check
ALTER TABLE "IdrMeetingItem" ADD COLUMN "salesChangeAmount" DOUBLE PRECISION;
ALTER TABLE "IdrEscalationQueue" ADD COLUMN "salesChangeAmount" DOUBLE PRECISION;
