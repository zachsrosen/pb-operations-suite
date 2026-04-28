-- CreateTable
CREATE TABLE "PMSnapshot" (
    "id" TEXT NOT NULL,
    "pmName" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "ghostRate" DOUBLE PRECISION NOT NULL,
    "medianDaysSinceLastTouch" DOUBLE PRECISION NOT NULL,
    "touchFrequency30d" DOUBLE PRECISION NOT NULL,
    "readinessScore" DOUBLE PRECISION NOT NULL,
    "dayOfFailures90d" INTEGER NOT NULL,
    "fieldPopulationScore" DOUBLE PRECISION NOT NULL,
    "staleDataCount" INTEGER NOT NULL,
    "stuckCountNow" INTEGER NOT NULL,
    "medianTimeToUnstick90d" DOUBLE PRECISION,
    "recoveryRate90d" DOUBLE PRECISION,
    "reviewRate" DOUBLE PRECISION NOT NULL,
    "avgReviewScore" DOUBLE PRECISION NOT NULL,
    "complaintRatePer100" DOUBLE PRECISION NOT NULL,
    "portfolioCount" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "savesHigh" INTEGER,
    "savesMedium" INTEGER,
    "savesLow" INTEGER,
    "daysSavedEstimate" DOUBLE PRECISION,

    CONSTRAINT "PMSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PMSnapshot_pmName_periodStart_periodEnd_key" ON "PMSnapshot"("pmName", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "PMSnapshot_pmName_periodEnd_idx" ON "PMSnapshot"("pmName", "periodEnd");
