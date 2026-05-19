/**
 * Singleton lock for the PowerhubCrosslinkBackfillRun pipeline.
 *
 * Clone of property-backfill-lock.ts adapted for the new Prisma model.
 *
 * Defense-in-depth:
 *   1. Postgres partial unique index on PowerhubCrosslinkBackfillRun
 *      guarantees at most one row with status='running'. A second INSERT
 *      fails with P2002.
 *   2. This module turns that DB error into either an "in-progress" reply
 *      or a stale-lock takeover — based on HEARTBEAT age, never startedAt,
 *      so a healthy multi-hour run is not at risk of being stolen.
 *
 * Usage (see scripts/backfill-powerhub-crosslinks.ts):
 *   const lock = await acquireBackfillLock();
 *   if ("reason" in lock) { return; }
 *   const heartbeat = setInterval(() => heartbeatBackfillLock(lock.runId), HEARTBEAT_MS);
 *   try { ...work... await releaseBackfillLock(lock.runId, "completed"); }
 *   finally { clearInterval(heartbeat); }
 */
import { prisma } from "@/lib/db";

// Heartbeat cadence: the running process updates heartbeatAt every HEARTBEAT_MS.
// A lock is considered stale only after STALE_LOCK_MS without a heartbeat —
// i.e. the process has almost certainly crashed or been killed.
export const HEARTBEAT_MS = 30_000;
export const STALE_LOCK_MS = 5 * 60 * 1000;

export interface AcquiredLock {
  runId: string;
  cursor: string | null;
  heartbeatAt: Date;
}

export type AcquireResult = AcquiredLock | { reason: "in_progress"; existingRunId: string };

export async function acquireBackfillLock(): Promise<AcquireResult> {
  try {
    const created = await prisma.powerhubCrosslinkBackfillRun.create({
      data: { status: "running" },
    });
    return { runId: created.id, cursor: created.cursor, heartbeatAt: created.heartbeatAt };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "P2002") throw err;

    const existing = await prisma.powerhubCrosslinkBackfillRun.findFirst({
      where: { status: "running" },
    });
    if (!existing) {
      // Index says someone is running, but findFirst disagrees — race; retry.
      return acquireBackfillLock();
    }
    const age = Date.now() - existing.heartbeatAt.getTime();
    if (age < STALE_LOCK_MS) {
      return { reason: "in_progress", existingRunId: existing.id };
    }
    // Stale-lock takeover via optimistic CAS on heartbeatAt.
    const taken = await prisma.powerhubCrosslinkBackfillRun.updateMany({
      where: { id: existing.id, heartbeatAt: existing.heartbeatAt },
      data: { heartbeatAt: new Date(), startedAt: new Date() },
    });
    if (taken.count === 0) {
      // Someone else's heartbeat raced us — retry the acquire.
      return acquireBackfillLock();
    }
    return { runId: existing.id, cursor: existing.cursor, heartbeatAt: new Date() };
  }
}

/**
 * The running process MUST call this on an interval (see HEARTBEAT_MS) for
 * as long as it holds the lock. Missing heartbeats are what allow a dead
 * process's lock to be stolen.
 */
export async function heartbeatBackfillLock(runId: string): Promise<void> {
  await prisma.powerhubCrosslinkBackfillRun.update({
    where: { id: runId },
    data: { heartbeatAt: new Date() },
  });
}

export async function releaseBackfillLock(
  runId: string,
  outcome: "completed" | "failed" | "paused",
  error?: string,
): Promise<void> {
  await prisma.powerhubCrosslinkBackfillRun.update({
    where: { id: runId },
    data: {
      status: outcome,
      completedAt: outcome === "paused" ? null : new Date(),
      errorMessage: error ?? null,
    },
  });
}

export async function updateBackfillCursor(
  runId: string,
  cursor: string,
  processedCount: number,
  failedCount: number,
): Promise<void> {
  await prisma.powerhubCrosslinkBackfillRun.update({
    where: { id: runId },
    data: { cursor, processedCount, failedCount, heartbeatAt: new Date() },
  });
}
