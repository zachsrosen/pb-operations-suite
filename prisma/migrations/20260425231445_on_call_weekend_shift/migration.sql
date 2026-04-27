-- On-call weekend shift hours (Sat/Sun = 8am-12pm, weekdays = 6pm-10pm).
-- Adds two columns with defaults so existing rows pick up sensible values.

ALTER TABLE "OnCallPool"
  ADD COLUMN IF NOT EXISTS "weekendShiftStart" TEXT NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS "weekendShiftEnd"   TEXT NOT NULL DEFAULT '12:00';
