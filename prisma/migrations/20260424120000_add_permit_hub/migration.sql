-- Permit Hub foundation: new ActivityType enum values + PermitHubDraft table.
-- Additive only — no destructive changes. Safe to apply before merging code.

-- Postgres requires ADD VALUE outside a transaction; Prisma handles this when
-- applying, but keep each ALTER TYPE statement on its own line.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PERMIT_SUBMITTED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PERMIT_RESUBMITTED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PERMIT_REJECTION_LOGGED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PERMIT_REVISION_ROUTED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PERMIT_REVISION_COMPLETED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PERMIT_FOLLOWUP';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PERMIT_AS_BUILT_STARTED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PERMIT_AS_BUILT_COMPLETED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PERMIT_ISSUED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PERMIT_SOLARAPP_SUBMITTED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PERMIT_HUB_DRAFT_SAVED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PERMIT_HUB_DRAFT_DISCARDED';

-- PermitHubDraft table — per-user, per-deal, per-action JSON blob for crash recovery
CREATE TABLE "PermitHubDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "actionKind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermitHubDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PermitHubDraft_userId_dealId_actionKind_key"
    ON "PermitHubDraft"("userId", "dealId", "actionKind");

CREATE INDEX "PermitHubDraft_userId_idx" ON "PermitHubDraft"("userId");
CREATE INDEX "PermitHubDraft_updatedAt_idx" ON "PermitHubDraft"("updatedAt");

ALTER TABLE "PermitHubDraft"
    ADD CONSTRAINT "PermitHubDraft_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
