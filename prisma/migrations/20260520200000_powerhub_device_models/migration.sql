-- AlterTable: add Tesla device model (part_number) columns to HubSpotPropertyCache
-- Populated by resolvePrimarySite() from primary PowerhubSite.devices JSON,
-- pushed to HubSpot Property/Deal/Ticket + Zuper Property/Job.
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN IF NOT EXISTS "teslaGatewayModel"   TEXT;
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN IF NOT EXISTS "teslaPowerwallModel" TEXT;
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN IF NOT EXISTS "teslaInverterModel"  TEXT;
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN IF NOT EXISTS "teslaMeterModel"     TEXT;
