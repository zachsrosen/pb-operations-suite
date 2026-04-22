/**
 * Action: Update a property on a HubSpot ticket.
 *
 * Same shape as update-hubspot-property but targets tickets. Uses
 * HubSpot's PATCH /crm/v3/objects/tickets/{id}.
 */

import { z } from "zod";

import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  ticketId: z.string().min(1),
  propertyName: z.string().min(1),
  propertyValue: z.string(),
});

export const updateHubspotTicketPropertyAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { updated: boolean; ticketId: string; property: string }
> = {
  kind: "update-hubspot-ticket-property",
  name: "Update HubSpot ticket property",
  description: "Update a single property on a HubSpot ticket.",
  category: "HubSpot",
  fields: [
    { key: "ticketId", label: "Ticket ID", kind: "text", placeholder: "{{trigger.objectId}}", required: true },
    { key: "propertyName", label: "Property name", kind: "text", placeholder: "hs_pipeline_stage", required: true },
    { key: "propertyValue", label: "New value", kind: "text", required: true },
  ],
  inputsSchema,
  handler: async ({ inputs }) => {
    const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!accessToken) throw new Error("HUBSPOT_ACCESS_TOKEN not configured");

    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/tickets/${encodeURIComponent(inputs.ticketId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: { [inputs.propertyName]: inputs.propertyValue },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HubSpot ticket update failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return {
      updated: true,
      ticketId: inputs.ticketId,
      property: inputs.propertyName,
    };
  },
};
