/**
 * BOM Pipeline Lock — Shared dedupe logic
 *
 * Provides transactional pipeline lock acquisition with stale-lock recovery.
 * Used by both the design-complete webhook and the install-scheduled fallback
 * in the confirm route to ensure at most one concurrent pipeline run per deal.
 *
 * A partial unique index on BomPipelineRun(dealId) WHERE status='RUNNING'
 * enforces the constraint at the database level.
 */

import { prisma } from "@/lib/db";
import type { BomPipelineTrigger } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stale lock threshold: 10 minutes (pipeline maxDuration is 300s). */
const STALE_LOCK_THRESHOLD_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DuplicateRunError extends Error {
  constructor(dealId: string) {
    super(`Pipeline already running for deal ${dealId}`);
    this.name = "DuplicateRunError";
  }
}

// ---------------------------------------------------------------------------
// Lock acquisition
// ---------------------------------------------------------------------------

/**
 * Acquire a pipeline lock for a deal.
 *
 * 1. Check for stale RUNNING rows (>10 min old) and flip them to FAILED.
 * 2. Insert a new RUNNING row — if the partial unique index rejects it,
 *    another run is genuinely in-flight → throw DuplicateRunError.
 *
 * Uses a transaction to make stale recovery + insert atomic.
 *
 * @param dealId   - HubSpot deal ID
 * @param trigger  - Which trigger initiated this pipeline run
 * @param dealName - Optional deal name for the run record
 * @returns The new BomPipelineRun ID
 */
export async function acquirePipelineLock(
  dealId: string,
  trigger: BomPipelineTrigger,
  dealName?: string,
): Promise<string> {
  if (!prisma) throw new Error("Database not configured");

  return prisma.$transaction(async (tx) => {
    // 1. Recover stale locks
    const staleThreshold = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS);
    await tx.bomPipelineRun.updateMany({
      where: {
        dealId,
        status: "RUNNING",
        createdAt: { lt: staleThreshold },
      },
      data: {
        status: "FAILED",
        errorMessage: "Timed out (stale lock recovery)",
      },
    });

    // 2. Insert new RUNNING row
    try {
      const run = await tx.bomPipelineRun.create({
        data: {
          dealId,
          dealName: dealName ?? "",
          trigger,
          status: "RUNNING",
        },
      });
      return run.id;
    } catch (e: unknown) {
      // Prisma unique constraint violation → P2002
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "P2002"
      ) {
        throw new DuplicateRunError(dealId);
      }
      throw e;
    }
  });
}
