-- Add free-text detail for on-call call logs when issueType is "other".
ALTER TABLE "OnCallCallLog" ADD COLUMN "issueTypeOther" TEXT;
