-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'DEAL_SYNC_BATCH_COMPLETE';
ALTER TYPE "ActivityType" ADD VALUE 'DEAL_SYNC_WEBHOOK_RECEIVED';
ALTER TYPE "ActivityType" ADD VALUE 'DEAL_SYNC_ERROR';
ALTER TYPE "ActivityType" ADD VALUE 'DEAL_SYNC_DISCREPANCY';

-- CreateEnum
CREATE TYPE "DealPipeline" AS ENUM ('SALES', 'PROJECT', 'DNR', 'SERVICE', 'ROOFING');

-- CreateEnum
CREATE TYPE "DealSyncSource" AS ENUM ('BATCH', 'WEBHOOK', 'MANUAL');

-- CreateEnum
CREATE TYPE "DealSyncType" AS ENUM ('BATCH_FULL', 'BATCH_INCREMENTAL', 'WEBHOOK', 'MANUAL');

-- CreateEnum
CREATE TYPE "DealSyncStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "hubspotDealId" TEXT NOT NULL,
    "dealName" TEXT NOT NULL,
    "pipeline" "DealPipeline" NOT NULL,
    "stage" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "amount" DECIMAL(65,30),
    "pbLocation" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "ahj" TEXT,
    "utility" TEXT,
    "hubspotOwnerId" TEXT,
    "dealOwnerName" TEXT,
    "projectManager" TEXT,
    "operationsManager" TEXT,
    "siteSurveyor" TEXT,
    "departmentLeads" JSONB,
    "closeDate" TIMESTAMP(3),
    "siteSurveyScheduleDate" TIMESTAMP(3),
    "siteSurveyScheduledDate" TIMESTAMP(3),
    "siteSurveyCompletionDate" TIMESTAMP(3),
    "dateReturnedFromDesigners" TIMESTAMP(3),
    "designStartDate" TIMESTAMP(3),
    "designDraftCompletionDate" TIMESTAMP(3),
    "designCompletionDate" TIMESTAMP(3),
    "designApprovalSentDate" TIMESTAMP(3),
    "layoutApprovalDate" TIMESTAMP(3),
    "permitSubmitDate" TIMESTAMP(3),
    "permitIssueDate" TIMESTAMP(3),
    "icSubmitDate" TIMESTAMP(3),
    "icApprovalDate" TIMESTAMP(3),
    "rtbDate" TIMESTAMP(3),
    "installScheduleDate" TIMESTAMP(3),
    "constructionCompleteDate" TIMESTAMP(3),
    "inspectionScheduleDate" TIMESTAMP(3),
    "inspectionPassDate" TIMESTAMP(3),
    "inspectionFailDate" TIMESTAMP(3),
    "inspectionBookedDate" TIMESTAMP(3),
    "ptoStartDate" TIMESTAMP(3),
    "ptoCompletionDate" TIMESTAMP(3),
    "forecastedInstallDate" TIMESTAMP(3),
    "forecastedInspectionDate" TIMESTAMP(3),
    "forecastedPtoDate" TIMESTAMP(3),
    "isSiteSurveyScheduled" BOOLEAN NOT NULL DEFAULT false,
    "isSiteSurveyCompleted" BOOLEAN NOT NULL DEFAULT false,
    "isDaSent" BOOLEAN NOT NULL DEFAULT false,
    "isLayoutApproved" BOOLEAN NOT NULL DEFAULT false,
    "isDesignDrafted" BOOLEAN NOT NULL DEFAULT false,
    "isDesignCompleted" BOOLEAN NOT NULL DEFAULT false,
    "isPermitSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "isPermitIssued" BOOLEAN NOT NULL DEFAULT false,
    "isIcSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "isIcApproved" BOOLEAN NOT NULL DEFAULT false,
    "isParticipateEnergy" BOOLEAN NOT NULL DEFAULT false,
    "isInspectionPassed" BOOLEAN NOT NULL DEFAULT false,
    "hasInspectionFailed" BOOLEAN NOT NULL DEFAULT false,
    "firstTimeInspectionPass" BOOLEAN NOT NULL DEFAULT false,
    "hasInspectionFailedNotRejected" BOOLEAN NOT NULL DEFAULT false,
    "firstTimeInspectionPassNotRejected" BOOLEAN NOT NULL DEFAULT false,
    "readyForInspection" TEXT,
    "finalInspectionStatus" TEXT,
    "inspectionFailCount" INTEGER,
    "inspectionFailureReason" TEXT,
    "installStatus" TEXT,
    "designStatus" TEXT,
    "surveyStatus" TEXT,
    "permittingStatus" TEXT,
    "layoutStatus" TEXT,
    "icStatus" TEXT,
    "ptoStatus" TEXT,
    "systemSizeKwdc" DECIMAL(65,30),
    "systemSizeKwac" DECIMAL(65,30),
    "moduleBrand" TEXT,
    "moduleModel" TEXT,
    "moduleCount" INTEGER,
    "moduleWattage" INTEGER,
    "moduleName" TEXT,
    "inverterBrand" TEXT,
    "inverterModel" TEXT,
    "inverterQty" INTEGER,
    "inverterSizeKwac" DECIMAL(65,30),
    "inverterName" TEXT,
    "batteryBrand" TEXT,
    "batteryModel" TEXT,
    "batteryCount" INTEGER,
    "batterySizeKwh" DECIMAL(65,30),
    "batteryName" TEXT,
    "batteryExpansionCount" INTEGER,
    "batteryExpansionName" TEXT,
    "batteryExpansionModel" TEXT,
    "evCount" INTEGER,
    "siteSurveyTurnaroundDays" DECIMAL(65,30),
    "designTurnaroundDays" DECIMAL(65,30),
    "permitTurnaroundDays" DECIMAL(65,30),
    "icTurnaroundDays" DECIMAL(65,30),
    "constructionTurnaroundDays" DECIMAL(65,30),
    "projectTurnaroundDays" DECIMAL(65,30),
    "inspectionTurnaroundDays" DECIMAL(65,30),
    "daReadyToSentDays" DECIMAL(65,30),
    "daSentToApprovedDays" DECIMAL(65,30),
    "timeToSubmitPermitDays" DECIMAL(65,30),
    "timeToSubmitIcDays" DECIMAL(65,30),
    "daToRtbDays" DECIMAL(65,30),
    "rtbToConstructionDays" DECIMAL(65,30),
    "ccToPtoDays" DECIMAL(65,30),
    "timeToCcDays" DECIMAL(65,30),
    "timeToDaDays" DECIMAL(65,30),
    "timeToPtoDays" DECIMAL(65,30),
    "timeToRtbDays" DECIMAL(65,30),
    "rtbToCcDays" DECIMAL(65,30),
    "daToCcDays" DECIMAL(65,30),
    "daToPermitDays" DECIMAL(65,30),
    "daRevisionCount" INTEGER,
    "asBuiltRevisionCount" INTEGER,
    "permitRevisionCount" INTEGER,
    "icRevisionCount" INTEGER,
    "totalRevisionCount" INTEGER,
    "designDocumentsUrl" TEXT,
    "designFolderUrl" TEXT,
    "allDocumentFolderUrl" TEXT,
    "driveUrl" TEXT,
    "openSolarUrl" TEXT,
    "openSolarId" TEXT,
    "zuperUid" TEXT,
    "hubspotUrl" TEXT,
    "expectedDaysForInstall" INTEGER,
    "daysForInstallers" INTEGER,
    "daysForElectricians" INTEGER,
    "installCrew" TEXT,
    "installDifficulty" INTEGER,
    "installNotes" TEXT,
    "expectedInstallerCount" INTEGER,
    "expectedElectricianCount" INTEGER,
    "n3ceEvStatus" TEXT,
    "n3ceBatteryStatus" TEXT,
    "sgipStatus" TEXT,
    "pbsrStatus" TEXT,
    "cpaStatus" TEXT,
    "participateEnergyStatus" TEXT,
    "projectNumber" TEXT,
    "projectType" TEXT,
    "tags" TEXT,
    "discoReco" TEXT,
    "interiorAccess" TEXT,
    "siteSurveyDocuments" TEXT,
    "systemPerformanceReview" TEXT,
    "dateEnteredCurrentStage" TIMESTAMP(3),
    "createDate" TIMESTAMP(3),
    "hubspotContactId" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "hubspotCompanyId" TEXT,
    "companyName" TEXT,
    "hubspotUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncSource" "DealSyncSource" NOT NULL,
    "rawProperties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealSyncLog" (
    "id" TEXT NOT NULL,
    "dealId" TEXT,
    "hubspotDealId" TEXT,
    "syncType" "DealSyncType" NOT NULL,
    "source" TEXT NOT NULL,
    "changesDetected" JSONB,
    "dealCount" INTEGER,
    "status" "DealSyncStatus" NOT NULL,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealPipelineConfig" (
    "id" TEXT NOT NULL,
    "pipeline" "DealPipeline" NOT NULL,
    "hubspotPipelineId" TEXT NOT NULL,
    "stages" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealPipelineConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deal_hubspotDealId_key" ON "Deal"("hubspotDealId");

-- CreateIndex
CREATE INDEX "Deal_pipeline_stage_idx" ON "Deal"("pipeline", "stage");

-- CreateIndex
CREATE INDEX "Deal_pbLocation_idx" ON "Deal"("pbLocation");

-- CreateIndex
CREATE INDEX "Deal_lastSyncedAt_idx" ON "Deal"("lastSyncedAt");

-- CreateIndex
CREATE INDEX "Deal_hubspotOwnerId_idx" ON "Deal"("hubspotOwnerId");

-- CreateIndex
CREATE INDEX "DealSyncLog_dealId_createdAt_idx" ON "DealSyncLog"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "DealSyncLog_syncType_createdAt_idx" ON "DealSyncLog"("syncType", "createdAt");

-- CreateIndex
CREATE INDEX "DealSyncLog_status_createdAt_idx" ON "DealSyncLog"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DealPipelineConfig_pipeline_key" ON "DealPipelineConfig"("pipeline");

-- AddForeignKey
ALTER TABLE "DealSyncLog" ADD CONSTRAINT "DealSyncLog_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
