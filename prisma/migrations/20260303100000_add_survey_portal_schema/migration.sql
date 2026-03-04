-- CreateEnum
CREATE TYPE "SurveyInviteStatus" AS ENUM ('PENDING', 'SCHEDULED', 'RESCHEDULED', 'EXPIRED', 'CANCELLED', 'COMPLETED');

-- AlterEnum: Add portal activity types
ALTER TYPE "ActivityType" ADD VALUE 'PORTAL_INVITE_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'PORTAL_INVITE_SENT';
ALTER TYPE "ActivityType" ADD VALUE 'PORTAL_SURVEY_SCHEDULED';
ALTER TYPE "ActivityType" ADD VALUE 'PORTAL_SURVEY_RESCHEDULED';
ALTER TYPE "ActivityType" ADD VALUE 'PORTAL_SURVEY_CANCELLED';

-- CreateTable: SurveyInvite
CREATE TABLE "SurveyInvite" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "propertyAddress" TEXT NOT NULL,
    "pbLocation" TEXT NOT NULL,
    "systemSize" DOUBLE PRECISION,
    "status" "SurveyInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "scheduledDate" TEXT,
    "scheduledTime" TEXT,
    "cutoffAt" TIMESTAMP(3),
    "crewMemberId" TEXT,
    "scheduleRecordId" TEXT,
    "zuperJobUid" TEXT,
    "accessNotes" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique on tokenHash (covers lookup + uniqueness)
CREATE UNIQUE INDEX "SurveyInvite_tokenHash_key" ON "SurveyInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "SurveyInvite_dealId_idx" ON "SurveyInvite"("dealId");

-- CreateIndex
CREATE INDEX "SurveyInvite_customerEmail_idx" ON "SurveyInvite"("customerEmail");

-- CreateIndex: composite for expiry sweeps
CREATE INDEX "SurveyInvite_status_expiresAt_idx" ON "SurveyInvite"("status", "expiresAt");

-- Partial unique index: at most one active (PENDING or SCHEDULED) invite per deal.
-- App-level check provides fast-path guard with user-friendly error;
-- this index catches races where two requests slip through simultaneously.
CREATE UNIQUE INDEX "SurveyInvite_dealId_active_unique"
  ON "SurveyInvite" ("dealId")
  WHERE status IN ('PENDING', 'SCHEDULED');

-- CreateTable: IdempotencyKey
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_key_scope_key" ON "IdempotencyKey"("key", "scope");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateTable: OutboxEvent
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "inviteId" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboxEvent_status_nextRetryAt_idx" ON "OutboxEvent"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_inviteId_idx" ON "OutboxEvent"("inviteId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "SurveyInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
