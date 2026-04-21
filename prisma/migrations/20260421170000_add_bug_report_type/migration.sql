-- CreateEnum
CREATE TYPE "BugReportType" AS ENUM ('BUG', 'FEATURE_REQUEST');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'FEATURE_REQUESTED';

-- AlterTable
ALTER TABLE "BugReport" ADD COLUMN "type" "BugReportType" NOT NULL DEFAULT 'BUG';

-- CreateIndex
CREATE INDEX "BugReport_type_idx" ON "BugReport"("type");
