-- CreateTable: cross-instance shared cache for hot HubSpot read paths (projects/deals).
-- Backs lib/shared-cache.ts — one fleet-wide refresh per key via the lockedAt lease,
-- with the last-good payload (value) shared to all serverless instances.
CREATE TABLE "SharedCacheEntry" (
    "key" TEXT NOT NULL,
    "value" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "SharedCacheEntry_pkey" PRIMARY KEY ("key")
);
