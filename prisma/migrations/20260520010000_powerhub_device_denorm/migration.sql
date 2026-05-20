-- AlterTable: add Tesla device denormalized columns to HubSpotPropertyCache
-- Populated by resolvePrimarySite() from primary PowerhubSite.devices JSON.
-- IF NOT EXISTS: this migration was applied directly to prod before being checked into git,
-- so the local migration file is recreated here to align history.
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN IF NOT EXISTS "teslaGatewaySerial"    TEXT;
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN IF NOT EXISTS "teslaPowerwallSerials" TEXT;
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN IF NOT EXISTS "teslaInverterSerial"   TEXT;
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN IF NOT EXISTS "teslaMeterSerial"      TEXT;
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN IF NOT EXISTS "teslaHardwareSummary"  TEXT;
