-- Add AVAILABILITY_CHANGED to ActivityType enum for self-service availability edits.
-- Separates routine crew availability changes (MEDIUM risk) from admin SETTINGS_CHANGED (CRITICAL risk).

ALTER TYPE "ActivityType" ADD VALUE 'AVAILABILITY_CHANGED';
