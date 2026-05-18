/**
 * PE Cross-Reference Reconciler — pure logic
 *
 * Pure function that diffs newly-detected tasks against existing PeActionTask
 * rows and computes what should change. State transitions per the spec:
 *
 *   On re-detection:
 *     OPEN            → OPEN  (lastSeenRunId bump only)
 *     RESOLVED_AUTO   → OPEN  (regressed)
 *     RESOLVED_MANUAL → OPEN  (PM's manual resolve doesn't override source)
 *     DISMISSED       → DISMISSED (PM declared N/A — permanent)
 *
 *   On non-detection (existing row, no match in detected):
 *     OPEN            → RESOLVED_AUTO
 *     RESOLVED_AUTO   → stays
 *     RESOLVED_MANUAL → stays
 *     DISMISSED       → stays
 *
 * DB persistence is handled by `applyReconcileActions` in
 * `./reconciler-apply.ts` — kept separate so unit tests of the decision
 * logic don't need to import Prisma.
 *
 * See docs/superpowers/specs/2026-05-18-pe-action-tasks-cross-reference-design.md
 */

import type { DetectedTask, TaskStatus } from "@/lib/pe-crossref/types";

export interface ExistingTaskRow {
  id: string;
  identityKey: string;
  status: TaskStatus;
}

export interface ReconcileInput {
  runId: string;
  detected: DetectedTask[];
  existing: ExistingTaskRow[];
}

export interface ReconcileActions {
  /** New tasks to insert. */
  creates: Array<DetectedTask & { firstSeenRunId: string; lastSeenRunId: string }>;
  /** Existing rows whose status / lastSeenRunId should change. */
  updates: Array<{
    id: string;
    previousStatus: TaskStatus;
    nextStatus: TaskStatus;
    lastSeenRunId: string;
  }>;
  /** Existing OPEN rows the source no longer flags (→ RESOLVED_AUTO). */
  autoResolves: Array<{ id: string }>;
}

export function computeReconcileActions(input: ReconcileInput): ReconcileActions {
  const { runId, detected, existing } = input;
  const existingByKey = new Map(existing.map((e) => [e.identityKey, e]));
  const detectedKeys = new Set<string>();

  const creates: ReconcileActions["creates"] = [];
  const updates: ReconcileActions["updates"] = [];
  const autoResolves: ReconcileActions["autoResolves"] = [];

  for (const task of detected) {
    detectedKeys.add(task.identityKey);
    const row = existingByKey.get(task.identityKey);
    if (!row) {
      creates.push({ ...task, firstSeenRunId: runId, lastSeenRunId: runId });
      continue;
    }
    const next = nextStatusOnReDetect(row.status);
    if (next !== row.status) {
      updates.push({
        id: row.id,
        previousStatus: row.status,
        nextStatus: next,
        lastSeenRunId: runId,
      });
    } else if (row.status === "OPEN") {
      // Bump lastSeenRunId for OPEN tasks (recency tracking).
      updates.push({
        id: row.id,
        previousStatus: row.status,
        nextStatus: row.status,
        lastSeenRunId: runId,
      });
    }
    // DISMISSED re-detected: no update emitted — saves DB write.
  }

  for (const row of existing) {
    if (detectedKeys.has(row.identityKey)) continue;
    if (row.status === "OPEN") {
      autoResolves.push({ id: row.id });
    }
    // RESOLVED_AUTO, RESOLVED_MANUAL, DISMISSED all stay as-is when not detected.
  }

  return { creates, updates, autoResolves };
}

function nextStatusOnReDetect(current: TaskStatus): TaskStatus {
  switch (current) {
    case "OPEN":
      return "OPEN";
    case "RESOLVED_AUTO":
      return "OPEN";
    case "RESOLVED_MANUAL":
      return "OPEN";
    case "DISMISSED":
      return "DISMISSED";
  }
}
