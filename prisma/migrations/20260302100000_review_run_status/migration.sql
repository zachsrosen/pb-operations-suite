-- Add ReviewRunStatus enum and status/error/updatedAt fields to ProjectReview.
--
-- Default COMPLETED ensures existing rows auto-populate correctly
-- (all existing rows are completed reviews).
--
-- The partial unique index enforces at most one RUNNING review per
-- deal+skill combination at the database level. This is Postgres-specific
-- (WHERE clause in index). If running against SQLite (e.g. test env),
-- skip this index — the application-level DuplicateReviewError check
-- in review-lock.ts provides the same guarantee.

-- CreateEnum
CREATE TYPE "ReviewRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "ProjectReview" ADD COLUMN "status" "ReviewRunStatus" NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE "ProjectReview" ADD COLUMN "error" TEXT;
ALTER TABLE "ProjectReview" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill updatedAt from createdAt for existing rows
UPDATE "ProjectReview" SET "updatedAt" = "createdAt";

-- Partial unique index: at most one RUNNING review per deal+skill
CREATE UNIQUE INDEX "ProjectReview_dealId_skill_running"
  ON "ProjectReview" ("dealId", "skill")
  WHERE status = 'RUNNING';
