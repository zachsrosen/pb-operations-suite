-- DropIndex
DROP INDEX IF EXISTS "ShopHealthBottleneck_location_weekStart_key";

-- CreateIndex (non-unique composite for query performance)
CREATE INDEX IF NOT EXISTS "ShopHealthBottleneck_location_weekStart_idx" ON "ShopHealthBottleneck"("location", "weekStart");
