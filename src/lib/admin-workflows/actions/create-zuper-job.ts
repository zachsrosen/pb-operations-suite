/**
 * Action: Create a Zuper job for a HubSpot deal.
 *
 * Creates an UNSCHEDULED job (due date +N business days, no scheduled
 * times) in a chosen category — e.g. Additional Visit for a PTO truck
 * roll. Scheduling happens later in the PB schedulers, which stamp the
 * final crew/time; this action stamps `job_timezone` from the deal state
 * so Zuper renders every time in the customer's local zone.
 *
 * Deal linkage: tags the job `hubspot-{dealId}` and sets the
 * `hubspot_deal_id` custom field. Pair with an update-hubspot-property
 * step writing {{previous.<stepId>.jobUid}} to `new_zuper_job_uid` to
 * fire the existing "Link Deal to Zuper Job" HubSpot workflow.
 */

import { z } from "zod";

import { getDealProperties } from "@/lib/hubspot";
import {
  resolveOrCreateZuperCustomer,
  zuper,
  ZuperClient,
  zuperTimezoneForState,
  type ZuperJob,
} from "@/lib/zuper";
import { getBusinessEndDateInclusive } from "@/lib/business-days";
import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  dealId: z.string().min(1, "HubSpot deal ID is required"),
  jobCategoryUid: z.string().min(1, "Zuper job category is required"),
  jobTitle: z.string().optional(),
  jobDescription: z.string().optional(),
  /** Due date offset. Defaults to 7 business days out (same as the Tray flows). */
  dueInBusinessDays: z.coerce.number().int().min(1).max(60).optional(),
});

/**
 * Live Zuper category UIDs (photonbrothers tenant). Static by design —
 * category UIDs are stable, and a hardcoded list keeps the editor form
 * working even when Zuper is unreachable.
 */
const CATEGORY_OPTIONS = [
  { value: "d83c054f-69c1-470c-964c-2b79e88258f4", label: "Additional Visit" },
  { value: "a471910f-30c1-4bc3-a81a-3382b758ff85", label: "Additional Visit (D&R)" },
  { value: "cff6f839-c043-46ee-a09f-8d0e9f363437", label: "Service Visit" },
  { value: "8a29a1c0-9141-4db6-b8bb-9d9a65e2a1de", label: "Service Revisit" },
  { value: "b7dc03d2-25d0-40df-a2fc-b1a477b16b65", label: "Inspection" },
  { value: "906c3b52-6799-408c-9a44-2a6f6581769d", label: "Fire Inspection" },
  { value: "002bac33-84d3-4083-a35d-50626fc49288", label: "Site Survey" },
  { value: "c53070e5-63fd-41bc-8803-f66ad842dbb5", label: "Pre-Sale Site Visit" },
];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
);

const DEAL_PROPS = ["dealname", "address_line_1", "city", "state", "postal_code"];

export const createZuperJobAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { jobUid: string; jobUrl: string; jobTitle: string; categoryUid: string }
> = {
  kind: "create-zuper-job",
  name: "Create Zuper job",
  description:
    "Create an unscheduled Zuper job for a deal (e.g. Additional Visit). Job UID is available to later steps as {{previous.stepId.jobUid}}.",
  category: "Zuper",
  fields: [
    {
      key: "dealId",
      label: "HubSpot deal ID",
      kind: "text",
      placeholder: "{{trigger.objectId}}",
      required: true,
    },
    {
      key: "jobCategoryUid",
      label: "Job category",
      kind: "select",
      required: true,
      options: CATEGORY_OPTIONS,
    },
    {
      key: "jobTitle",
      label: "Job title (optional)",
      kind: "text",
      help: "Defaults to '<Category> - <deal name>'.",
    },
    {
      key: "jobDescription",
      label: "Job description (optional)",
      kind: "textarea",
      placeholder: "{{trigger.propertyValue}} or a fetched deal property",
    },
    {
      key: "dueInBusinessDays",
      label: "Due in business days",
      kind: "text",
      placeholder: "7",
      help: "Due date stamped on the job. Defaults to 7 business days from today.",
    },
  ],
  inputsSchema,
  handler: async ({ inputs }) => {
    const deal = await getDealProperties(inputs.dealId, DEAL_PROPS);
    if (!deal) {
      throw new Error(`HubSpot deal ${inputs.dealId} not found or inaccessible`);
    }

    const dealName = deal.dealname || `Deal ${inputs.dealId}`;
    const state = deal.state || "";
    const categoryLabel = CATEGORY_LABELS[inputs.jobCategoryUid] || "Job";
    const jobTitle = inputs.jobTitle?.trim() || `${categoryLabel} - ${dealName}`;

    // Resolve (or create) the Zuper customer so the tenant accepts the job.
    const customerUid = await resolveOrCreateZuperCustomer({
      id: inputs.dealId,
      name: dealName,
      address: deal.address_line_1 || "",
      city: deal.city || "",
      state,
      zipCode: deal.postal_code || "",
    });

    // Due date only — the job is created unscheduled and gets real times
    // when someone books it in a PB scheduler.
    const todayStr = new Date().toISOString().slice(0, 10);
    const dueDateStr = getBusinessEndDateInclusive(todayStr, inputs.dueInBusinessDays ?? 7);

    const job: ZuperJob = {
      job_title: jobTitle,
      job_category: inputs.jobCategoryUid,
      job_priority: "MEDIUM",
      due_date: `${dueDateStr} 23:59:59`,
      // Display timezone for Zuper UI + customer notifications. Without this
      // Zuper renders times in the account timezone (Mountain) even for CA.
      job_timezone: zuperTimezoneForState(state),
      ...(customerUid && { customer_uid: customerUid }),
      customer_address: {
        street: deal.address_line_1 || "",
        city: deal.city || "",
        state,
        zip_code: deal.postal_code || "",
      },
      ...(inputs.jobDescription?.trim() && { job_description: inputs.jobDescription.trim() }),
      job_tags: [
        `hubspot-${inputs.dealId}`,
        ...(dealName.match(/PROJ-\d+/i) ? [dealName.match(/PROJ-\d+/i)![0].toLowerCase()] : []),
        "admin-workflow",
      ],
      custom_fields: {
        hubspot_deal_id: inputs.dealId,
      },
    };

    const result = await zuper.createJob(job);
    // POST /jobs may return the job flat or wrapped in a {type, data} envelope.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = result.type === "success" ? (result.data as any) : null;
    const jobUid: string | undefined = raw?.job_uid ?? raw?.data?.job_uid;
    if (result.type === "error" || !jobUid) {
      throw new Error(
        `Zuper job creation failed: ${result.type === "error" ? result.error : "no job_uid returned"}`,
      );
    }

    return {
      jobUid,
      jobUrl: ZuperClient.getJobWebUrl(jobUid),
      jobTitle,
      categoryUid: inputs.jobCategoryUid,
    };
  },
};
