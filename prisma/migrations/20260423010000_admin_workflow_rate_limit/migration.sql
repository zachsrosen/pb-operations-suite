-- Admin Workflow Builder: per-workflow rate limiting.
-- Additive migration. 0 = unlimited. Default 60 runs/hour (= 1/min average).

ALTER TABLE "AdminWorkflow"
  ADD COLUMN "maxRunsPerHour" INTEGER NOT NULL DEFAULT 60;
