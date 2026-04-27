/**
 * Shit Show — HubSpot task creation
 *
 * - createHubspotTaskForAssignment: writes a HubSpot task associated with the deal
 *   when an owner adds a follow-up assignment in the Shit Show meeting.
 * - scheduleHubspotEscalationTask: when an item is escalated, creates a HubSpot
 *   task assigned to the deal owner with the escalation rationale.
 */

import { prisma } from "@/lib/db";

const DEAL_TO_TASK_ASSOCIATION = 216;

export type CreateTaskParams = {
  dealId: string;
  assigneeHubspotOwnerId: string | null;
  subject: string;
  body: string;
  dueDate: Date | null;
};

/**
 * POST a HubSpot task object associated with a deal.
 * Returns the new task id, or null if the create failed.
 * Best-effort: callers should handle null without aborting the user-facing action.
 */
export async function createHubspotTaskForAssignment(
  params: CreateTaskParams,
): Promise<string | null> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    console.warn("[shit-show] HUBSPOT_ACCESS_TOKEN missing — skipping HubSpot task create");
    return null;
  }

  const properties: Record<string, string> = {
    hs_task_subject: params.subject,
    hs_task_body: params.body,
    hs_task_status: "NOT_STARTED",
    hs_task_priority: "HIGH",
    hs_task_type: "TODO",
    hs_timestamp: params.dueDate
      ? params.dueDate.getTime().toString()
      : Date.now().toString(),
  };
  if (params.assigneeHubspotOwnerId) {
    properties.hubspot_owner_id = params.assigneeHubspotOwnerId;
  }

  try {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties,
        associations: [{
          to: { id: params.dealId },
          types: [{
            associationCategory: "HUBSPOT_DEFINED",
            associationTypeId: DEAL_TO_TASK_ASSOCIATION,
          }],
        }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[shit-show] HubSpot task create failed: ${res.status} ${errBody.slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch (e) {
    console.error("[shit-show] HubSpot task create threw", e);
    return null;
  }
}

/**
 * When an item is escalated, create a HubSpot task assigned to the deal owner
 * with the escalation rationale, and persist the task id on the session item
 * for idempotency / display.
 */
export async function scheduleHubspotEscalationTask(params: {
  sessionItemId: string;
  dealId: string;
  reason: string;
}): Promise<void> {
  const { getDealOwnerContact } = await import("@/lib/hubspot");
  let ownerHubspotId: string | null = null;
  try {
    const owner = await getDealOwnerContact(params.dealId);
    ownerHubspotId = (owner as { hubspotOwnerId?: string } | null)?.hubspotOwnerId ?? null;
  } catch (e) {
    console.warn("[shit-show] could not resolve deal owner; escalation task will be unassigned", e);
  }

  const taskId = await createHubspotTaskForAssignment({
    dealId: params.dealId,
    assigneeHubspotOwnerId: ownerHubspotId,
    subject: `🔥 Shit Show Escalation: ${params.dealId}`,
    body: params.reason,
    dueDate: null,
  });

  if (taskId) {
    await prisma.shitShowSessionItem.update({
      where: { id: params.sessionItemId },
      data: { hubspotEscalationTaskId: taskId },
    });
  }
}
