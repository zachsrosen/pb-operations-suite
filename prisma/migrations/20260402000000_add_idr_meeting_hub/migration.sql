-- CreateEnum
CREATE TYPE "IdrSessionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "IdrItemType" AS ENUM ('IDR', 'ESCALATION');

-- CreateEnum
CREATE TYPE "IdrSyncStatus" AS ENUM ('DRAFT', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "IdrThreadPostStatus" AS ENUM ('PENDING', 'POSTED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "IdrMeetingSession" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "IdrSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdrMeetingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdrMeetingItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "type" "IdrItemType" NOT NULL DEFAULT 'IDR',
    "region" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "dealName" TEXT NOT NULL,
    "address" TEXT,
    "projectType" TEXT,
    "equipmentSummary" TEXT,
    "systemSizeKw" DOUBLE PRECISION,
    "surveyStatus" TEXT,
    "surveyDate" TEXT,
    "designStatus" TEXT,
    "plansetDate" TEXT,
    "driveFolderUrl" TEXT,
    "surveyFolderUrl" TEXT,
    "designFolderUrl" TEXT,
    "ahj" TEXT,
    "utilityCompany" TEXT,
    "openSolarUrl" TEXT,
    "surveyCompleted" BOOLEAN NOT NULL DEFAULT false,
    "snapshotUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "difficulty" INTEGER,
    "installerCount" INTEGER,
    "installerDays" INTEGER,
    "electricianCount" INTEGER,
    "electricianDays" INTEGER,
    "discoReco" BOOLEAN,
    "interiorAccess" BOOLEAN,
    "customerNotes" TEXT,
    "operationsNotes" TEXT,
    "designNotes" TEXT,
    "conclusion" TEXT,
    "escalationReason" TEXT,
    "hubspotSyncStatus" "IdrSyncStatus" NOT NULL DEFAULT 'DRAFT',
    "hubspotSyncedAt" TIMESTAMP(3),
    "threadPostStatus" "IdrThreadPostStatus" NOT NULL DEFAULT 'SKIPPED',
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdrMeetingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdrMeetingNote" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdrMeetingNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdrMeetingSession_date_idx" ON "IdrMeetingSession"("date");

-- CreateIndex
CREATE INDEX "IdrMeetingItem_sessionId_region_idx" ON "IdrMeetingItem"("sessionId", "region");

-- CreateIndex
CREATE INDEX "IdrMeetingItem_dealId_idx" ON "IdrMeetingItem"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "IdrMeetingItem_sessionId_dealId_key" ON "IdrMeetingItem"("sessionId", "dealId");

-- CreateIndex
CREATE INDEX "IdrMeetingNote_itemId_idx" ON "IdrMeetingNote"("itemId");

-- CreateIndex
CREATE INDEX "IdrMeetingNote_dealId_createdAt_idx" ON "IdrMeetingNote"("dealId", "createdAt");

-- AddForeignKey
ALTER TABLE "IdrMeetingItem" ADD CONSTRAINT "IdrMeetingItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IdrMeetingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdrMeetingNote" ADD CONSTRAINT "IdrMeetingNote_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "IdrMeetingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
