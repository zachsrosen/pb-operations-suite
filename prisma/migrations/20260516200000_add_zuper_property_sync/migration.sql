-- AlterTable
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN "zuperPropertyUid" TEXT,
ADD COLUMN "zuperPropertySyncedAt" TIMESTAMP(3),
ADD COLUMN "zuperSyncFailCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "HubSpotPropertyCache_zuperPropertyUid_key" ON "HubSpotPropertyCache"("zuperPropertyUid");
