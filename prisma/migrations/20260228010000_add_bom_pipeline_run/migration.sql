-- CreateEnum
CREATE TYPE "BomPipelineTrigger" AS ENUM ('WEBHOOK_DESIGN_COMPLETE', 'MANUAL', 'CRON');

-- CreateEnum
CREATE TYPE "BomPipelineStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "BomPipelineStep" AS ENUM ('FETCH_DEAL', 'LIST_PDFS', 'EXTRACT_BOM', 'SAVE_SNAPSHOT', 'RESOLVE_CUSTOMER', 'CREATE_SO', 'NOTIFY');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'BOM_PIPELINE_STARTED';
ALTER TYPE "ActivityType" ADD VALUE 'BOM_PIPELINE_COMPLETED';
ALTER TYPE "ActivityType" ADD VALUE 'BOM_PIPELINE_FAILED';

-- CreateTable
CREATE TABLE "BomPipelineRun" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "dealName" TEXT NOT NULL DEFAULT '',
    "trigger" "BomPipelineTrigger" NOT NULL,
    "status" "BomPipelineStatus" NOT NULL,
    "failedStep" "BomPipelineStep",
    "errorMessage" TEXT,
    "selectedPlanset" TEXT,
    "snapshotId" TEXT,
    "snapshotVersion" INTEGER,
    "zohoSoId" TEXT,
    "zohoSoNumber" TEXT,
    "zohoCustomerId" TEXT,
    "unmatchedCount" INTEGER,
    "durationMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BomPipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BomPipelineRun_dealId_idx" ON "BomPipelineRun"("dealId");

-- CreateIndex
CREATE INDEX "BomPipelineRun_status_idx" ON "BomPipelineRun"("status");

-- CreateIndex
CREATE INDEX "BomPipelineRun_createdAt_idx" ON "BomPipelineRun"("createdAt");

-- Partial unique index: at most one RUNNING row per dealId at a time.
-- This enforces the dedupe lock for concurrent webhook deliveries.
-- Allows unlimited SUCCEEDED/FAILED/PARTIAL rows per deal for reruns.
CREATE UNIQUE INDEX "BomPipelineRun_dealId_running_unique"
  ON "BomPipelineRun" ("dealId")
  WHERE status = 'RUNNING';
