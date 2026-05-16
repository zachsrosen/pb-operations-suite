-- CreateTable
CREATE TABLE "PeAuditRun" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "dealName" TEXT NOT NULL,
    "milestone" TEXT NOT NULL,
    "systemType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "results" JSONB,
    "summary" JSONB,
    "packageFolderId" TEXT,
    "packageFolderUrl" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "visionCallCount" INTEGER NOT NULL DEFAULT 0,
    "pandadocPulled" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PeAuditRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeAuditRun_dealId_milestone_idx" ON "PeAuditRun"("dealId", "milestone");

-- CreateIndex
CREATE INDEX "PeAuditRun_status_idx" ON "PeAuditRun"("status");
