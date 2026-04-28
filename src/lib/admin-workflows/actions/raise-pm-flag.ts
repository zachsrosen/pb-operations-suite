/**
 * Action: Raise a PM flag on a deal.
 *
 * Lets admin workflows hand work to a Project Manager when a condition fires
 * (e.g. "deal stuck in Permitting > 7 days" → raise STAGE_STUCK + HIGH).
 * The PM Flag system handles round-robin assignment and notification.
 *
 * Idempotent on `(source=ADMIN_WORKFLOW, externalRef)`. The default externalRef
 * is `${workflowId}:${runId}:${dealId}` so a single workflow run never
 * duplicates a flag, but a re-run on the same deal does raise a new flag
 * (different runId).
 */

import { z } from "zod";

import { withActionIdempotency } from "@/lib/admin-workflows/idempotency";
import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";
import { createFlag } from "@/lib/pm-flags";
import {
  PmFlagType,
  PmFlagSeverity,
  PmFlagSource,
} from "@/generated/prisma/enums";

const inputsSchema = z.object({
  dealId: z.string().min(1),
  dealName: z.string().optional().default(""),
  type: z.nativeEnum(PmFlagType),
  severity: z.nativeEnum(PmFlagSeverity).optional().default(PmFlagSeverity.MEDIUM),
  reason: z.string().min(1).max(5000),
  externalRef: z.string().optional().default(""),
});

export const raisePmFlagAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { flagId: string; alreadyExisted: boolean; assignedToUserId: string | null }
> = {
  kind: "raise-pm-flag",
  name: "Raise PM flag",
  description:
    "Raise a flag on a deal so it lands in the round-robin PM action queue with notification.",
  category: "PB Ops",
  fields: [
    {
      key: "dealId",
      label: "Deal ID",
      kind: "text",
      placeholder: "{{trigger.objectId}}",
      required: true,
    },
    {
      key: "dealName",
      label: "Deal name (optional)",
      kind: "text",
      placeholder: "{{trigger.dealname}}",
      help: "Snapshot used in queue display + email subject.",
    },
    {
      key: "type",
      label: "Flag type",
      kind: "text",
      placeholder: "STAGE_STUCK | MILESTONE_OVERDUE | …",
      required: true,
      help: "One of: " + Object.values(PmFlagType).join(", "),
    },
    {
      key: "severity",
      label: "Severity",
      kind: "text",
      placeholder: "LOW | MEDIUM | HIGH | CRITICAL",
      help: "Defaults to MEDIUM.",
    },
    {
      key: "reason",
      label: "Reason",
      kind: "textarea",
      required: true,
      help: "Free text shown to the assigned PM.",
    },
    {
      key: "externalRef",
      label: "External ref (optional)",
      kind: "text",
      help:
        "Idempotency key — repeat calls with the same key return the existing flag. " +
        "Default: workflowId:runId:dealId.",
    },
  ],
  inputsSchema,
  handler: async ({ inputs, context }) => {
    return withActionIdempotency(
      { runId: context.runId, stepId: context.stepId, scope: "raise-pm-flag" },
      async () => {
        const externalRef =
          inputs.externalRef && inputs.externalRef.trim()
            ? inputs.externalRef.trim()
            : `${context.workflowId}:${context.runId}:${inputs.dealId}`;

        const result = await createFlag({
          hubspotDealId: inputs.dealId,
          dealName: inputs.dealName?.trim() || null,
          type: inputs.type,
          severity: inputs.severity,
          reason: inputs.reason,
          source: PmFlagSource.ADMIN_WORKFLOW,
          externalRef,
          metadata: {
            workflowId: context.workflowId,
            runId: context.runId,
          },
          raisedByEmail: context.triggeredByEmail,
        });

        // Fire the email outside the txn so a slow SMTP call doesn't block the workflow.
        if (!result.alreadyExisted && result.flag.assignedToUser) {
          void import("@/lib/pm-flag-email").then(m =>
            m.sendFlagAssignedEmail(result.flag).catch(err => {
              console.error("raise-pm-flag email send failed", err);
            })
          );
        }

        return {
          flagId: result.flag.id,
          alreadyExisted: result.alreadyExisted,
          assignedToUserId: result.flag.assignedToUserId,
        };
      }
    );
  },
};
