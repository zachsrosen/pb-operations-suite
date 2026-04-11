// src/lib/product-sync-outbound.ts
//
// Thin wrapper around catalog-sync.ts for reverse-imported products.
// After catalog-sync creates external records, this module writes cross-link
// custom fields using the correct payload format for each external system.

import { prisma } from "@/lib/db";
import {
  previewSyncToLinkedSystems,
  executeSyncToLinkedSystems,
  computePreviewHash,
} from "@/lib/catalog-sync";
import type { SyncOutcome } from "@/lib/catalog-sync";
import type { SyncSystem } from "@/lib/catalog-sync-confirmation";

/**
 * After catalog-sync creates an external record, write cross-link custom
 * fields (internal product ID + peer external IDs) to the new record.
 *
 * Each system has a different custom field payload format:
 * - Zoho: custom_fields array of { api_name, value }
 * - HubSpot: flat properties object
 * - Zuper: { custom_fields: buildZuperProductCustomFields(...) }
 *
 * Failures are logged but do not block the sync.
 */
async function setCrossLinkFields(
  product: {
    id: string;
    zohoItemId: string | null;
    hubspotProductId: string | null;
    zuperItemId: string | null;
  },
  outcomes: SyncOutcome[],
): Promise<void> {
  // Re-read the product to get freshly-linked external IDs
  // (catalog-sync sets these via guarded writes after creation)
  const fresh = await prisma.internalProduct.findUnique({
    where: { id: product.id },
    select: { zohoItemId: true, hubspotProductId: true, zuperItemId: true },
  });
  if (!fresh) return;

  for (const outcome of outcomes) {
    if (outcome.status !== "created" || !outcome.externalId) continue;

    try {
      if (outcome.system === "zoho") {
        // Zoho custom fields use array of { api_name, value } objects
        const { updateZohoItem } = await import("@/lib/zoho-inventory");
        const customFields: Array<{ api_name: string; value: string }> = [
          { api_name: "cf_internal_product_id", value: product.id },
        ];
        if (fresh.hubspotProductId) {
          customFields.push({ api_name: "cf_hubspot_product_id", value: fresh.hubspotProductId });
        }
        if (fresh.zuperItemId) {
          customFields.push({ api_name: "cf_zuper_product_id", value: fresh.zuperItemId });
        }
        await updateZohoItem(outcome.externalId, { custom_fields: customFields });

      } else if (outcome.system === "hubspot") {
        // HubSpot uses flat properties
        const { updateHubSpotProduct } = await import("@/lib/hubspot");
        const properties: Record<string, string> = {
          internal_product_id: product.id,
        };
        if (fresh.zohoItemId) properties.zoho_item_id = fresh.zohoItemId;
        if (fresh.zuperItemId) properties.zuper_item_id = fresh.zuperItemId;
        await updateHubSpotProduct(outcome.externalId, properties);

      } else if (outcome.system === "zuper") {
        // Zuper uses buildZuperProductCustomFields helper
        const { updateZuperPart, buildZuperProductCustomFields } = await import("@/lib/zuper-catalog");
        const customFields = buildZuperProductCustomFields({
          internalProductId: product.id,
          hubspotProductId: fresh.hubspotProductId,
          zohoItemId: fresh.zohoItemId,
        });
        if (customFields) {
          await updateZuperPart(outcome.externalId, { custom_fields: customFields });
        }
      }
    } catch (error) {
      console.error(
        `[product-sync-outbound] Failed to set cross-link on ${outcome.system} ${outcome.externalId}:`,
        error,
      );
    }
  }
}

/**
 * Push a newly-imported InternalProduct to the external systems it's missing from.
 * For example, if the product was imported from Zoho, push to HubSpot + Zuper.
 * After creation, writes cross-link custom fields (with correct payload shapes)
 * and peer external IDs to the new records.
 *
 * Returns outcomes for each system attempted.
 */
export async function pushToMissingSystems(
  internalProductId: string,
): Promise<SyncOutcome[]> {
  const product = await prisma.internalProduct.findUnique({
    where: { id: internalProductId },
    include: {
      moduleSpec: true,
      inverterSpec: true,
      batterySpec: true,
      evChargerSpec: true,
      mountingHardwareSpec: true,
      electricalHardwareSpec: true,
      relayDeviceSpec: true,
    },
  });

  if (!product) return [];

  // Determine which systems are missing
  const missingSystems: SyncSystem[] = [];
  if (!product.zohoItemId) missingSystems.push("zoho");
  if (!product.hubspotProductId) missingSystems.push("hubspot");
  if (!product.zuperItemId) missingSystems.push("zuper");

  if (missingSystems.length === 0) return [];

  // Build SkuRecord shape expected by catalog-sync
  const sku = {
    id: product.id,
    category: product.category,
    brand: product.brand,
    model: product.model,
    name: product.name,
    description: product.description,
    sku: product.sku,
    unitCost: product.unitCost,
    sellPrice: product.sellPrice,
    unitSpec: product.unitSpec,
    unitLabel: product.unitLabel,
    vendorName: product.vendorName,
    vendorPartNumber: product.vendorPartNumber,
    hardToProcure: product.hardToProcure,
    length: product.length,
    width: product.width,
    weight: product.weight,
    hubspotProductId: product.hubspotProductId,
    zuperItemId: product.zuperItemId,
    zohoItemId: product.zohoItemId,
    zohoVendorId: product.zohoVendorId,
    // Pass actual spec relation fields so catalog-sync's getSpecData() can
    // read them via sku[CATEGORY_CONFIGS[category].specTable] (e.g. sku.moduleSpec).
    // A generic "specData" property would be ignored by catalog-sync.
    moduleSpec: product.moduleSpec,
    inverterSpec: product.inverterSpec,
    batterySpec: product.batterySpec,
    evChargerSpec: product.evChargerSpec,
    mountingHardwareSpec: product.mountingHardwareSpec,
    electricalHardwareSpec: product.electricalHardwareSpec,
    relayDeviceSpec: product.relayDeviceSpec,
  };

  try {
    const previews = await previewSyncToLinkedSystems(
      sku as Parameters<typeof previewSyncToLinkedSystems>[0],
      missingSystems,
    );
    const hash = computePreviewHash(previews);
    const result = await executeSyncToLinkedSystems(
      sku as Parameters<typeof executeSyncToLinkedSystems>[0],
      hash,
      missingSystems,
    );

    // Post-create: write cross-link custom fields + peer IDs to new records
    await setCrossLinkFields(product, result.outcomes);

    return result.outcomes;
  } catch (error) {
    console.error(
      `[product-sync-outbound] Failed to push product ${internalProductId} to ${missingSystems.join(", ")}:`,
      error,
    );
    return missingSystems.map((system) => ({
      system,
      externalId: "",
      status: "failed" as const,
      message: error instanceof Error ? error.message : "Unknown error",
    }));
  }
}
