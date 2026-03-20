-- CreateTable
CREATE TABLE "AvailabilityChangeRequest" (
    "id" TEXT NOT NULL,
    "crewMemberId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "startTime" TEXT,
    "endTime" TEXT,
    "location" TEXT,
    "jobType" TEXT,
    "overrideDate" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "originalSlotId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AvailabilityChangeRequest_crewMemberId_idx" ON "AvailabilityChangeRequest"("crewMemberId");

-- CreateIndex
CREATE INDEX "AvailabilityChangeRequest_status_idx" ON "AvailabilityChangeRequest"("status");

-- AddForeignKey
ALTER TABLE "AvailabilityChangeRequest" ADD CONSTRAINT "AvailabilityChangeRequest_crewMemberId_fkey" FOREIGN KEY ("crewMemberId") REFERENCES "CrewMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
