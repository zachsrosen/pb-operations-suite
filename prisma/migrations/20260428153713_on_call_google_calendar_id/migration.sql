-- Per-pool Google Calendar ID. Populated lazily on first publish via the
-- existing service-account DWD setup. Each on-call pool (California, Colorado)
-- gets its own shared calendar.
ALTER TABLE "OnCallPool"
  ADD COLUMN IF NOT EXISTS "googleCalendarId" TEXT;
