/**
 * Action-level idempotency helper.
 *
 * Wraps a create-style action in a DB-backed idempotency check. The
 * sequence is:
 *  1. Look up IdempotencyKey row for (scope, key=${runId}:${stepId})
 *  2. If found with status=completed, return the cached output — SKIP
 *     the external call entirely
 *  3. Otherwise, execute the create function, store output in
 *     IdempotencyKey with status=completed
 *
 * Covers the cross-invocation retry case (function re-invoked for the
 * same run, after external call already succeeded in a prior attempt).
 *
 * Does NOT cover the "external call succeeded, our DB write failed"
 * window — the true idempotency-guarantee gap requires action-specific
 * external searches. For create-hubspot-note / create-hubspot-task,
 * that gap is narrow enough we accept it. If it bites, follow-up is
 * search-before-create on external system.
 *
 * TTL: 24h (same as IdempotencyKey default). After that, the row is
 * pruned by existing cleanup processes and a retry would re-create.
 * Workflow runs should complete well under 24h so this is fine.
 */

import { prisma } from "@/lib/db";

const TTL_MS = 24 * 60 * 60 * 1000;

interface IdempotencyContext {
  runId: string;
  stepId: string;
  scope: string;
}

export async function withActionIdempotency<T>(
  ctx: IdempotencyContext,
  compute: () => Promise<T>,
): Promise<T> {
  if (!prisma) {
    // DB not configured — fall through without guard. Rare path.
    return compute();
  }

  const key = `${ctx.runId}:${ctx.stepId}`;

  // Check for cached result
  const existing = await prisma.idempotencyKey.findUnique({
    where: { key_scope: { key, scope: ctx.scope } },
  });
  if (existing && existing.status === "completed" && existing.response) {
    return existing.response as T;
  }

  // Execute + store
  const result = await compute();
  try {
    await prisma.idempotencyKey.upsert({
      where: { key_scope: { key, scope: ctx.scope } },
      create: {
        key,
        scope: ctx.scope,
        status: "completed",
        response: result as object,
        expiresAt: new Date(Date.now() + TTL_MS),
      },
      update: {
        status: "completed",
        response: result as object,
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    });
  } catch (err) {
    // Non-fatal: the external action already succeeded. Log + return.
    console.error(
      "[admin-workflow-idempotency] Failed to store idempotency row for %s:%s:",
      ctx.scope,
      key,
      err,
    );
  }
  return result;
}
