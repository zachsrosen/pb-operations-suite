/**
 * Action: Create a HubSpot task assigned to a deal.
 *
 * Tasks appear in the deal's timeline and show up on the assigned owner's
 * My Tasks list. Uses HubSpot's CRM v3 tasks endpoint.
 *
 * Owner assignment: optional. If omitted, the task is unassigned and can
 * be claimed from the HubSpot UI.
 */

import { z } from "zod";

import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  dealId: z.string().min(1),
  subject: z.string().min(1).max(500),
  body: z.string().max(65535).optional().default(""),
  ownerId: z.string().optional(), // HubSpot owner ID
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().default("MEDIUM"),
});

// HubSpot standard association type id: deal -> task
const DEAL_TO_TASK_ASSOCIATION = 216;

export const createHubspotTaskAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { taskId: string; dealId: string }
> = {
  kind: "create-hubspot-task",
  name: "Create HubSpot task",
  description: "Create a task on a HubSpot deal, optionally assigned to an owner.",
  category: "HubSpot",
  fields: [
    { key: "dealId", label: "Deal ID", kind: "text", placeholder: "{{trigger.objectId}}", required: true },
    { key: "subject", label: "Task subject", kind: "text", required: true },
    { key: "body", label: "Task body", kind: "textarea" },
    { key: "ownerId", label: "HubSpot owner ID (optional)", kind: "text", help: "Leave blank to create unassigned." },
    { key: "priority", label: "Priority", kind: "text", placeholder: "LOW | MEDIUM | HIGH" },
  ],
  inputsSchema,
  handler: async ({ inputs }) => {
    const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!accessToken) throw new Error("HUBSPOT_ACCESS_TOKEN not configured");

    const properties: Record<string, string> = {
      hs_task_subject: inputs.subject,
      hs_task_body: inputs.body ?? "",
      hs_task_status: "NOT_STARTED",
      hs_task_priority: inputs.priority ?? "MEDIUM",
      hs_timestamp: String(Date.now()),
    };
    if (inputs.ownerId) properties.hubspot_owner_id = inputs.ownerId;

    const res = await fetch("https://api.hubapi.com/crm/v3/objects/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties,
        associations: [
          {
            to: { id: inputs.dealId },
            types: [
              { associationCategory: "HUBSPOT_DEFINED", associationTypeId: DEAL_TO_TASK_ASSOCIATION },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`HubSpot create-task failed: ${res.status} ${errBody.slice(0, 200)}`);
    }

    const data = (await res.json()) as { id: string };
    return { taskId: data.id, dealId: inputs.dealId };
  },
};
