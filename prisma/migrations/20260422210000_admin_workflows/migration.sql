-- Admin Workflows (Phase 1)
-- Additive migration: new enums, new tables, new relation.
-- Safe to apply before or after the code that references it.
-- Spec: docs/superpowers/specs/2026-04-22-admin-workflow-builder.md

-- CreateEnum
CREATE TYPE "AdminWorkflowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AdminWorkflowTriggerType" AS ENUM ('MANUAL', 'HUBSPOT_PROPERTY_CHANGE', 'ZUPER_PROPERTY_CHANGE');

-- CreateEnum
CREATE TYPE "AdminWorkflowRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "AdminWorkflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AdminWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerType" "AdminWorkflowTriggerType" NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "definition" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminWorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "status" "AdminWorkflowRunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggeredByEmail" TEXT NOT NULL,
    "triggerContext" JSONB NOT NULL,
    "result" JSONB,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AdminWorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminWorkflow_status_idx" ON "AdminWorkflow"("status");

-- CreateIndex
CREATE INDEX "AdminWorkflow_triggerType_idx" ON "AdminWorkflow"("triggerType");

-- CreateIndex
CREATE INDEX "AdminWorkflow_createdById_idx" ON "AdminWorkflow"("createdById");

-- CreateIndex
CREATE INDEX "AdminWorkflowRun_workflowId_startedAt_idx" ON "AdminWorkflowRun"("workflowId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "AdminWorkflowRun_status_idx" ON "AdminWorkflowRun"("status");

-- AddForeignKey
ALTER TABLE "AdminWorkflow" ADD CONSTRAINT "AdminWorkflow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminWorkflowRun" ADD CONSTRAINT "AdminWorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AdminWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
