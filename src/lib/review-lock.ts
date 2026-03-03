/**
 * Review Lock — Shared dedupe logic for design review runs
 *
 * Provides transactional review lock acquisition with stale-lock recovery.
 * Prevents duplicate concurrent review runs per deal+skill combination.
 *
 * A partial unique index on ProjectReview(dealId, skill) WHERE status='RUNNING'
 * enforces the constraint at the database level. The application layer provides
 * stale recovery + friendly error handling.
 *
 * Pattern mirrors bom-pipeline-lock.ts.
 */

import { prisma } from "@/lib/db";
import type { Finding } from "@/lib/checks/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stale lock threshold: 3 minutes. Heartbeat via touchReviewRun() prevents
 *  active runs from being killed prematurely. Matches client-side poll timeout. */
const STALE_LOCK_THRESHOLD_MS = 3 * 60 * 1000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DuplicateReviewError extends Error {
  public readonly existingReviewId: string | undefined;

  constructor(dealId: string, skill: string, existingReviewId?: string) {
    super(`Review already running for deal ${dealId} (skill: ${skill})`);
    this.name = "DuplicateReviewError";
    this.existingReviewId = existingReviewId;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPrismaUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: string }).code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// Lock acquisition
// ---------------------------------------------------------------------------

/**
 * Acquire a review lock for a deal+skill combination.
 *
 * 1. Stale recovery: mark RUNNING rows with no heartbeat for >5 min as FAILED.
 *    Uses updatedAt — kept fresh by touchReviewRun() calls at major milestones.
 * 2. Insert a minimal RUNNING placeholder row — if the partial unique index
 *    rejects it, another run is genuinely in-flight → throw DuplicateReviewError.
 *
 * Uses $transaction() to make stale recovery + insert atomic.
 *
 * @returns The new ProjectReview ID
 */
export async function acquireReviewLock(
  dealId: string,
  skill: string,
  trigger: string,
  triggeredBy?: string,
): Promise<string> {
  if (!prisma) throw new Error("Database not configured");

  return prisma.$transaction(async (tx) => {
    // 1. Recover stale locks
    const staleThreshold = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS);
    await tx.projectReview.updateMany({
      where: {
        dealId,
        skill,
        status: "RUNNING",
        updatedAt: { lt: staleThreshold },
      },
      data: {
        status: "FAILED",
        error: "Timed out (stale lock recovery)",
      },
    });

    // 2. Insert minimal RUNNING placeholder row
    //    All numeric/boolean fields get safe defaults; updated on completion.
    try {
      const row = await tx.projectReview.create({
        data: {
          dealId,
          skill,
          status: "RUNNING",
          trigger,
          triggeredBy: triggeredBy ?? "system",
          findings: [],       // empty array — populated on completion
          errorCount: 0,      // updated on completion
          warningCount: 0,    // updated on completion
          passed: false,      // updated on completion
          durationMs: null,   // updated on completion
        },
      });
      return row.id;
    } catch (e) {
      if (isPrismaUniqueViolation(e)) {
        // Find the existing RUNNING row to return its ID
        const existing = await tx.projectReview.findFirst({
          where: { dealId, skill, status: "RUNNING" },
          select: { id: true },
        });
        throw new DuplicateReviewError(dealId, skill, existing?.id);
      }
      throw e;
    }
  });
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

/**
 * Bump updatedAt on a RUNNING review to prevent stale-kill.
 *
 * Call at major milestones:
 *   (1) after HubSpot properties fetch
 *   (2) after Drive PDF download
 *   (3) after Anthropic Files upload
 *   (4) after Claude model call start
 *
 * Writing `status: "RUNNING"` forces a real DB write — Prisma's @updatedAt
 * only bumps on actual field changes.
 */
export async function touchReviewRun(reviewId: string): Promise<void> {
  if (!prisma) return;
  // Use updateMany with status guard to avoid resurrecting terminal runs.
  // If the row is already COMPLETED/FAILED, this is a no-op (count === 0).
  await prisma.projectReview.updateMany({
    where: { id: reviewId, status: "RUNNING" },
    data: { status: "RUNNING" },
  });
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/**
 * Mark a review run as COMPLETED with findings.
 */
export async function completeReviewRun(
  reviewId: string,
  result: {
    findings: Finding[];
    errorCount: number;
    warningCount: number;
    passed: boolean;
    durationMs: number;
    projectId?: string | null;
  },
): Promise<void> {
  if (!prisma) return;
  await prisma.projectReview.update({
    where: { id: reviewId },
    data: {
      status: "COMPLETED",
      findings: JSON.parse(JSON.stringify(result.findings)),
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      passed: result.passed,
      durationMs: result.durationMs,
      ...(result.projectId !== undefined ? { projectId: result.projectId } : {}),
    },
  });
}

/**
 * Mark a review run as FAILED.
 *
 * Failure contract:
 * - `error` column stores the failure reason (queryable for metrics)
 * - `findings` stays as the empty array from lock insertion — no fake findings
 */
export async function failReviewRun(
  reviewId: string,
  errorMessage: string,
): Promise<void> {
  if (!prisma) return;
  await prisma.projectReview.update({
    where: { id: reviewId },
    data: {
      status: "FAILED",
      error: errorMessage,
    },
  });
}
