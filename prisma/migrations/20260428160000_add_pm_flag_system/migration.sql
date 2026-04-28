-- CreateEnum
CREATE TYPE "PmFlagType" AS ENUM ('STAGE_STUCK', 'MILESTONE_OVERDUE', 'CUSTOMER_COMPLAINT', 'MISSING_DATA', 'CHANGE_ORDER', 'INSTALL_BLOCKED', 'PERMIT_ISSUE', 'INTERCONNECT_ISSUE', 'DESIGN_ISSUE', 'PAYMENT_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "PmFlagSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PmFlagStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PmFlagSource" AS ENUM ('HUBSPOT_WORKFLOW', 'MANUAL', 'ADMIN_WORKFLOW');

-- CreateEnum
CREATE TYPE "PmFlagEventType" AS ENUM ('RAISED', 'ASSIGNED', 'ACKNOWLEDGED', 'NOTE_ADDED', 'REASSIGNED', 'RESOLVED', 'REOPENED', 'CANCELLED');

-- AlterEnum: ActivityType new values for PM Flag system
ALTER TYPE "ActivityType" ADD VALUE 'PM_FLAG_RAISED';
ALTER TYPE "ActivityType" ADD VALUE 'PM_FLAG_ASSIGNED';
ALTER TYPE "ActivityType" ADD VALUE 'PM_FLAG_ACKNOWLEDGED';
ALTER TYPE "ActivityType" ADD VALUE 'PM_FLAG_REASSIGNED';
ALTER TYPE "ActivityType" ADD VALUE 'PM_FLAG_RESOLVED';
ALTER TYPE "ActivityType" ADD VALUE 'PM_FLAG_REOPENED';
ALTER TYPE "ActivityType" ADD VALUE 'PM_FLAG_CANCELLED';
ALTER TYPE "ActivityType" ADD VALUE 'PM_FLAG_NOTE_ADDED';

-- CreateTable
CREATE TABLE "PmFlag" (
    "id" TEXT NOT NULL,
    "hubspotDealId" TEXT NOT NULL,
    "dealName" TEXT,
    "type" "PmFlagType" NOT NULL,
    "severity" "PmFlagSeverity" NOT NULL,
    "status" "PmFlagStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "source" "PmFlagSource" NOT NULL,
    "externalRef" TEXT,
    "metadata" JSONB,
    "raisedByUserId" TEXT,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedToUserId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolvedNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PmFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmFlagEvent" (
    "id" TEXT NOT NULL,
    "flagId" TEXT NOT NULL,
    "eventType" "PmFlagEventType" NOT NULL,
    "actorUserId" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmFlagEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PmFlag_hubspotDealId_idx" ON "PmFlag"("hubspotDealId");

-- CreateIndex
CREATE INDEX "PmFlag_assignedToUserId_status_idx" ON "PmFlag"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "PmFlag_status_severity_idx" ON "PmFlag"("status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "PmFlag_source_externalRef_key" ON "PmFlag"("source", "externalRef");

-- CreateIndex
CREATE INDEX "PmFlagEvent_flagId_createdAt_idx" ON "PmFlagEvent"("flagId", "createdAt");

-- AddForeignKey
ALTER TABLE "PmFlag" ADD CONSTRAINT "PmFlag_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmFlag" ADD CONSTRAINT "PmFlag_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmFlag" ADD CONSTRAINT "PmFlag_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmFlagEvent" ADD CONSTRAINT "PmFlagEvent_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "PmFlag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmFlagEvent" ADD CONSTRAINT "PmFlagEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
