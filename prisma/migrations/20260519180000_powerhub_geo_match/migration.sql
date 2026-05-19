-- PowerHub geo-coordinate matching support
-- Adds latitude/longitude/linkDistanceM to PowerhubSite + GEO link method
-- Spec: docs/superpowers/specs/2026-05-19-powerhub-geo-linking-design.md

-- 1) Add GEO to PowerhubLinkMethod enum
ALTER TYPE "PowerhubLinkMethod" ADD VALUE 'GEO';

-- 2) Add geo columns to PowerhubSite
ALTER TABLE "PowerhubSite"
  ADD COLUMN "latitude"       DOUBLE PRECISION,
  ADD COLUMN "longitude"      DOUBLE PRECISION,
  ADD COLUMN "linkDistanceM"  DOUBLE PRECISION,
  ADD COLUMN "lastGeoSyncAt"  TIMESTAMP(3);

-- 3) Spatial-ish index for bounding-box pre-filter on geo match
CREATE INDEX "PowerhubSite_latitude_longitude_idx"
  ON "PowerhubSite" ("latitude", "longitude");
