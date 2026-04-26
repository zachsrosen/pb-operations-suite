/**
 * Catalog Cross-Link Writer
 *
 * After a product is created or updated in any combination of HubSpot / Zoho / Zuper,
 * write each system's ID into the others' custom-fields/properties so any record can
 * navigate to its siblings.
 *
 * Used by:
 *   - executeCatalogPushApproval (wizard / BOM approval path)
 *   - executePlan (Sync Modal path) — added in Milestone 2 Task 2.2
 *
 * All writes are best-effort: a failure on one system surfaces in the warnings array
 * but does not throw or block the other writes.
 */
import { zohoInventory } from "@/lib/zoho-inventory";
import { updateZuperPart, buildZuperProductCustomFields } from "@/lib/zuper-catalog";

export interface CrossLinkInput {
  internalProductId?: string | null;
  hubspotProductId?: string | null;
  zohoItemId?: string | null;
  zuperItemId?: string | null;
}

export interface CrossLinkResult {
  attempted: Array<"zoho" | "zuper" | "hubspot">;
  warnings: string[];
}

export async function writeCrossLinkIds(input: CrossLinkInput): Promise<CrossLinkResult> {
  const result: CrossLinkResult = { attempted: [], warnings: [] };
  const { internalProductId, hubspotProductId, zohoItemId, zuperItemId } = input;

  const otherIdsForZoho = !!(zuperItemId || hubspotProductId || internalProductId);
  const otherIdsForZuper = !!(hubspotProductId || zohoItemId || internalProductId);
  const otherIdsForHubSpot = !!(zuperItemId || zohoItemId || internalProductId);

  // Zoho cross-link
  if (zohoItemId && otherIdsForZoho) {
    result.attempted.push("zoho");
    try {
      const customFields: Array<{ api_name: string; value: string }> = [];
      if (zuperItemId) customFields.push({ api_name: "cf_zuper_product_id", value: zuperItemId });
      if (hubspotProductId) customFields.push({ api_name: "cf_hubspot_product_id", value: hubspotProductId });
      if (internalProductId) customFields.push({ api_name: "cf_internal_product_id", value: internalProductId });
      const out = await zohoInventory.updateItem(zohoItemId, { custom_fields: customFields });
      if (out.status !== "updated") {
        result.warnings.push(`Zoho cross-link returned ${out.status}: ${out.message || "unknown"}`);
      }
    } catch (err) {
      result.warnings.push(`Zoho cross-link threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Zuper cross-link
  if (zuperItemId && otherIdsForZuper) {
    result.attempted.push("zuper");
    try {
      const customFields = buildZuperProductCustomFields({
        hubspotProductId,
        zohoItemId,
        internalProductId,
      });
      if (customFields) {
        const out = await updateZuperPart(zuperItemId, { custom_fields: customFields });
        if (out.status !== "updated") {
          result.warnings.push(`Zuper cross-link returned ${out.status}: ${out.message || "unknown"}`);
        }
      }
    } catch (err) {
      result.warnings.push(`Zuper cross-link threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // HubSpot cross-link
  if (hubspotProductId && otherIdsForHubSpot) {
    result.attempted.push("hubspot");
    try {
      const props: Record<string, string> = {};
      if (zuperItemId) props.zuper_item_id = zuperItemId;
      if (zohoItemId) props.zoho_item_id = zohoItemId;
      if (internalProductId) props.internal_product_id = internalProductId;
      const token = process.env.HUBSPOT_ACCESS_TOKEN;
      if (token && Object.keys(props).length > 0) {
        const res = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${hubspotProductId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ properties: props }),
        });
        if (!res.ok) {
          result.warnings.push(`HubSpot cross-link PATCH returned ${res.status}`);
        }
      }
    } catch (err) {
      result.warnings.push(`HubSpot cross-link threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
