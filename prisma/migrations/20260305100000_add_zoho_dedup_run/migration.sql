-- CreateTable
CREATE TABLE "ZohoDedupRun" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "clustersInput" JSONB NOT NULL,
    "outcomes" JSONB,
    "itemsDeleted" INTEGER NOT NULL DEFAULT 0,
    "itemsSkipped" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "executedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ZohoDedupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZohoDedupRun_tokenHash_key" ON "ZohoDedupRun"("tokenHash");

-- CreateIndex
CREATE INDEX "ZohoDedupRun_executedBy_idx" ON "ZohoDedupRun"("executedBy");

-- CreateIndex
CREATE INDEX "ZohoDedupRun_createdAt_idx" ON "ZohoDedupRun"("createdAt");
