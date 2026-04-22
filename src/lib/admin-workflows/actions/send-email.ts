/**
 * Action: Send email.
 *
 * Wraps the existing dual-provider sendEmailMessage() — Google Workspace
 * primary, Resend fallback. Preserves all existing audit/BCC behavior.
 */

import sanitizeHtml from "sanitize-html";
import { z } from "zod";

import { sendEmailMessage } from "@/lib/email";
import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  to: z
    .string()
    .min(1, "Recipient is required"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Body is required"),
});

export const sendEmailAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { sent: boolean; recipients: string[] }
> = {
  kind: "send-email",
  name: "Send email",
  description: "Send an email via Google Workspace (fallback: Resend).",
  category: "Messaging",
  fields: [
    { key: "to", label: "Recipient(s)", kind: "email", placeholder: "ops@photonbrothers.com, lead@photonbrothers.com", help: "Comma-separated. Supports {{trigger.X}} templates.", required: true },
    { key: "subject", label: "Subject", kind: "text", required: true },
    { key: "body", label: "Body (HTML)", kind: "textarea", help: "HTML allowed. Supports {{trigger.X}} and {{previous.stepId.field}} templates.", required: true },
  ],
  inputsSchema,
  handler: async ({ inputs, context }) => {
    // `to` can be a comma-separated list.
    const recipients = inputs.to
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const result = await sendEmailMessage({
      to: recipients,
      subject: inputs.subject,
      html: inputs.body,
      text: sanitizeHtml(inputs.body, { allowedTags: [], allowedAttributes: {} }),
      debugFallbackTitle: `AdminWorkflow ${context.workflowId}`,
      debugFallbackBody: `Run ${context.runId} triggered by ${context.triggeredByEmail}`,
    });

    if (!result.success) {
      throw new Error(`Email send failed: ${result.error ?? "unknown error"}`);
    }

    return { sent: true, recipients };
  },
};
