-- Add PAGE_DWELL to ActivityType enum (additive)
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PAGE_DWELL';

-- Composite index to speed windowed type-filtered aggregation
CREATE INDEX IF NOT EXISTS "ActivityLog_type_createdAt_idx" ON "ActivityLog" ("type", "createdAt");
