/**
 * Versioning helper — creates an AdminWorkflowVersion row from a
 * workflow's current state. Called from PATCH and POST handlers.
 *
 * Versions are monotonic per workflow. We read MAX(version)+1 via a
 * single query rather than relying on count (count can race).
 *
 * Snapshots the full editable shape: name, description, triggerType,
 * triggerConfig, definition, maxRunsPerHour. Omits status (ACTIVE/DRAFT
 * transitions aren't versioned as content changes) and timestamps.
 */

import { prisma } from "@/lib/db";

export interface WorkflowSnapshotInput {
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: unknown;
  definition: unknown;
  maxRunsPerHour: number;
}

export async function snapshotWorkflow(params: {
  workflowId: string;
  savedByEmail: string;
  note?: string | null;
  snapshot: WorkflowSnapshotInput;
}): Promise<{ version: number; id: string } | null> {
  if (!prisma) return null;

  const latest = await prisma.adminWorkflowVersion.findFirst({
    where: { workflowId: params.workflowId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  const row = await prisma.adminWorkflowVersion.create({
    data: {
      workflowId: params.workflowId,
      version: nextVersion,
      snapshot: params.snapshot as object,
      savedByEmail: params.savedByEmail,
      note: params.note ?? null,
    },
    select: { id: true, version: true },
  });

  return row;
}
