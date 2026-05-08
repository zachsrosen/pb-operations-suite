-- Add aggregator_site_identifier from Tesla API to PowerhubSite
-- This field stores Tesla's partner-assigned site identifier which may
-- contain a PB reference useful for auto-linking to HubSpot deals.
ALTER TABLE "PowerhubSite" ADD COLUMN "aggregatorSiteId" TEXT;
