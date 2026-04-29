-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'ON_CALL_CALL_LOGGED';
ALTER TYPE "ActivityType" ADD VALUE 'ON_CALL_CALL_LOG_UPDATED';

-- CreateTable
CREATE TABLE "OnCallCallLog" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "reporterCrewMemberId" TEXT NOT NULL,
    "callReceivedAt" TIMESTAMP(3) NOT NULL,
    "customerName" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "safetyRisk" BOOLEAN NOT NULL DEFAULT false,
    "homeHasPower" BOOLEAN,
    "troubleshootingAttempted" TEXT,
    "resolvedRemotely" BOOLEAN NOT NULL DEFAULT false,
    "dispatched" BOOLEAN NOT NULL DEFAULT false,
    "arrivalAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "hoursWorked" DECIMAL(5,2),
    "escalatedTo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnCallCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnCallCallLog_poolId_callReceivedAt_idx" ON "OnCallCallLog"("poolId", "callReceivedAt");

-- CreateIndex
CREATE INDEX "OnCallCallLog_reporterCrewMemberId_idx" ON "OnCallCallLog"("reporterCrewMemberId");

-- AddForeignKey
ALTER TABLE "OnCallCallLog" ADD CONSTRAINT "OnCallCallLog_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "OnCallPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallCallLog" ADD CONSTRAINT "OnCallCallLog_reporterCrewMemberId_fkey" FOREIGN KEY ("reporterCrewMemberId") REFERENCES "CrewMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
