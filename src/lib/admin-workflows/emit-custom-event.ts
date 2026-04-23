/**
 * Emit a custom admin-workflow event.
 *
 * Use from ANY app code that wants to let admins wire in workflows via
 * the CUSTOM_EVENT trigger. Example:
 *
 *   import { emitAdminWorkflowCustomEvent } from "@/lib/admin-workflows/emit-custom-event";
 *   await emitAdminWorkflowCustomEvent("pb/invoice.overdue", {
 *     invoiceId: "inv_123",
 *     amount: 4200,
 *     daysOverdue: 30,
 *   });
 *
 * Workflows with triggerType=CUSTOM_EVENT and a matching eventName in
 * their triggerConfig will fire. The `data` payload becomes the
 * triggerContext, available in template expressions as {{trigger.X}}.
 *
 * Gated on ADMIN_WORKFLOWS_FANOUT_ENABLED (same switch as webhook
 * fan-out) so emitters don't accidentally fire runs when the feature
 * is off.
 *
 * Best-effort — caller's flow is never blocked if fanout fails.
 */

import { fanoutAdminWorkflows, isAdminWorkflowsFanoutEnabled } from "./fanout";

export async function emitAdminWorkflowCustomEvent(
  eventName: string,
  data: Record<string, unknown> = {},
): Promise<{ queued: number; skipped?: string }> {
  if (!isAdminWorkflowsFanoutEnabled()) {
    return { queued: 0, skipped: "ADMIN_WORKFLOWS_FANOUT_ENABLED is false" };
  }
  try {
    const queued = await fanoutAdminWorkflows("CUSTOM_EVENT", { eventName, data });
    return { queued };
  } catch (err) {
    console.error(
      "[admin-workflow-custom-event] emit %s failed (non-fatal):",
      eventName,
      err,
    );
    return { queued: 0, skipped: err instanceof Error ? err.message : String(err) };
  }
}
