/**
 * Registry of all available workflow actions.
 *
 * Adding a new action:
 *   1. Create `./<kind>.ts` with an exported AdminWorkflowAction.
 *   2. Import and append to ACTIONS below.
 *
 * Actions are keyed by `kind` — must be unique and stable (it's stored in
 * the workflow definition JSON and used at execution time to look up the
 * handler).
 */

import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

import { sendEmailAction } from "./send-email";
import { updateHubSpotPropertyAction } from "./update-hubspot-property";
import { updateZuperPropertyAction } from "./update-zuper-property";

export const ACTIONS: AdminWorkflowAction[] = [
  sendEmailAction,
  updateHubSpotPropertyAction,
  updateZuperPropertyAction,
] as AdminWorkflowAction[];

export function getActionByKind(kind: string): AdminWorkflowAction | undefined {
  return ACTIONS.find((a) => a.kind === kind);
}

/** Paletee metadata without handlers — safe to serialize to the client. */
export function getActionPalette() {
  return ACTIONS.map((a) => ({
    kind: a.kind,
    name: a.name,
    description: a.description,
    category: a.category,
  }));
}
