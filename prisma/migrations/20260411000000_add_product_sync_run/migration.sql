-- CreateTable
CREATE TABLE "ProductSyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "trigger" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "zohoScanned" INTEGER NOT NULL DEFAULT 0,
    "hubspotScanned" INTEGER NOT NULL DEFAULT 0,
    "zuperScanned" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "linked" INTEGER NOT NULL DEFAULT 0,
    "flagged" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "lockSentinel" TEXT,

    CONSTRAINT "ProductSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSyncRun_startedAt_idx" ON "ProductSyncRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_sync_active_run" ON "ProductSyncRun"("lockSentinel");
