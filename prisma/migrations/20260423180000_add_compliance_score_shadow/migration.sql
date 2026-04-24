-- ComplianceScoreShadow — holds paired v1/v2 compliance scores for side-by-side compare.
-- Additive migration: new table + indexes only. Safe to apply before or after code change.
-- Spec: docs/superpowers/plans/2026-04-23-compliance-score-fairness.md §1.2

-- CreateTable
CREATE TABLE "ComplianceScoreShadow" (
    "id" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userUid" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "v1Score" DOUBLE PRECISION NOT NULL,
    "v1Grade" TEXT NOT NULL,
    "v2Score" DOUBLE PRECISION NOT NULL,
    "v2Grade" TEXT NOT NULL,
    "v1TotalJobs" INTEGER NOT NULL,
    "v2TasksFractional" DOUBLE PRECISION NOT NULL,
    "v2DistinctParentJobs" INTEGER NOT NULL,
    "emptyCreditSetJobs" INTEGER NOT NULL,

    CONSTRAINT "ComplianceScoreShadow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceScoreShadow_computedAt_idx" ON "ComplianceScoreShadow"("computedAt");

-- CreateIndex
CREATE INDEX "ComplianceScoreShadow_userUid_idx" ON "ComplianceScoreShadow"("userUid");

-- CreateIndex
CREATE INDEX "ComplianceScoreShadow_location_idx" ON "ComplianceScoreShadow"("location");
