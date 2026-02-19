-- Persist schedule ownership by storing scheduler email for backend authorization checks.
ALTER TABLE "ScheduleRecord"
ADD COLUMN "scheduledByEmail" TEXT;
