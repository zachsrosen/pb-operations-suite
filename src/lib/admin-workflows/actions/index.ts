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

import { addHubspotContactNoteAction } from "./add-hubspot-contact-note";
import { addHubspotNoteAction } from "./add-hubspot-note";
import { aiComposeAction } from "./ai-compose";
import { createHubspotTaskAction } from "./create-hubspot-task";
import { fetchHubspotDealAction } from "./fetch-hubspot-deal";
import { fetchZuperJobAction } from "./fetch-zuper-job";
import { logActivityAction } from "./log-activity";
import { runBomPipelineAction } from "./run-bom-pipeline";
import { sendEmailAction } from "./send-email";
import { updateHubSpotPropertyAction } from "./update-hubspot-property";
import { updateHubspotContactPropertyAction } from "./update-hubspot-contact-property";
import { updateHubspotTicketPropertyAction } from "./update-hubspot-ticket-property";
import { updateZuperPropertyAction } from "./update-zuper-property";

export const ACTIONS: AdminWorkflowAction[] = [
  // Messaging
  sendEmailAction,
  // AI
  aiComposeAction,
  // HubSpot — reads
  fetchHubspotDealAction,
  // HubSpot — writes
  updateHubSpotPropertyAction,
  updateHubspotContactPropertyAction,
  updateHubspotTicketPropertyAction,
  addHubspotNoteAction,
  addHubspotContactNoteAction,
  createHubspotTaskAction,
  // Zuper
  fetchZuperJobAction,
  updateZuperPropertyAction,
  // PB Ops
  runBomPipelineAction,
  logActivityAction,
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
