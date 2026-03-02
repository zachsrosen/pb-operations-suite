-- CreateTable
CREATE TABLE "ProjectReview" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "projectId" TEXT,
    "skill" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "findings" JSONB NOT NULL,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dealId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectReview_dealId_skill_idx" ON "ProjectReview"("dealId", "skill");

-- CreateIndex
CREATE INDEX "ProjectReview_createdAt_idx" ON "ProjectReview"("createdAt");

-- CreateIndex
CREATE INDEX "ProjectReview_skill_passed_idx" ON "ProjectReview"("skill", "passed");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_dealId_idx" ON "ChatMessage"("userId", "dealId");

-- CreateIndex
CREATE INDEX "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt");
