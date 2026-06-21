-- CreateTable
CREATE TABLE "VishtikSyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "written" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "ambiguousCount" INTEGER NOT NULL DEFAULT 0,
    "writeFailures" INTEGER NOT NULL DEFAULT 0,
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "aborted" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VishtikSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VishtikSyncRun_startedAt_idx" ON "VishtikSyncRun"("startedAt");
