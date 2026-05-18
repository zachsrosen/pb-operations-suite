-- CreateTable
CREATE TABLE "PeActionTask" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "pCode" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "analyzer" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "manualResolvedAt" TIMESTAMP(3),
    "dismissedReason" TEXT,
    "firstSeenRunId" TEXT,
    "lastSeenRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeActionTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PeActionTask_dealId_identityKey_key" ON "PeActionTask"("dealId", "identityKey");

-- CreateIndex
CREATE INDEX "PeActionTask_dealId_status_idx" ON "PeActionTask"("dealId", "status");

-- CreateIndex
CREATE INDEX "PeActionTask_severity_status_idx" ON "PeActionTask"("severity", "status");

-- CreateIndex
CREATE INDEX "PeActionTask_category_status_idx" ON "PeActionTask"("category", "status");

-- CreateIndex
CREATE INDEX "PeActionTask_pCode_idx" ON "PeActionTask"("pCode");

-- CreateTable
CREATE TABLE "CrossRefRun" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "detectedCount" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedCount" INTEGER NOT NULL DEFAULT 0,
    "extractorResults" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossRefRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrossRefRun_dealId_startedAt_idx" ON "CrossRefRun"("dealId", "startedAt");
