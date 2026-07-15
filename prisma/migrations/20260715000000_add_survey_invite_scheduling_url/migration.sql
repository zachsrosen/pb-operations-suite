-- Add nullable schedulingUrl to SurveyInvite: stores the raw self-scheduling
-- link so reps can re-copy it for follow-up (only the token hash is otherwise
-- persisted). Additive + nullable — safe to apply before code deploy.
ALTER TABLE "SurveyInvite" ADD COLUMN "schedulingUrl" TEXT;
