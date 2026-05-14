-- PE API sync: action items + sync run tracking
-- Adds PeActionItem table for storing PE reviewer feedback per document
-- Adds PeApiSyncRun table for tracking sync run history

-- CreateTable
CREATE TABLE "PeActionItem" (
    "id" TEXT NOT NULL,
    "peProjectId" TEXT NOT NULL,
    "dealId" TEXT,
    "peInternalId" TEXT NOT NULL,
    "actionItemId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docLabel" TEXT NOT NULL,
    "errorCode" TEXT,
    "pageNumber" INTEGER,
    "reviewer" TEXT NOT NULL,
    "notes" TEXT,
    "actionDate" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeApiSyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "projectsFetched" INTEGER NOT NULL DEFAULT 0,
    "docsUpserted" INTEGER NOT NULL DEFAULT 0,
    "actionItems" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'running',

    CONSTRAINT "PeApiSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PeActionItem_actionItemId_key" ON "PeActionItem"("actionItemId");

-- CreateIndex
CREATE INDEX "PeActionItem_dealId_idx" ON "PeActionItem"("dealId");

-- CreateIndex
CREATE INDEX "PeActionItem_peProjectId_idx" ON "PeActionItem"("peProjectId");

-- CreateIndex
CREATE INDEX "PeActionItem_errorCode_idx" ON "PeActionItem"("errorCode");
