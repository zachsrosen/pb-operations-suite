/**
 * Action: Add a note to a HubSpot deal.
 *
 * Creates a Note engagement via HubSpot's CRM v3 API, associated to the
 * given deal. The note shows up in the deal's timeline and is visible
 * to any HubSpot user with deal access.
 *
 * Association uses the standard deal<->note association type (id: 214 for
 * deal->note). HubSpot auto-creates the reverse association.
 */

import { z } from "zod";

import { withActionIdempotency } from "@/lib/admin-workflows/idempotency";
import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  dealId: z.string().min(1),
  body: z.string().min(1).max(65535),
});

// HubSpot standard association type id: deal -> note
const DEAL_TO_NOTE_ASSOCIATION = 214;

async function createHubspotNote(dealId: string, body: string): Promise<string> {
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
        hs_note_body: body,
        hs_timestamp: String(Date.now()),
      },
      associations: [
        {
          to: { id: dealId },
          types: [
            { associationCategory: "HUBSPOT_DEFINED", associationTypeId: DEAL_TO_NOTE_ASSOCIATION },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`HubSpot create-note failed: ${res.status} ${errBody.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

export const addHubspotNoteAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { noteId: string; dealId: string }
> = {
  kind: "add-hubspot-note",
  name: "Add HubSpot deal note",
  description: "Append a note to a HubSpot deal's timeline.",
  category: "HubSpot",
  fields: [
    { key: "dealId", label: "Deal ID", kind: "text", placeholder: "{{trigger.objectId}}", required: true },
    { key: "body", label: "Note body (HTML)", kind: "textarea", help: "HTML allowed. Supports templates.", required: true },
  ],
  inputsSchema,
  handler: async ({ inputs, context }) => {
    return withActionIdempotency(
      { runId: context.runId, stepId: context.stepId, scope: "add-hubspot-note" },
      async () => {
        const noteId = await createHubspotNote(inputs.dealId, inputs.body);
        return { noteId, dealId: inputs.dealId };
      },
    );
  },
};
