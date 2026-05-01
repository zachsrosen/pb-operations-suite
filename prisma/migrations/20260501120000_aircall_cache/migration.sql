-- AlterEnum
-- Aircall (Phase 1 of Call Analytics)
ALTER TYPE "ActivityType" ADD VALUE 'WEBHOOK_AIRCALL_CALL_ENDED';
ALTER TYPE "ActivityType" ADD VALUE 'WEBHOOK_AIRCALL_SIGNATURE_FAILED';
ALTER TYPE "ActivityType" ADD VALUE 'AIRCALL_BACKFILL_RUN';
ALTER TYPE "ActivityType" ADD VALUE 'AIRCALL_SYNC_RUN';

-- CreateTable
CREATE TABLE "AircallCallCache" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'aircall',
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "talkTimeSec" INTEGER NOT NULL DEFAULT 0,
    "timeToAnswerSec" INTEGER,
    "userAircallId" TEXT,
    "userName" TEXT,
    "userEmail" TEXT,
    "customerNumber" TEXT,
    "rawPayload" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AircallCallCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AircallCallCache_startedAt_idx" ON "AircallCallCache"("startedAt");

-- CreateIndex
CREATE INDEX "AircallCallCache_userAircallId_startedAt_idx" ON "AircallCallCache"("userAircallId", "startedAt");

-- CreateIndex
CREATE INDEX "AircallCallCache_direction_status_startedAt_idx" ON "AircallCallCache"("direction", "status", "startedAt");

-- CreateIndex
CREATE INDEX "AircallCallCache_provider_startedAt_idx" ON "AircallCallCache"("provider", "startedAt");

-- CreateTable
CREATE TABLE "AircallUserCache" (
    "aircallUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "doNotDisturb" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AircallUserCache_pkey" PRIMARY KEY ("aircallUserId")
);

-- CreateIndex
CREATE INDEX "AircallUserCache_archived_name_idx" ON "AircallUserCache"("archived", "name");
