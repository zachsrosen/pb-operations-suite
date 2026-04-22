/**
 * Action: Write an ActivityLog row.
 *
 * Useful for:
 *  - Debugging workflow runs (add log steps between actions)
 *  - Creating audit trails that show up in the activity dashboard
 *  - Marking significant events that don't map to a specific integration
 *
 * Uses SETTINGS_CHANGED as the ActivityType — deliberately generic, since
 * the ActivityType enum is intentionally limited. The actual meaning is
 * conveyed through `description` and `metadata`.
 */

import { z } from "zod";

import { logActivity } from "@/lib/db";
import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  description: z.string().min(1).max(500),
  entityType: z.string().optional().default(""),
  entityId: z.string().optional().default(""),
  metadata: z.string().optional().default(""),
});

export const logActivityAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { logged: boolean }
> = {
  kind: "log-activity",
  name: "Log activity",
  description:
    "Write a row to ActivityLog. Shows up in the admin activity dashboard.",
  category: "PB Ops",
  fields: [
    {
      key: "description",
      label: "Description",
      kind: "text",
      help: "Short human-readable summary. Supports templates.",
      required: true,
    },
    {
      key: "entityType",
      label: "Entity type (optional)",
      kind: "text",
      placeholder: "deal | contact | ticket | workflow",
    },
    {
      key: "entityId",
      label: "Entity ID (optional)",
      kind: "text",
      placeholder: "{{trigger.objectId}}",
    },
    {
      key: "metadata",
      label: "Metadata JSON (optional)",
      kind: "textarea",
      placeholder: `{"custom":"value"}`,
      help: "Extra JSON stored on the log row. Must be valid JSON if provided.",
    },
  ],
  inputsSchema,
  handler: async ({ inputs, context }) => {
    let parsedMetadata: Record<string, unknown> = {};
    if (inputs.metadata && inputs.metadata.trim()) {
      try {
        const parsed: unknown = JSON.parse(inputs.metadata);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          parsedMetadata = parsed as Record<string, unknown>;
        }
      } catch {
        throw new Error("log-activity: metadata is not valid JSON");
      }
    }

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: inputs.description,
      userEmail: context.triggeredByEmail,
      entityType: inputs.entityType || "admin-workflow",
      entityId: inputs.entityId || context.workflowId,
      metadata: {
        ...parsedMetadata,
        workflowId: context.workflowId,
        runId: context.runId,
      },
    });

    return { logged: true };
  },
};
