-- Increase shade cache precision from E3 (~111m) to E5 (~1.1m) for building-level accuracy.
-- The table was just created and has no production data, so we can drop and recreate the columns.

-- Drop existing unique constraint and index
DROP INDEX IF EXISTS "SolarShadeCache_latE3_lngE3_key";

-- Rename columns
ALTER TABLE "SolarShadeCache" RENAME COLUMN "latE3" TO "latE5";
ALTER TABLE "SolarShadeCache" RENAME COLUMN "lngE3" TO "lngE5";

-- Recreate unique constraint with new column names
CREATE UNIQUE INDEX "SolarShadeCache_latE5_lngE5_key" ON "SolarShadeCache"("latE5", "lngE5");
