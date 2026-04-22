/**
 * Action: Update a Zuper job custom field or core property.
 *
 * Zuper's job update is a PUT to /api/jobs/{uid}. We send a minimal patch
 * body: either `custom_fields: [{ field: name, value }]` for custom fields,
 * or a top-level field for core properties (e.g. title, description).
 *
 * Phase 1 supports custom fields only — core field updates (title, status,
 * category) each have their own rules and are better as dedicated actions.
 */

import { z } from "zod";

import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  jobId: z.string().min(1, "Zuper job UID is required"),
  customFieldName: z.string().min(1, "Custom field name is required"),
  value: z.string(),
});

async function zuperUpdateCustomField(
  jobId: string,
  fieldName: string,
  value: string,
): Promise<void> {
  const apiUrl = process.env.ZUPER_API_URL;
  const apiKey = process.env.ZUPER_API_KEY;
  if (!apiUrl || !apiKey) {
    throw new Error("Zuper is not configured (ZUPER_API_URL/ZUPER_API_KEY)");
  }

  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/jobs/${encodeURIComponent(jobId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      custom_fields: [{ field: fieldName, value }],
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Zuper PUT /jobs/${jobId} failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

export const updateZuperPropertyAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { updated: boolean; jobId: string; field: string }
> = {
  kind: "update-zuper-property",
  name: "Update Zuper custom field",
  description: "Update a custom field on a Zuper job.",
  category: "Zuper",
  fields: [
    { key: "jobId", label: "Zuper job UID", kind: "text", placeholder: "{{trigger.objectId}}", required: true },
    { key: "customFieldName", label: "Custom field name", kind: "text", required: true },
    { key: "value", label: "New value", kind: "text", required: true },
  ],
  inputsSchema,
  handler: async ({ inputs }) => {
    await zuperUpdateCustomField(inputs.jobId, inputs.customFieldName, inputs.value);
    return {
      updated: true,
      jobId: inputs.jobId,
      field: inputs.customFieldName,
    };
  },
};
