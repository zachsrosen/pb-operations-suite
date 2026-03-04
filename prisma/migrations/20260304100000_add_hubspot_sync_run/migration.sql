-- CreateTable
CREATE TABLE "HubSpotSyncRun" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "inputHash" TEXT NOT NULL,
    "cursor" TEXT,
    "targetIds" JSONB,
    "outcomes" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "itemsSkipped" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "executedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "HubSpotSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotency key)
CREATE UNIQUE INDEX "HubSpotSyncRun_tokenHash_key" ON "HubSpotSyncRun"("tokenHash");

-- CreateIndex (query support)
CREATE INDEX "HubSpotSyncRun_operation_operationId_status_idx" ON "HubSpotSyncRun"("operation", "operationId", "status");

-- CreateIndex
CREATE INDEX "HubSpotSyncRun_executedBy_idx" ON "HubSpotSyncRun"("executedBy");

-- CreateIndex
CREATE INDEX "HubSpotSyncRun_createdAt_idx" ON "HubSpotSyncRun"("createdAt");

-- Partial unique index for mutual exclusion: only one RUNNING run per (operation, operationId)
CREATE UNIQUE INDEX "HubSpotSyncRun_running_lock" ON "HubSpotSyncRun" ("operation", "operationId") WHERE "status" = 'RUNNING';
