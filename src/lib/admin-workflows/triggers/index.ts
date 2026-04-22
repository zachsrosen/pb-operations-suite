/**
 * Registry of all available workflow triggers.
 *
 * A trigger defines:
 *  - Its configSchema (what the admin fills in when setting up the trigger)
 *  - Its match() function (given a raw event, decide if this workflow should run)
 *
 * Webhook fan-out flow (for HUBSPOT_PROPERTY_CHANGE as example):
 *   1. Existing HubSpot webhook handler runs its own logic (e.g. BOM pipeline).
 *   2. After that, it queries AdminWorkflow rows with triggerType=HUBSPOT_PROPERTY_CHANGE.
 *   3. For each row, calls trigger.match({ config: row.triggerConfig, rawEvent }).
 *   4. If match returns non-null, emits `admin-workflow/run.requested` via Inngest.
 *   5. The executor picks it up and runs the action chain.
 */

import { z } from "zod";

import type { AdminWorkflowTrigger } from "@/lib/admin-workflows/types";

// ---------------------------------------------------------------------------
// Manual
// ---------------------------------------------------------------------------

const manualConfigSchema = z.object({});

export const manualTrigger: AdminWorkflowTrigger<z.infer<typeof manualConfigSchema>> = {
  kind: "MANUAL",
  name: "Manual run",
  description: "Admin clicks 'Run now' from the workflow editor.",
  configSchema: manualConfigSchema,
  match: ({ rawEvent }) => rawEvent,
};

// ---------------------------------------------------------------------------
// HubSpot property change
// ---------------------------------------------------------------------------

const hubspotPropertyConfigSchema = z.object({
  /** Which HubSpot object — "deal" covers the Phase 1 use cases. */
  objectType: z.enum(["deal", "contact", "ticket"]),
  /** The property that must change to fire this trigger. */
  propertyName: z.string().min(1),
  /**
   * Optional — if set, only fire when `propertyValue` matches one of these.
   * Leave empty to fire on any change to the named property.
   */
  propertyValuesIn: z.array(z.string()).optional(),
});

export const hubspotPropertyTrigger: AdminWorkflowTrigger<z.infer<typeof hubspotPropertyConfigSchema>> = {
  kind: "HUBSPOT_PROPERTY_CHANGE",
  name: "HubSpot property change",
  description: "Fires when a configured property on a HubSpot deal/contact/ticket changes.",
  configSchema: hubspotPropertyConfigSchema,
  match: ({ config, rawEvent }) => {
    // Incoming shape from HubSpot webhook: { subscriptionType, objectTypeId?, propertyName, propertyValue, objectId }
    const subscriptionType = String(rawEvent.subscriptionType ?? "");
    if (!subscriptionType.startsWith(`${config.objectType}.propertyChange`)) return null;

    const propertyName = String(rawEvent.propertyName ?? "");
    if (propertyName !== config.propertyName) return null;

    const propertyValue = rawEvent.propertyValue == null ? "" : String(rawEvent.propertyValue);
    if (config.propertyValuesIn && config.propertyValuesIn.length > 0) {
      if (!config.propertyValuesIn.includes(propertyValue)) return null;
    }

    return {
      source: "hubspot",
      objectType: config.objectType,
      objectId: String(rawEvent.objectId ?? ""),
      propertyName,
      propertyValue,
    };
  },
};

// ---------------------------------------------------------------------------
// Zuper property change
// ---------------------------------------------------------------------------

const zuperPropertyConfigSchema = z.object({
  objectType: z.enum(["job"]),
  propertyName: z.string().min(1),
  propertyValuesIn: z.array(z.string()).optional(),
});

export const zuperPropertyTrigger: AdminWorkflowTrigger<z.infer<typeof zuperPropertyConfigSchema>> = {
  kind: "ZUPER_PROPERTY_CHANGE",
  name: "Zuper property change",
  description: "Fires when a configured property on a Zuper job changes.",
  configSchema: zuperPropertyConfigSchema,
  match: ({ config, rawEvent }) => {
    // Zuper webhook payload shape varies by event type. We expect the fan-out
    // caller (future: src/app/api/webhooks/zuper/*) to normalize into:
    //   { eventType: "job.updated", objectId, propertyName, propertyValue }
    const eventType = String(rawEvent.eventType ?? "");
    if (!eventType.startsWith(`${config.objectType}.`)) return null;

    const propertyName = String(rawEvent.propertyName ?? "");
    if (propertyName !== config.propertyName) return null;

    const propertyValue = rawEvent.propertyValue == null ? "" : String(rawEvent.propertyValue);
    if (config.propertyValuesIn && config.propertyValuesIn.length > 0) {
      if (!config.propertyValuesIn.includes(propertyValue)) return null;
    }

    return {
      source: "zuper",
      objectType: config.objectType,
      objectId: String(rawEvent.objectId ?? ""),
      propertyName,
      propertyValue,
    };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TRIGGERS: AdminWorkflowTrigger[] = [
  manualTrigger,
  hubspotPropertyTrigger,
  zuperPropertyTrigger,
] as AdminWorkflowTrigger[];

export function getTriggerByKind(
  kind: string,
): AdminWorkflowTrigger | undefined {
  return TRIGGERS.find((t) => t.kind === kind);
}

export function getTriggerPalette() {
  return TRIGGERS.map((t) => ({
    kind: t.kind,
    name: t.name,
    description: t.description,
  }));
}
