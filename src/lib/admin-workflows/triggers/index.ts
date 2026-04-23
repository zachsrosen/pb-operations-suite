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

/**
 * Preprocess helper: accept either an array of strings OR a comma-separated
 * string (from the form UI) and coerce to `string[]`. Empty strings and
 * nullish inputs become an empty array. Whitespace is trimmed, blanks dropped.
 */
const commaSeparatedStringsOrArray = z.preprocess((value) => {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    if (value.trim().length === 0) return [];
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return value;
}, z.array(z.string()).optional());

// ---------------------------------------------------------------------------
// Manual
// ---------------------------------------------------------------------------

const manualConfigSchema = z.object({});

export const manualTrigger: AdminWorkflowTrigger<z.infer<typeof manualConfigSchema>> = {
  kind: "MANUAL",
  name: "Manual run",
  description: "Admin clicks 'Run now' from the workflow editor.",
  fields: [],
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
  propertyValuesIn: commaSeparatedStringsOrArray,
});

export const hubspotPropertyTrigger: AdminWorkflowTrigger<z.infer<typeof hubspotPropertyConfigSchema>> = {
  kind: "HUBSPOT_PROPERTY_CHANGE",
  name: "HubSpot property change",
  description: "Fires when a configured property on a HubSpot deal/contact/ticket changes.",
  fields: [
    {
      key: "objectType",
      label: "HubSpot object",
      kind: "select",
      required: true,
      options: [
        { value: "deal", label: "Deal" },
        { value: "contact", label: "Contact" },
        { value: "ticket", label: "Ticket" },
      ],
    },
    {
      key: "propertyName",
      label: "Property to watch",
      kind: "text",
      placeholder: "dealstage",
      required: true,
      help: "Property name (e.g. dealstage, pb_location, hs_pipeline_stage). Case-sensitive.",
    },
    {
      key: "propertyValuesIn",
      label: "Only fire when value is one of",
      kind: "multiselect",
      help:
        "Leave blank to fire on any change. Pick from real HubSpot values where known " +
        "(deal+dealstage, ticket+hs_pipeline_stage, ticket+hs_ticket_priority, " +
        "contact+lifecyclestage/hs_lead_status). For other properties, use 'Add custom value'.",
      optionsFrom:
        "/api/admin/workflows/hubspot-property-options?objectType={{objectType}}&propertyName={{propertyName}}",
    },
  ],
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
  propertyValuesIn: commaSeparatedStringsOrArray,
});

export const zuperPropertyTrigger: AdminWorkflowTrigger<z.infer<typeof zuperPropertyConfigSchema>> = {
  kind: "ZUPER_PROPERTY_CHANGE",
  name: "Zuper property change",
  description: "Fires when a configured property on a Zuper job changes.",
  fields: [
    {
      key: "objectType",
      label: "Zuper object",
      kind: "select",
      required: true,
      options: [{ value: "job", label: "Job" }],
    },
    {
      key: "propertyName",
      label: "Property to watch",
      kind: "text",
      placeholder: "status",
      required: true,
      help: "Zuper custom field name or core property (e.g. status, category, assigned_to).",
    },
    {
      key: "propertyValuesIn",
      label: "Only fire when value is one of",
      kind: "multiselect",
      help:
        "Leave blank to fire on any change. Known Zuper values shown for common fields (status / category / priority). For custom fields, use 'Add custom value'.",
      optionsFrom: "/api/admin/workflows/zuper-property-options?propertyName={{propertyName}}",
    },
  ],
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
// Cron
// ---------------------------------------------------------------------------

const cronConfigSchema = z.object({
  /** Standard 5-field cron expression in UTC. Minute-level precision. */
  expression: z.string().min(3),
});

export const cronTrigger: AdminWorkflowTrigger<z.infer<typeof cronConfigSchema>> = {
  kind: "CRON",
  name: "Scheduled (cron)",
  description: "Fire on a cron schedule (UTC). Minute-level precision.",
  fields: [
    {
      key: "expression",
      label: "Cron expression (UTC)",
      kind: "text",
      placeholder: "0 9 * * 1-5",
      help:
        "5 fields: minute hour day month day-of-week. Examples: '0 * * * *' = every hour; '0 9 * * 1-5' = 9am UTC weekdays; '*/15 * * * *' = every 15m.",
      required: true,
    },
  ],
  configSchema: cronConfigSchema,
  match: ({ rawEvent }) => {
    // The cron dispatcher pre-filters by schedule match, so this just
    // returns the rawEvent (containing firedAt) as triggerContext.
    return rawEvent;
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TRIGGERS: AdminWorkflowTrigger[] = [
  manualTrigger,
  hubspotPropertyTrigger,
  zuperPropertyTrigger,
  cronTrigger,
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
