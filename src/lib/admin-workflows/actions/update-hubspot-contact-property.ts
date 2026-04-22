/**
 * Action: Update a property on a HubSpot contact.
 *
 * Mirror of update-hubspot-property but for contacts. HubSpot's PATCH
 * endpoint for contacts supports the same payload shape as deals.
 */

import { z } from "zod";

import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  contactId: z.string().min(1),
  propertyName: z.string().min(1),
  propertyValue: z.string(),
});

export const updateHubspotContactPropertyAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { updated: boolean; contactId: string; property: string }
> = {
  kind: "update-hubspot-contact-property",
  name: "Update HubSpot contact property",
  description: "Update a single property on a HubSpot contact.",
  category: "HubSpot",
  fields: [
    { key: "contactId", label: "Contact ID", kind: "text", placeholder: "{{trigger.objectId}}", required: true },
    { key: "propertyName", label: "Property name", kind: "text", required: true },
    { key: "propertyValue", label: "New value", kind: "text", required: true },
  ],
  inputsSchema,
  handler: async ({ inputs }) => {
    const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!accessToken) throw new Error("HUBSPOT_ACCESS_TOKEN not configured");

    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(inputs.contactId)}`,
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
      throw new Error(`HubSpot contact update failed: ${res.status} ${body.slice(0, 200)}`);
    }

    return {
      updated: true,
      contactId: inputs.contactId,
      property: inputs.propertyName,
    };
  },
};
