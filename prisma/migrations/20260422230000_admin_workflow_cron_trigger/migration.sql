-- Admin Workflow Builder: add CRON to AdminWorkflowTriggerType enum.
-- Additive — safe to deploy before code references it.

ALTER TYPE "AdminWorkflowTriggerType" ADD VALUE 'CRON';
