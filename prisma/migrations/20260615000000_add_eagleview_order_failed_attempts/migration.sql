-- AlterTable: track failed deliverable-fetch attempts so stuck EagleView orders are diagnosable.
ALTER TABLE "EagleViewOrder" ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;
