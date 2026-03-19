-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'REVENUE_GOAL_UPDATED';

-- CreateTable
CREATE TABLE "RevenueGoal" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "groupKey" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "target" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "RevenueGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RevenueGoal_year_groupKey_month_key" ON "RevenueGoal"("year", "groupKey", "month");

-- CreateIndex
CREATE INDEX "RevenueGoal_year_idx" ON "RevenueGoal"("year");
