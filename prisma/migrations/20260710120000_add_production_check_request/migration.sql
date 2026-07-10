-- Production-guarantee fix verification workflow (additive)
-- See docs/superpowers/specs/2026-07-10-production-check-guarantee-design.md

CREATE TYPE "ProductionCheckStatus" AS ENUM ('DESIGN_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED');

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PRODUCTION_CHECK';

CREATE TABLE "ProductionCheckRequest" (
  "id"                  TEXT NOT NULL,
  "hubspotDealId"       TEXT NOT NULL,
  "dealName"            TEXT,
  "zuperJobUid"         TEXT,
  "hubspotTicketId"     TEXT,
  "status"              "ProductionCheckStatus" NOT NULL DEFAULT 'DESIGN_REVIEW',
  "issueSummary"        TEXT NOT NULL,
  "proposedSolution"    TEXT,
  "designerEmail"       TEXT,
  "solutionSubmittedAt" TIMESTAMP(3),
  "decidedByEmail"      TEXT,
  "decidedAt"           TIMESTAMP(3),
  "rejectionReason"     TEXT,
  "designCycles"        INTEGER NOT NULL DEFAULT 1,
  "estimatedCostCents"  INTEGER,
  "costBreakdown"       JSONB,
  "designTaskId"        TEXT,
  "approvalTaskId"      TEXT,
  "sendPlansTaskId"     TEXT,
  "createdByEmail"      TEXT NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionCheckRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductionCheckRequest_status_idx" ON "ProductionCheckRequest"("status");
CREATE INDEX "ProductionCheckRequest_hubspotDealId_idx" ON "ProductionCheckRequest"("hubspotDealId");
