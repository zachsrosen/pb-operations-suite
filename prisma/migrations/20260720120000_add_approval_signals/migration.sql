-- CreateTable
CREATE TABLE "ApprovalSignal" (
    "id" TEXT NOT NULL,
    "hubspotDealId" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "actualStatus" TEXT NOT NULL,
    "proposedStatus" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "dismissedMessageIds" TEXT[],
    "dismissCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "ApprovalSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalScanVerdict" (
    "messageId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "quote" TEXT,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalScanVerdict_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
CREATE INDEX "ApprovalSignal_status_idx" ON "ApprovalSignal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalSignal_hubspotDealId_team_signalType_key" ON "ApprovalSignal"("hubspotDealId", "team", "signalType");
