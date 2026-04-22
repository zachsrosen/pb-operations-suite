/**
 * Action: Update a HubSpot property.
 *
 * Phase 1 scope: deals only. Contact/ticket variants are follow-up actions
 * that reuse this same pattern.
 *
 * Wraps the existing updateDealProperty() helper. `dealId` comes from either
 * the trigger context (e.g. HUBSPOT_PROPERTY_CHANGE event on that deal) or
 * admin-supplied input (via a template expression — e.g. "{{trigger.dealId}}").
 *
 * Template expressions: the executor resolves `{{trigger.X}}` / `{{previous.step.Y}}`
 * into concrete values before calling handler. For Phase 1 we only wire
 * `{{trigger.dealId}}`, `{{trigger.propertyName}}`, `{{trigger.propertyValue}}`.
 */

import { z } from "zod";

import { updateDealProperty } from "@/lib/hubspot";
import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  dealId: z.string().min(1, "Deal ID is required"),
  propertyName: z.string().min(1, "Property name is required"),
  propertyValue: z.string(),
});

export const updateHubSpotPropertyAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { updated: boolean; dealId: string; property: string }
> = {
  kind: "update-hubspot-property",
  name: "Update HubSpot property",
  description: "Update a single property on a HubSpot deal.",
  category: "HubSpot",
  inputsSchema,
  handler: async ({ inputs }) => {
    const ok = await updateDealProperty(inputs.dealId, {
      [inputs.propertyName]: inputs.propertyValue,
    });
    if (!ok) {
      throw new Error(
        `HubSpot update failed for deal ${inputs.dealId} property ${inputs.propertyName}`,
      );
    }
    return {
      updated: true,
      dealId: inputs.dealId,
      property: inputs.propertyName,
    };
  },
};
