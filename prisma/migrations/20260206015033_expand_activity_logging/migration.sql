-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'LOGIN_FAILED';
ALTER TYPE "ActivityType" ADD VALUE 'SESSION_EXPIRED';
ALTER TYPE "ActivityType" ADD VALUE 'SURVEY_COMPLETED';
ALTER TYPE "ActivityType" ADD VALUE 'INSTALL_COMPLETED';
ALTER TYPE "ActivityType" ADD VALUE 'INSPECTION_SCHEDULED';
ALTER TYPE "ActivityType" ADD VALUE 'INSPECTION_RESCHEDULED';
ALTER TYPE "ActivityType" ADD VALUE 'INSPECTION_CANCELLED';
ALTER TYPE "ActivityType" ADD VALUE 'INSPECTION_PASSED';
ALTER TYPE "ActivityType" ADD VALUE 'INSPECTION_FAILED';
ALTER TYPE "ActivityType" ADD VALUE 'ZUPER_JOB_ASSIGNED';
ALTER TYPE "ActivityType" ADD VALUE 'ZUPER_ASSIGNMENT_FAILED';
ALTER TYPE "ActivityType" ADD VALUE 'ZUPER_SYNC_ERROR';
ALTER TYPE "ActivityType" ADD VALUE 'HUBSPOT_DEAL_VIEWED';
ALTER TYPE "ActivityType" ADD VALUE 'HUBSPOT_DEAL_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE 'HUBSPOT_SYNC_ERROR';
ALTER TYPE "ActivityType" ADD VALUE 'DASHBOARD_FILTERED';
ALTER TYPE "ActivityType" ADD VALUE 'PROJECT_VIEWED';
ALTER TYPE "ActivityType" ADD VALUE 'PROJECT_SEARCHED';
ALTER TYPE "ActivityType" ADD VALUE 'DATA_EXPORTED';
ALTER TYPE "ActivityType" ADD VALUE 'CSV_DOWNLOADED';
ALTER TYPE "ActivityType" ADD VALUE 'USER_PERMISSIONS_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE 'USER_INVITED';
ALTER TYPE "ActivityType" ADD VALUE 'API_ERROR';
ALTER TYPE "ActivityType" ADD VALUE 'FEATURE_USED';

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "pbLocation" TEXT,
ADD COLUMN     "requestMethod" TEXT,
ADD COLUMN     "requestPath" TEXT,
ADD COLUMN     "responseStatus" INTEGER,
ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "userName" TEXT;

-- CreateIndex
CREATE INDEX "ActivityLog_userEmail_idx" ON "ActivityLog"("userEmail");

-- CreateIndex
CREATE INDEX "ActivityLog_pbLocation_idx" ON "ActivityLog"("pbLocation");

-- CreateIndex
CREATE INDEX "ActivityLog_sessionId_idx" ON "ActivityLog"("sessionId");
