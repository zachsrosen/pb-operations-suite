-- CreateEnum
CREATE TYPE "ShitShowSessionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ShitShowDecision" AS ENUM ('PENDING', 'RESOLVED', 'STILL_PROBLEM', 'ESCALATED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "ShitShowSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "ShitShowAddedBy" AS ENUM ('SYSTEM', 'MANUAL');

-- CreateEnum
CREATE TYPE "ShitShowAssignmentStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ShitShowSession" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "ShitShowSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShitShowSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShitShowSessionItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "dealName" TEXT NOT NULL,
    "dealAmount" DOUBLE PRECISION,
    "systemSizeKw" DOUBLE PRECISION,
    "stage" TEXT,
    "dealOwner" TEXT,
    "reasonSnapshot" TEXT,
    "flaggedSince" TIMESTAMP(3),
    "address" TEXT,
    "projectType" TEXT,
    "equipmentSummary" TEXT,
    "surveyStatus" TEXT,
    "surveyDate" TEXT,
    "designStatus" TEXT,
    "designApprovalStatus" TEXT,
    "plansetDate" TEXT,
    "ahj" TEXT,
    "utilityCompany" TEXT,
    "projectManager" TEXT,
    "operationsManager" TEXT,
    "siteSurveyor" TEXT,
    "driveFolderUrl" TEXT,
    "surveyFolderUrl" TEXT,
    "designFolderUrl" TEXT,
    "salesFolderUrl" TEXT,
    "openSolarUrl" TEXT,
    "snapshotUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meetingNotes" TEXT,
    "decision" "ShitShowDecision" NOT NULL DEFAULT 'PENDING',
    "decisionRationale" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "hubspotNoteId" TEXT,
    "noteSyncStatus" "ShitShowSyncStatus" NOT NULL DEFAULT 'PENDING',
    "noteSyncError" TEXT,
    "idrEscalationQueueId" TEXT,
    "hubspotEscalationTaskId" TEXT,
    "addedBy" "ShitShowAddedBy" NOT NULL DEFAULT 'SYSTEM',
    "addedByUser" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShitShowSessionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShitShowAssignment" (
    "id" TEXT NOT NULL,
    "sessionItemId" TEXT NOT NULL,
    "assigneeUserId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "actionText" TEXT NOT NULL,
    "status" "ShitShowAssignmentStatus" NOT NULL DEFAULT 'OPEN',
    "hubspotTaskId" TEXT,
    "taskSyncStatus" "ShitShowSyncStatus" NOT NULL DEFAULT 'PENDING',
    "taskSyncError" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShitShowAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShitShowBackfillRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "processed" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "errorLog" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',

    CONSTRAINT "ShitShowBackfillRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShitShowSession_date_idx" ON "ShitShowSession"("date");

-- CreateIndex
CREATE INDEX "ShitShowSessionItem_sessionId_region_idx" ON "ShitShowSessionItem"("sessionId", "region");

-- CreateIndex
CREATE INDEX "ShitShowSessionItem_dealId_idx" ON "ShitShowSessionItem"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "ShitShowSessionItem_sessionId_dealId_key" ON "ShitShowSessionItem"("sessionId", "dealId");

-- CreateIndex
CREATE INDEX "ShitShowAssignment_sessionItemId_idx" ON "ShitShowAssignment"("sessionItemId");

-- CreateIndex
CREATE INDEX "ShitShowAssignment_assigneeUserId_status_idx" ON "ShitShowAssignment"("assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "ShitShowBackfillRun_status_idx" ON "ShitShowBackfillRun"("status");

-- AddForeignKey
ALTER TABLE "ShitShowSessionItem" ADD CONSTRAINT "ShitShowSessionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ShitShowSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShitShowAssignment" ADD CONSTRAINT "ShitShowAssignment_sessionItemId_fkey" FOREIGN KEY ("sessionItemId") REFERENCES "ShitShowSessionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

