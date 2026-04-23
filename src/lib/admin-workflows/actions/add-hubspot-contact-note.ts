/**
 * Action: Add a note to a HubSpot contact.
 *
 * Mirror of add-hubspot-note but targets contacts instead of deals.
 * Useful for customer-facing audit trails.
 */

import { z } from "zod";

import { withActionIdempotency } from "@/lib/admin-workflows/idempotency";
import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  contactId: z.string().min(1),
  body: z.string().min(1).max(65535),
});

// HubSpot standard association type id: contact -> note
const CONTACT_TO_NOTE_ASSOCIATION = 202;

export const addHubspotContactNoteAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { noteId: string; contactId: string }
> = {
  kind: "add-hubspot-contact-note",
  name: "Add HubSpot contact note",
  description: "Append a note to a HubSpot contact's timeline.",
  category: "HubSpot",
  fields: [
    { key: "contactId", label: "Contact ID", kind: "text", placeholder: "{{trigger.objectId}}", required: true },
    { key: "body", label: "Note body (HTML)", kind: "textarea", help: "HTML allowed. Supports templates.", required: true },
  ],
  inputsSchema,
  handler: async ({ inputs, context }) => {
    return withActionIdempotency(
      { runId: context.runId, stepId: context.stepId, scope: "add-hubspot-contact-note" },
      async () => {
    const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!accessToken) throw new Error("HUBSPOT_ACCESS_TOKEN not configured");

    const res = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          hs_note_body: inputs.body,
          hs_timestamp: String(Date.now()),
        },
        associations: [
          {
            to: { id: inputs.contactId },
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: CONTACT_TO_NOTE_ASSOCIATION,
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`HubSpot contact-note create failed: ${res.status} ${errBody.slice(0, 200)}`);
    }

    const data = (await res.json()) as { id: string };
    return { noteId: data.id, contactId: inputs.contactId };
      },
    );
  },
};
