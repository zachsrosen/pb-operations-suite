/**
 * PE Cross-Reference — public entry point.
 *
 * Orchestrates the full pipeline:
 *   1. Create CrossRefRun row (status=running)
 *   2. Build context (parallel extractors)
 *   3. Run analyzers in parallel
 *   4. Reconcile detected vs existing PeActionTask rows
 *   5. Persist via applyReconcileActions
 *   6. Mark run completed with counts
 */

import { prisma } from "@/lib/db";
import { buildCrossRefContext } from "@/lib/pe-crossref/context";
import { computeReconcileActions, type ExistingTaskRow } from "@/lib/pe-crossref/reconciler";
import { applyReconcileActions } from "@/lib/pe-crossref/reconciler-apply";
import type { Analyzer, DetectedTask, TaskStatus } from "@/lib/pe-crossref/types";

export interface RunCrossReferenceOptions {
  dealId: string;
  /** "audit-completion" | "manual:userEmail" | "batch-refresh" */
  triggeredBy: string;
  /** Injection point for tests. Defaults to the registered analyzer list. */
  analyzers?: Analyzer[];
}

export interface RunCrossReferenceResult {
  runId: string;
  status: "completed" | "failed";
  detectedCount: number;
  newCount: number;
  resolvedCount: number;
  errorMessage?: string;
}

export async function runCrossReference(opts: RunCrossReferenceOptions): Promise<RunCrossReferenceResult> {
  const { dealId, triggeredBy } = opts;
  const startedAt = Date.now();

  const runRow = await prisma.crossRefRun.create({
    data: { dealId, status: "running", triggeredBy },
  });

  try {
    const { context, extractorResults } = await buildCrossRefContext(dealId);
    const analyzers = opts.analyzers ?? getRegisteredAnalyzers();

    const detectedPerAnalyzer = await Promise.all(
      analyzers.map((a) =>
        a.detectTasks(context).catch((err) => {
          console.warn(`[pe-crossref] analyzer ${a.name} failed:`, err);
          return [] as DetectedTask[];
        }),
      ),
    );
    const detected = detectedPerAnalyzer.flat();

    const existingRows = await prisma.peActionTask.findMany({
      where: { dealId },
      select: { id: true, identityKey: true, status: true },
    });
    const existing: ExistingTaskRow[] = existingRows.map((r) => ({
      id: r.id,
      identityKey: r.identityKey,
      status: r.status as TaskStatus,
    }));

    const actions = computeReconcileActions({ runId: runRow.id, detected, existing });
    const applied = await applyReconcileActions(dealId, actions);

    await prisma.crossRefRun.update({
      where: { id: runRow.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
        detectedCount: detected.length,
        newCount: applied.created,
        resolvedCount: applied.autoResolved,
        extractorResults,
      },
    });

    return {
      runId: runRow.id,
      status: "completed",
      detectedCount: detected.length,
      newCount: applied.created,
      resolvedCount: applied.autoResolved,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await prisma.crossRefRun.update({
      where: { id: runRow.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
        errorMessage,
      },
    });
    return {
      runId: runRow.id,
      status: "failed",
      detectedCount: 0,
      newCount: 0,
      resolvedCount: 0,
      errorMessage,
    };
  }
}

/**
 * Registered analyzers. Populated as each is implemented (Chunks 3–7).
 */
import { MonitoringAnalyzer } from "@/lib/pe-crossref/analyzers/monitoring";

function getRegisteredAnalyzers(): Analyzer[] {
  return [MonitoringAnalyzer];
}
