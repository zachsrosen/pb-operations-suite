-- CreateTable
CREATE TABLE "OooBotConversation" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "threadId" TEXT,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "toolsUsed" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OooBotConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OooBotEscalation" (
    "id" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "botContext" TEXT,
    "spaceId" TEXT NOT NULL,
    "threadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OooBotEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OooBotConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "playbook" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "oooStartDate" TIMESTAMP(3) NOT NULL,
    "oooEndDate" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OooBotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OooBotConversation_spaceId_threadId_createdAt_idx" ON "OooBotConversation"("spaceId", "threadId", "createdAt");

-- CreateIndex
CREATE INDEX "OooBotEscalation_status_createdAt_idx" ON "OooBotEscalation"("status", "createdAt");
