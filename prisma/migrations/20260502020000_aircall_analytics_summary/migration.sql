-- CreateTable
CREATE TABLE "AircallAnalyticsSummary" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'aircall',
    "source" TEXT NOT NULL DEFAULT 'analytics_plus_csv',
    "userAircallId" TEXT NOT NULL,
    "userName" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "ringTotal" INTEGER NOT NULL DEFAULT 0,
    "ringPickedUp" INTEGER NOT NULL DEFAULT 0,
    "ringNotPickedUp" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedBy" TEXT,
    "metadata" JSONB,

    CONSTRAINT "AircallAnalyticsSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AircallAnalyticsSummary_source_userAircallId_periodStart_pe_key" ON "AircallAnalyticsSummary"("source", "userAircallId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "AircallAnalyticsSummary_periodStart_periodEnd_idx" ON "AircallAnalyticsSummary"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "AircallAnalyticsSummary_userAircallId_periodEnd_idx" ON "AircallAnalyticsSummary"("userAircallId", "periodEnd");

-- CreateIndex
CREATE INDEX "AircallAnalyticsSummary_provider_periodEnd_idx" ON "AircallAnalyticsSummary"("provider", "periodEnd");
