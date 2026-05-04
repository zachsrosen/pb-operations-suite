// src/lib/product-sync-outbound.ts
//
// Thin wrapper around catalog-sync.ts for reverse-imported products.
// After catalog-sync creates external records (or just links existing ones),
// writes cross-link IDs to ALL linked systems — including the source system
// the InternalProduct was originally imported from. Without this, a Zuper
// product discovered by product-sync would never receive its peer Zoho /
// internal IDs, since pushToMissingSystems only creates "missing" records.

import { prisma } from "@/lib/db";
import {
  previewSyncToLinkedSystems,
  executeSyncToLinkedSystems,
  computePreviewHash,
} from "@/lib/catalog-sync";
import type { SyncOutcome } from "@/lib/catalog-sync";
import type { SyncSystem } from "@/lib/catalog-sync-confirmation";
import { writeCrossLinkIds } from "@/lib/catalog-cross-link";

/**
 * Push a newly-imported InternalProduct to the external systems it's missing
 * from, then write cross-link IDs to ALL linked systems.
 *
 * Two paths converge here:
 *   1. New product imported from system A → create in B and C → cross-link all 3
 *   2. Product already linked to all 3 systems → skip creation → still write
 *      cross-links so any newly-discovered IDs land in every system's custom
 *      fields. Important when the source system itself was missing peer IDs.
 *
 * Returns outcomes for each missing system attempted (empty array when nothing
 * was missing — the cross-link write happens regardless).
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

  let outcomes: SyncOutcome[] = [];

  if (missingSystems.length > 0) {
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
      outcomes = result.outcomes;
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

  // Re-read to pick up any external IDs written by createAndLinkExternal
  // during executeSyncToLinkedSystems. Then write cross-link IDs to ALL linked
  // systems — including the source system the product was originally imported
  // from. catalog-cross-link only writes to a system when it has at least one
  // peer ID to share, so this is a no-op when only one system is linked.
  const fresh = await prisma.internalProduct.findUnique({
    where: { id: product.id },
    select: { zohoItemId: true, hubspotProductId: true, zuperItemId: true },
  });

  if (fresh) {
    await writeCrossLinkIds({
      internalProductId: product.id,
      hubspotProductId: fresh.hubspotProductId,
      zohoItemId: fresh.zohoItemId,
      zuperItemId: fresh.zuperItemId,
    }).catch((err) => {
      console.error(
        `[product-sync-outbound] Cross-link write failed for ${internalProductId}:`,
        err,
      );
    });
  }

  return outcomes;
}
