-- Admin Workflow Builder: versioning table for edit history + rollback.
-- Additive. Safe.

CREATE TABLE "AdminWorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "savedByEmail" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminWorkflowVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminWorkflowVersion_workflowId_version_key"
  ON "AdminWorkflowVersion"("workflowId", "version");

CREATE INDEX "AdminWorkflowVersion_workflowId_createdAt_idx"
  ON "AdminWorkflowVersion"("workflowId", "createdAt" DESC);

ALTER TABLE "AdminWorkflowVersion"
  ADD CONSTRAINT "AdminWorkflowVersion_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "AdminWorkflow"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
