/**
 * DesignAssignment read/write. Assignments are joined onto queue payloads in
 * the ROUTE, never inside the cached queue build — the queue cache serves
 * stale data for up to 15 minutes, and a badge baked into the cached payload
 * would survive a clear for that whole window.
 */

import { prisma } from "@/lib/db";
import { labelFor } from "@/lib/hubspot-enum-labels";
import { designLeadName } from "./roster";
import type { QueueAssignment, QueueItem, Tab } from "./types";

interface AssignmentRow {
  id: string;
  dealId: string;
  assigneeEmail: string;
  assignedBy: string;
  note: string | null;
  dueDate: Date | null;
  tab: string;
  statusAtAssignment: string;
  createdAt: Date;
}

function toView(
  row: AssignmentRow,
  currentStatus: string | undefined,
  statusLabels: Map<string, string>,
): QueueAssignment {
  return {
    id: row.id,
    assigneeEmail: row.assigneeEmail,
    assigneeName: designLeadName(row.assigneeEmail),
    assignedBy: row.assignedBy,
    note: row.note,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    // Unknown current status (deal fell out of the queue entirely) is NOT
    // treated as moved — an absent row is not evidence of a status change,
    // and a false "moved" hint is worse than none.
    statusMoved:
      currentStatus !== undefined && currentStatus !== row.statusAtAssignment,
    statusAtAssignmentLabel: labelFor(statusLabels, row.statusAtAssignment),
  };
}

/** Open assignments for a tab, keyed by dealId. */
export async function fetchOpenAssignments(
  tab: Tab,
): Promise<Map<string, AssignmentRow>> {
  const rows = await prisma.designAssignment.findMany({
    where: { tab, clearedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const byDeal = new Map<string, AssignmentRow>();
  // Newest-first ordering means the first row per deal wins, so a deal with
  // more than one open assignment shows the most recent ask.
  for (const row of rows) {
    if (!byDeal.has(row.dealId)) byDeal.set(row.dealId, row);
  }
  return byDeal;
}

/** Attach open assignments to queue rows. Pure — no I/O. */
export function attachAssignments(
  queue: QueueItem[],
  assignments: Map<string, AssignmentRow>,
  statusLabels: Map<string, string>,
): QueueItem[] {
  return queue.map((item) => {
    const row = assignments.get(item.dealId);
    return {
      ...item,
      assignment: row ? toView(row, item.status, statusLabels) : null,
    };
  });
}

/** Open assignments for one person, newest first. */
export async function fetchMyAssignments(email: string) {
  return prisma.designAssignment.findMany({
    where: { assigneeEmail: email, clearedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export { toView as toAssignmentView };
export type { AssignmentRow };
