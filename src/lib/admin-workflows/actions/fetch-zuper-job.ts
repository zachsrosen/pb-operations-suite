/**
 * Action: Fetch Zuper job details.
 *
 * Mirror of fetch-hubspot-deal but for Zuper jobs. Returns the job's
 * core fields + all custom fields as a flat object that later steps
 * can reference via {{previous.stepId.fields.<name>}}.
 *
 * Uses Zuper's GET /api/jobs/{job_uid} endpoint.
 */

import { z } from "zod";

import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  jobId: z.string().min(1),
});

interface ZuperCustomField {
  field_name?: string;
  field?: string;
  name?: string;
  value?: unknown;
}

interface ZuperJobRaw {
  data?: {
    job_uid?: string;
    job_title?: string;
    job_description?: string;
    current_job_status?: { status_name?: string };
    custom_fields?: ZuperCustomField[];
    [key: string]: unknown;
  };
}

export const fetchZuperJobAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  {
    jobId: string;
    title: string;
    status: string;
    fields: Record<string, string>;
  }
> = {
  kind: "fetch-zuper-job",
  name: "Fetch Zuper job",
  description:
    "Read a Zuper job's title, status, and custom fields. Values flow to later steps via {{previous.stepId.fields.X}}.",
  category: "Zuper",
  fields: [
    {
      key: "jobId",
      label: "Job UID",
      kind: "text",
      placeholder: "{{trigger.objectId}}",
      required: true,
    },
  ],
  inputsSchema,
  handler: async ({ inputs }) => {
    const apiUrl = process.env.ZUPER_API_URL;
    const apiKey = process.env.ZUPER_API_KEY;
    if (!apiUrl || !apiKey) {
      throw new Error("Zuper is not configured (ZUPER_API_URL/ZUPER_API_KEY)");
    }
    const res = await fetch(
      `${apiUrl.replace(/\/$/, "")}/jobs/${encodeURIComponent(inputs.jobId)}`,
      { headers: { "x-api-key": apiKey }, cache: "no-store" },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zuper GET /jobs/${inputs.jobId} failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const raw = (await res.json()) as ZuperJobRaw;
    const data = raw.data ?? {};
    const fields: Record<string, string> = {};
    const customFields = Array.isArray(data.custom_fields) ? data.custom_fields : [];
    for (const cf of customFields) {
      const name = cf.field_name ?? cf.field ?? cf.name;
      if (!name) continue;
      fields[String(name)] = cf.value == null ? "" : String(cf.value);
    }
    return {
      jobId: inputs.jobId,
      title: data.job_title ?? "",
      status: data.current_job_status?.status_name ?? "",
      fields,
    };
  },
};
