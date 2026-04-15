/**
 * Property Detail helpers
 *
 * Builders for the drawer/detail endpoint (see Task 5.1 of the HubSpot Property
 * Object plan). Kept separate from `property-sync.ts` because these helpers are
 * read-only UI adapters — they don't touch HubSpot writes, geocoding, or the
 * rollup cache columns.
 */

import { prisma } from "@/lib/db";
import { fetchLineItemsForDeals } from "@/lib/hubspot";
import { EquipmentCategory } from "@/generated/prisma/enums";

export type OwnershipLabel =
  | "Current Owner"
  | "Previous Owner"
  | "Tenant"
  | "Property Manager"
  | "Authorized Contact";

export interface EquipmentSummary {
  modules: { count: number; totalWattage: number };
  inverters: { count: number };
  batteries: { count: number; totalKwh: number };
  evChargers: { count: number };
}

export interface PropertyDetail {
  id: string;
  hubspotObjectId: string;
  fullAddress: string;
  lat: number;
  lng: number;
  pbLocation: string | null;
  ahjName: string | null;
  utilityName: string | null;

  firstInstallDate: Date | null;
  mostRecentInstallDate: Date | null;
  systemSizeKwDc: number | null;
  hasBattery: boolean;
  hasEvCharger: boolean;
  openTicketsCount: number;
  lastServiceDate: Date | null;
  earliestWarrantyExpiry: Date | null;

  // NOTE: `ownershipLabel` / `associatedAt` describe a specific contact's
  // relationship to the property. The drawer endpoint has no single contact
  // in scope, so we surface the MOST RECENT contact link (order by
  // associatedAt desc, take first). If there are no contact links the
  // property was seeded by a deal/ticket webhook before any contact tied to
  // it; we default to "Current Owner" with `associatedAt = createdAt` so the
  // UI always has a label to render.
  ownershipLabel: OwnershipLabel;
  associatedAt: Date;

  dealIds: string[];
  ticketIds: string[];
  contactIds: string[];

  equipmentSummary: EquipmentSummary;
}

function createEmptySummary(): EquipmentSummary {
  return {
    modules: { count: 0, totalWattage: 0 },
    inverters: { count: 0 },
    batteries: { count: 0, totalKwh: 0 },
    evChargers: { count: 0 },
  };
}

/**
 * Aggregate equipment counts for a set of deals.
 *
 * Classification mirrors `property-sync.ts` rollup: line item → HubSpot product
 * id → `InternalProduct.category`. Line items with no matched InternalProduct
 * are skipped (e.g. freeform "Service Call" items). Wattage comes from
 * `ModuleSpec.wattage` and kWh from `BatterySpec.capacityKwh` so the result
 * aligns with the cached `systemSizeKwDc` rollup.
 */
export async function computeEquipmentSummary(
  dealIds: string[],
): Promise<EquipmentSummary> {
  if (dealIds.length === 0) return createEmptySummary();

  const lineItems = await fetchLineItemsForDeals(dealIds);
  if (lineItems.length === 0) return createEmptySummary();

  const productIds = Array.from(
    new Set(
      lineItems
        .map((li) => li.hubspotProductId)
        .filter((id): id is string => !!id && id.length > 0),
    ),
  );
  if (productIds.length === 0) return createEmptySummary();

  const products = await prisma.internalProduct.findMany({
    where: { hubspotProductId: { in: productIds } },
    select: {
      hubspotProductId: true,
      category: true,
      moduleSpec: { select: { wattage: true } },
      batterySpec: { select: { capacityKwh: true } },
    },
  });

  const byHubspotId = new Map<
    string,
    {
      category: EquipmentCategory;
      wattage: number | null;
      capacityKwh: number | null;
    }
  >();
  for (const p of products) {
    // `hubspotProductId` is nullable on the model, but the `where` clause
    // above filters by `{ in: productIds }` where productIds are non-empty
    // strings, so every row here has a string id. Assert for the type.
    byHubspotId.set(p.hubspotProductId as string, {
      category: p.category,
      wattage: p.moduleSpec?.wattage ?? null,
      capacityKwh: p.batterySpec?.capacityKwh ?? null,
    });
  }

  const summary: EquipmentSummary = {
    modules: { count: 0, totalWattage: 0 },
    inverters: { count: 0 },
    batteries: { count: 0, totalKwh: 0 },
    evChargers: { count: 0 },
  };

  for (const item of lineItems) {
    if (!item.hubspotProductId) continue;
    const match = byHubspotId.get(item.hubspotProductId);
    if (!match) continue;
    const qty = Number(item.quantity) || 0;
    switch (match.category) {
      case EquipmentCategory.MODULE:
        summary.modules.count += qty;
        summary.modules.totalWattage += (match.wattage ?? 0) * qty;
        break;
      case EquipmentCategory.INVERTER:
        summary.inverters.count += qty;
        break;
      case EquipmentCategory.BATTERY:
      case EquipmentCategory.BATTERY_EXPANSION:
        summary.batteries.count += qty;
        summary.batteries.totalKwh += (match.capacityKwh ?? 0) * qty;
        break;
      case EquipmentCategory.EV_CHARGER:
        summary.evChargers.count += qty;
        break;
      default:
        break;
    }
  }

  return summary;
}

/**
 * Coerce a raw label string to the `OwnershipLabel` union. Falls back to
 * "Current Owner" for anything the UI doesn't recognize — the DB allows
 * arbitrary strings, but the UI contract is a fixed enum.
 */
export function normalizeOwnershipLabel(raw: string | null | undefined): OwnershipLabel {
  switch (raw) {
    case "Current Owner":
    case "Previous Owner":
    case "Tenant":
    case "Property Manager":
    case "Authorized Contact":
      return raw;
    default:
      return "Current Owner";
  }
}
