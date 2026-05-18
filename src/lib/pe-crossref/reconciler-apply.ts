/**
 * PE Cross-Reference — DB persistence layer for reconcile actions.
 *
 * Split out from `reconciler.ts` so the pure decision logic can be unit-tested
 * without importing Prisma (which has Neon-adapter init that doesn't play
 * nicely in the Jest CommonJS environment).
 */

import { prisma } from "@/lib/db";
import type { ReconcileActions } from "@/lib/pe-crossref/reconciler";

export async function applyReconcileActions(
  dealId: string,
  actions: ReconcileActions,
): Promise<{ created: number; updated: number; autoResolved: number }> {
  let created = 0;
  let updated = 0;
  let autoResolved = 0;

  if (actions.creates.length > 0) {
    const result = await prisma.peActionTask.createMany({
      data: actions.creates.map((t) => ({
        dealId,
        identityKey: t.identityKey,
        pCode: t.pCode,
        severity: t.severity,
        category: t.category,
        analyzer: t.analyzer,
        title: t.title,
        message: t.message,
        action: t.action,
        evidence: t.evidence as object,
        status: "OPEN",
        firstSeenRunId: t.firstSeenRunId,
        lastSeenRunId: t.lastSeenRunId,
      })),
      skipDuplicates: true,
    });
    created = result.count;
  }

  for (const u of actions.updates) {
    await prisma.peActionTask.update({
      where: { id: u.id },
      data: {
        status: u.nextStatus,
        lastSeenRunId: u.lastSeenRunId,
        // Clear resolved fields when transitioning out of a RESOLVED_* state.
        ...(u.previousStatus !== "OPEN" && u.nextStatus === "OPEN"
          ? { resolvedAt: null, resolvedBy: null }
          : {}),
      },
    });
    updated++;
  }

  for (const r of actions.autoResolves) {
    await prisma.peActionTask.update({
      where: { id: r.id },
      data: {
        status: "RESOLVED_AUTO",
        resolvedAt: new Date(),
        resolvedBy: "auto",
      },
    });
    autoResolved++;
  }

  return { created, updated, autoResolved };
}
