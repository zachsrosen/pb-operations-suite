/**
 * Action: Find a HubSpot contact by email.
 *
 * Returns the contact ID + a few common properties. If no contact matches,
 * throws — use stop-if beforehand to gate this action.
 *
 * Useful for workflows triggered by generic events (manual, cron) that
 * need to resolve a contact before continuing.
 */

import { z } from "zod";

import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  email: z.string().email(),
});

interface HubspotSearchResponse {
  results?: Array<{
    id: string;
    properties: Record<string, string | null>;
  }>;
  total?: number;
}

export const findHubspotContactAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  {
    contactId: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
  }
> = {
  kind: "find-hubspot-contact",
  name: "Find HubSpot contact by email",
  description:
    "Look up a HubSpot contact by email. Throws if no contact matches.",
  category: "HubSpot",
  fields: [
    {
      key: "email",
      label: "Email",
      kind: "email",
      placeholder: "{{trigger.customerEmail}}",
      required: true,
    },
  ],
  inputsSchema,
  handler: async ({ inputs }) => {
    const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!accessToken) throw new Error("HUBSPOT_ACCESS_TOKEN not configured");

    const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [{ propertyName: "email", operator: "EQ", value: inputs.email }],
          },
        ],
        properties: ["email", "firstname", "lastname", "phone", "mobilephone"],
        limit: 1,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HubSpot contact search failed: ${res.status} ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as HubspotSearchResponse;
    const hit = data.results?.[0];
    if (!hit) {
      throw new Error(`No HubSpot contact found with email ${inputs.email}`);
    }

    const p = hit.properties;
    return {
      contactId: hit.id,
      email: p.email ?? inputs.email,
      firstName: p.firstname ?? "",
      lastName: p.lastname ?? "",
      phone: (p.phone ?? p.mobilephone ?? "").toString(),
    };
  },
};
