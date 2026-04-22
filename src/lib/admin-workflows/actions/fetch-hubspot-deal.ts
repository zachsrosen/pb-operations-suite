/**
 * Action: Fetch HubSpot deal properties.
 *
 * Lets a workflow read deal data mid-flow. The fetched properties become
 * available to later steps via {{previous.<stepId>.properties.<prop>}}.
 *
 * Use case: trigger fires on a property change with just {objectId},
 * but later steps need the deal's pb_location or dealname too.
 */

import { z } from "zod";

import { getDealProperties } from "@/lib/hubspot";
import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  dealId: z.string().min(1),
  propertyNames: z.string().min(1), // comma-separated
});

export const fetchHubspotDealAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { dealId: string; properties: Record<string, string | null> }
> = {
  kind: "fetch-hubspot-deal",
  name: "Fetch HubSpot deal properties",
  description:
    "Read properties from a HubSpot deal. Values become available to later steps via {{previous.stepId.properties.X}}.",
  category: "HubSpot",
  fields: [
    { key: "dealId", label: "Deal ID", kind: "text", placeholder: "{{trigger.objectId}}", required: true },
    {
      key: "propertyNames",
      label: "Property names (comma-separated)",
      kind: "text",
      placeholder: "dealname, pb_location, system_size_kw",
      required: true,
    },
  ],
  inputsSchema,
  handler: async ({ inputs }) => {
    const props = inputs.propertyNames
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const data = await getDealProperties(inputs.dealId, props);
    if (!data) {
      throw new Error(`HubSpot deal ${inputs.dealId} not found or inaccessible`);
    }
    // Normalize — getDealProperties returns undefined for missing, normalize to null
    const properties: Record<string, string | null> = {};
    for (const key of props) {
      properties[key] = data[key] ?? null;
    }
    return { dealId: inputs.dealId, properties };
  },
};
