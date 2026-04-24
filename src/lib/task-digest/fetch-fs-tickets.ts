// src/lib/task-digest/fetch-fs-tickets.ts
//
// Fetch open Freshservice tickets ASSIGNED to a single agent.
// Filters out Resolved (4) and Closed (5).

import {
  fetchAgentIdByEmail,
  fetchTicketsByAgentId,
  type FreshserviceTicket,
} from "@/lib/freshservice";

export interface OpenFsTicket extends FreshserviceTicket {
  isOverdue: boolean;
}

export async function fetchOpenFsTicketsForAgent(
  email: string
): Promise<{ tickets: OpenFsTicket[]; error?: string; agentId?: number }> {
  try {
    const agentId = await fetchAgentIdByEmail(email);
    if (agentId === null) {
      return { tickets: [], error: `No Freshservice agent for ${email}` };
    }

    const all = await fetchTicketsByAgentId(agentId);
    const now = Date.now();

    const open = all
      .filter((t) => t.status === 2 || t.status === 3)
      .map<OpenFsTicket>((t) => ({
        ...t,
        isOverdue: t.due_by ? new Date(t.due_by).getTime() < now : false,
      }));

    // Sort: overdue first, then by priority desc, then by created_at asc
    open.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      if (a.priority !== b.priority) return b.priority - a.priority;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    return { tickets: open, agentId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[task-digest] fetchOpenFsTicketsForAgent failed:", err);
    return { tickets: [], error: msg };
  }
}
