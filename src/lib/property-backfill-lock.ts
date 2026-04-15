// src/lib/property-backfill-lock.ts
//
// Singleton lock for the PropertyBackfillRun pipeline.
//
// Defense-in-depth:
//   1. Postgres partial unique index `property_backfill_run_single_running`
//      (see the 20260414000000_add_property_objects migration) guarantees at
//      most one row with status='running'. A second INSERT fails with P2002.
//   2. This module turns that DB error into either an "already-running" reply
//      or a stale-lock takeover — based on HEARTBEAT age, never startedAt, so
//      a healthy multi-hour run is not at risk of being stolen.
//
// Usage (see Task 4.2 for the backfill script wiring):
//   const lock = await acquireBackfillLock();
//   if ("reason" in lock) { /* another run is in progress */ return; }
//   const heartbeat = setInterval(() => heartbeatBackfillLock(lock.runId), HEARTBEAT_MS);
//   try { ...work... await releaseBackfillLock(lock.runId, "completed"); }
//   finally { clearInterval(heartbeat); }

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

// Heartbeat cadence: the running process updates heartbeatAt every HEARTBEAT_MS.
// A lock is considered stale only after STALE_LOCK_MS without a heartbeat —
// i.e. the process has almost certainly crashed or been killed. This does NOT
// depend on startedAt, so a healthy multi-hour run is never at risk.
export const HEARTBEAT_MS = 30_000;
export const STALE_LOCK_MS = 5 * 60 * 1000;

export interface AcquiredLock {
  runId: string;
  resumeFrom: { phase: string; cursor: string | null } | null;
}

export type AcquireResult =
  | AcquiredLock
  | { reason: "already-running"; runningRunId: string; heartbeatAt: Date };

export async function acquireBackfillLock(): Promise<AcquireResult> {
  try {
    const run = await prisma.propertyBackfillRun.create({
      data: { status: "running", phase: "contacts", heartbeatAt: new Date() },
    });
    return { runId: run.id, resumeFrom: null };
  } catch (err) {
    if (
      !(err instanceof Prisma.PrismaClientKnownRequestError) ||
      err.code !== "P2002"
    ) {
      throw err;
    }
    // P2002 = unique constraint violation on the partial index → another
    // run is in progress (or was, if the holder crashed).
    const running = await prisma.propertyBackfillRun.findFirst({
      where: { status: "running" },
    });
    if (!running) {
      throw new Error(
        "Lock violation with no running row — index corrupt?",
      );
    }

    // Stale-lock takeover — based on heartbeat age, NOT startedAt.
    const heartbeatAgeMs = Date.now() - running.heartbeatAt.getTime();
    if (heartbeatAgeMs > STALE_LOCK_MS) {
      // Optimistic CAS: only flip if the heartbeat hasn't advanced between
      // our read and our write. If another process just heartbeated, count
      // will be 0 and we fall through to "already-running".
      const stolen = await prisma.propertyBackfillRun.updateMany({
        where: {
          id: running.id,
          status: "running",
          heartbeatAt: running.heartbeatAt,
        },
        data: {
          status: "failed",
          lastError: `stolen by stale-lock takeover (no heartbeat for ${Math.round(
            heartbeatAgeMs / 1000,
          )}s)`,
        },
      });
      if (stolen.count === 1) {
        // The old row is flipped; retry the acquire so Postgres issues a
        // fresh INSERT against the now-available partial index slot.
        return acquireBackfillLock();
      }
      // Someone else's heartbeat raced us — the lock is actually live.
      // Fall through and report already-running.
    }

    return {
      reason: "already-running",
      runningRunId: running.id,
      heartbeatAt: running.heartbeatAt,
    };
  }
}

/**
 * The running process MUST call this on an interval (see HEARTBEAT_MS) for
 * as long as it holds the lock. Missing heartbeats are what allow a dead
 * process's lock to be stolen. Use `setInterval` in the backfill script's
 * main() and `clearInterval` in the finally block.
 */
export async function heartbeatBackfillLock(runId: string): Promise<void> {
  await prisma.propertyBackfillRun.update({
    where: { id: runId },
    data: { heartbeatAt: new Date() },
  });
}

export async function releaseBackfillLock(
  runId: string,
  outcome: "completed" | "failed" | "paused",
  error?: string,
): Promise<void> {
  await prisma.propertyBackfillRun.update({
    where: { id: runId },
    data: {
      status: outcome,
      completedAt: new Date(),
      lastError: error ?? null,
    },
  });
}

/**
 * Manual CLI recovery: finds the most-recent row still marked running
 * (implying the prior process crashed without releasing), and returns its
 * phase+cursor so the operator can resume. Returns null if nothing is running.
 */
export async function resumeInterruptedRun(): Promise<AcquiredLock | null> {
  const run = await prisma.propertyBackfillRun.findFirst({
    where: { status: "running" },
    orderBy: { startedAt: "desc" },
  });
  if (!run) return null;
  return {
    runId: run.id,
    resumeFrom: { phase: run.phase, cursor: run.cursor },
  };
}
