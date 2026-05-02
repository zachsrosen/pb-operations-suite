-- CreateTable
CREATE TABLE "AircallCallRing" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'aircall',
    "userAircallId" TEXT NOT NULL,
    "userName" TEXT,
    "userEmail" TEXT,
    "direction" TEXT,
    "ringedAt" TIMESTAMP(3) NOT NULL,
    "answeredAt" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AircallCallRing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AircallCallRing_callId_userAircallId_key" ON "AircallCallRing"("callId", "userAircallId");

-- CreateIndex
CREATE INDEX "AircallCallRing_userAircallId_ringedAt_idx" ON "AircallCallRing"("userAircallId", "ringedAt");

-- CreateIndex
CREATE INDEX "AircallCallRing_ringedAt_idx" ON "AircallCallRing"("ringedAt");

-- CreateIndex
CREATE INDEX "AircallCallRing_provider_ringedAt_idx" ON "AircallCallRing"("provider", "ringedAt");
