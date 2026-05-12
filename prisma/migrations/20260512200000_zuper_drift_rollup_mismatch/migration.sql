-- Add ROLLUP_MISMATCH to ZuperDriftType enum.
-- Used to flag construction sub-type rollup inconsistencies:
-- all sub-type statuses (construction_status_solar/battery/ev) are
-- "Construction Complete" but install_status hasn't followed.
ALTER TYPE "ZuperDriftType" ADD VALUE IF NOT EXISTS 'ROLLUP_MISMATCH';
