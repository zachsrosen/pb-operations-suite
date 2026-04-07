-- CreateTable
CREATE TABLE "OfficeGoal" (
    "id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfficeGoal_location_metric_month_year_key" ON "OfficeGoal"("location", "metric", "month", "year");

-- CreateIndex
CREATE INDEX "OfficeGoal_location_year_idx" ON "OfficeGoal"("location", "year");
