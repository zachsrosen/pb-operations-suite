-- CreateTable
CREATE TABLE "ZuperJobCache" (
    "id" TEXT NOT NULL,
    "jobUid" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "jobCategory" TEXT NOT NULL,
    "jobStatus" TEXT NOT NULL,
    "jobPriority" TEXT,
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "assignedUsers" JSONB,
    "assignedTeam" TEXT,
    "customerAddress" JSONB,
    "hubspotDealId" TEXT,
    "projectName" TEXT,
    "jobTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jobNotes" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawData" JSONB,

    CONSTRAINT "ZuperJobCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HubSpotProjectCache" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "dealName" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "pbLocation" TEXT,
    "systemSizeKw" DOUBLE PRECISION,
    "moduleCount" INTEGER,
    "inverterCount" INTEGER,
    "batteryCount" INTEGER,
    "evCount" INTEGER,
    "closeDate" TIMESTAMP(3),
    "siteSurveyScheduleDate" TIMESTAMP(3),
    "siteSurveyCompletionDate" TIMESTAMP(3),
    "designCompletionDate" TIMESTAMP(3),
    "permitSubmitDate" TIMESTAMP(3),
    "permitIssueDate" TIMESTAMP(3),
    "interconnectionSubmitDate" TIMESTAMP(3),
    "interconnectionApprovalDate" TIMESTAMP(3),
    "constructionScheduleDate" TIMESTAMP(3),
    "constructionCompleteDate" TIMESTAMP(3),
    "inspectionScheduleDate" TIMESTAMP(3),
    "inspectionPassDate" TIMESTAMP(3),
    "ptoSubmitDate" TIMESTAMP(3),
    "ptoGrantedDate" TIMESTAMP(3),
    "zuperJobUid" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawData" JSONB,

    CONSTRAINT "HubSpotProjectCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleRecord" (
    "id" TEXT NOT NULL,
    "scheduleType" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "scheduledDate" TEXT NOT NULL,
    "scheduledStart" TEXT,
    "scheduledEnd" TEXT,
    "assignedUser" TEXT,
    "assignedUserUid" TEXT,
    "assignedTeamUid" TEXT,
    "scheduledBy" TEXT,
    "zuperJobUid" TEXT,
    "zuperSynced" BOOLEAN NOT NULL DEFAULT false,
    "zuperAssigned" BOOLEAN NOT NULL DEFAULT false,
    "zuperError" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZuperJobCache_jobUid_key" ON "ZuperJobCache"("jobUid");

-- CreateIndex
CREATE INDEX "ZuperJobCache_hubspotDealId_idx" ON "ZuperJobCache"("hubspotDealId");

-- CreateIndex
CREATE INDEX "ZuperJobCache_jobCategory_idx" ON "ZuperJobCache"("jobCategory");

-- CreateIndex
CREATE INDEX "ZuperJobCache_jobStatus_idx" ON "ZuperJobCache"("jobStatus");

-- CreateIndex
CREATE INDEX "ZuperJobCache_scheduledStart_idx" ON "ZuperJobCache"("scheduledStart");

-- CreateIndex
CREATE INDEX "ZuperJobCache_lastSyncedAt_idx" ON "ZuperJobCache"("lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HubSpotProjectCache_dealId_key" ON "HubSpotProjectCache"("dealId");

-- CreateIndex
CREATE INDEX "HubSpotProjectCache_stage_idx" ON "HubSpotProjectCache"("stage");

-- CreateIndex
CREATE INDEX "HubSpotProjectCache_pbLocation_idx" ON "HubSpotProjectCache"("pbLocation");

-- CreateIndex
CREATE INDEX "HubSpotProjectCache_lastSyncedAt_idx" ON "HubSpotProjectCache"("lastSyncedAt");

-- CreateIndex
CREATE INDEX "HubSpotProjectCache_zuperJobUid_idx" ON "HubSpotProjectCache"("zuperJobUid");

-- CreateIndex
CREATE INDEX "ScheduleRecord_projectId_idx" ON "ScheduleRecord"("projectId");

-- CreateIndex
CREATE INDEX "ScheduleRecord_scheduledDate_idx" ON "ScheduleRecord"("scheduledDate");

-- CreateIndex
CREATE INDEX "ScheduleRecord_scheduleType_idx" ON "ScheduleRecord"("scheduleType");

-- CreateIndex
CREATE INDEX "ScheduleRecord_status_idx" ON "ScheduleRecord"("status");

-- CreateIndex
CREATE INDEX "ScheduleRecord_zuperJobUid_idx" ON "ScheduleRecord"("zuperJobUid");
