/**
 * Admin Workflow Fan-out.
 *
 * Given a normalized event (from a HubSpot or Zuper webhook), find all
 * ACTIVE admin workflows whose trigger matches, create a run row per
 * match, and emit Inngest events to execute them.
 *
 * Called from webhook handlers AFTER their primary work completes. This
 * is additive — it never blocks or interferes with the existing webhook
 * logic (e.g. deal-sync still runs regardless of fan-out outcome).
 *
 * Failure mode: if fanout throws, the caller's waitUntil/try-catch
 * absorbs it; the primary webhook work is unaffected.
 *
 * Gated on ADMIN_WORKFLOWS_FANOUT_ENABLED so the code can ship dormant.
 */

import { prisma } from "@/lib/db";
import {
  adminWorkflowRunRequested,
  inngest,
} from "@/lib/inngest-client";
import { getTriggerByKind } from "@/lib/admin-workflows/triggers";
import type { AdminWorkflowTriggerType } from "@/generated/prisma/enums";

export function isAdminWorkflowsFanoutEnabled(): boolean {
  return process.env.ADMIN_WORKFLOWS_FANOUT_ENABLED === "true";
}

/**
 * Fan out a normalized event to matching admin workflows.
 *
 * @param triggerType Which kind of workflows to consider.
 * @param rawEvent Normalized event payload. Shape depends on the trigger:
 *   - HUBSPOT_PROPERTY_CHANGE: { subscriptionType, objectId, propertyName, propertyValue }
 *   - ZUPER_PROPERTY_CHANGE: { eventType, objectId, propertyName, propertyValue }
 *
 * Returns the number of workflows that matched and were queued.
 */
export async function fanoutAdminWorkflows(
  triggerType: AdminWorkflowTriggerType,
  rawEvent: Record<string, unknown>,
): Promise<number> {
  if (!isAdminWorkflowsFanoutEnabled()) return 0;
  if (!prisma) return 0;

  const triggerDef = getTriggerByKind(triggerType);
  if (!triggerDef) return 0;

  // Load only ACTIVE workflows with this trigger type
  const candidates = await prisma.adminWorkflow.findMany({
    where: { status: "ACTIVE", triggerType },
    select: { id: true, triggerConfig: true },
  });

  if (candidates.length === 0) return 0;

  let queued = 0;
  for (const workflow of candidates) {
    try {
      // Validate config (might have been saved against an older schema)
      const parsed = triggerDef.configSchema.safeParse(workflow.triggerConfig);
      if (!parsed.success) {
        console.warn(
          "[admin-workflow-fanout] Skipping workflow %s — invalid triggerConfig: %s",
          workflow.id,
          parsed.error.message.slice(0, 200),
        );
        continue;
      }

      const triggerContext = triggerDef.match({
        config: parsed.data as never,
        rawEvent,
      });
      if (!triggerContext) continue; // didn't match

      // Create run row and emit event
      const run = await prisma.adminWorkflowRun.create({
        data: {
          workflowId: workflow.id,
          status: "RUNNING",
          triggeredByEmail: "system:webhook-fanout",
          triggerContext: triggerContext as object,
        },
      });

      await inngest.send(
        adminWorkflowRunRequested.create({
          runId: run.id,
          workflowId: workflow.id,
          triggeredByEmail: "system:webhook-fanout",
          triggerContext,
        }),
      );

      queued++;
    } catch (err) {
      // Never break the outer webhook on a single bad workflow
      console.error(
        "[admin-workflow-fanout] Error fanning out to workflow %s:",
        workflow.id,
        err,
      );
    }
  }

  if (queued > 0) {
    console.log(
      "[admin-workflow-fanout] Queued %d admin workflow(s) for %s event",
      queued,
      triggerType,
    );
  }

  return queued;
}
