-- Denormalize Tesla device summary onto HubSpotPropertyCache so the existing
-- sync paths (HubSpot Property/Deal/Ticket + Zuper Property/Job) can pick up
-- per-device serials without each push path re-reading the PowerhubSite
-- devices JSON.
--
-- Populated by resolvePrimarySite() from the primary linked PowerhubSite.

ALTER TABLE "HubSpotPropertyCache"
  ADD COLUMN "teslaGatewaySerial"    TEXT,
  ADD COLUMN "teslaPowerwallSerials" TEXT,
  ADD COLUMN "teslaInverterSerial"   TEXT,
  ADD COLUMN "teslaMeterSerial"      TEXT,
  ADD COLUMN "teslaHardwareSummary"  TEXT;
