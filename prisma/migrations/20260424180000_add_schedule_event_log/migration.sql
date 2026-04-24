-- ScheduleEventLog — append-only history of Zuper job schedule + crew changes.
-- Closes the gap where Zuper's API only exposes current scheduled_end; this
-- table captures every observed change so we can recover "original commitment"
-- for compliance scoring (see PR discussion 2026-04-24).
-- Safe additive migration: new table + indexes only.

-- CreateTable
CREATE TABLE "ScheduleEventLog" (
    "id" TEXT NOT NULL,
    "zuperJobUid" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "crewUserUids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "crewTeamUid" TEXT,
    "source" TEXT NOT NULL,
    "previousScheduledStart" TIMESTAMP(3),
    "previousScheduledEnd" TIMESTAMP(3),
    "previousCrewUserUids" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ScheduleEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleEventLog_zuperJobUid_idx" ON "ScheduleEventLog"("zuperJobUid");

-- CreateIndex
CREATE INDEX "ScheduleEventLog_observedAt_idx" ON "ScheduleEventLog"("observedAt");
