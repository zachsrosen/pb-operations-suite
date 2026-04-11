// src/lib/product-sync-categories.ts
//
// Maps external system category names → internal EquipmentCategory enum values.
// Used by the cross-system product sync to categorize incoming items.

import { CATEGORY_CONFIGS } from "@/lib/catalog-fields";

// ── Zoho category_name → EquipmentCategory ──────────────────────────────────
// Source: live Zoho Inventory data (1,680 items scanned 2026-04-10).
// "category_name" is a flat classification field on Zoho items, distinct from
// "group_name" (hierarchical grouping used by the outbound sync in zoho-taxonomy.ts).

const ZOHO_CATEGORY_MAP: Record<string, string | "skip"> = {
  // Direct matches
  "Module": "MODULE",
  "Inverter": "INVERTER",
  "Tesla": "TESLA_SYSTEM_COMPONENTS",
  "Clamp - Solar": "RACKING",
  "Service": "SERVICE",

  // Electrical sub-categories → ELECTRICAL_BOS
  "Electrical Component": "ELECTRICAL_BOS",
  "Breaker": "ELECTRICAL_BOS",
  "Wire": "ELECTRICAL_BOS",
  "PVC": "ELECTRICAL_BOS",
  "Load Center": "ELECTRICAL_BOS",
  "Coupling": "ELECTRICAL_BOS",
  "Nipple": "ELECTRICAL_BOS",
  "Fuse": "ELECTRICAL_BOS",
  "Locknut": "ELECTRICAL_BOS",
  "Bushing": "ELECTRICAL_BOS",
  "Strap": "ELECTRICAL_BOS",
  "Fastener": "ELECTRICAL_BOS",
  "Screw": "ELECTRICAL_BOS",
  "Clamp - Electrical": "ELECTRICAL_BOS",

  // Skip — not physical inventory
  "Non-inventory": "skip",
};

/**
 * Resolve a Zoho `category_name` to an internal EquipmentCategory enum value.
 * Returns the enum string, `"skip"` for non-inventory items, or `null` if the
 * category can't be resolved (should route to manual review).
 */
export function resolveZohoCategoryName(
  categoryName: string | undefined | null,
): string | null {
  if (!categoryName) return null;
  return ZOHO_CATEGORY_MAP[categoryName] ?? null;
}

// ── HubSpot product_category → EquipmentCategory ────────────────────────────
// Built from CATEGORY_CONFIGS: each config has a `hubspotValue` field.

const HUBSPOT_CATEGORY_MAP: Record<string, string> = {};
for (const [enumValue, config] of Object.entries(CATEGORY_CONFIGS)) {
  if (config.hubspotValue) {
    HUBSPOT_CATEGORY_MAP[config.hubspotValue] = enumValue;
  }
}

/**
 * Resolve a HubSpot `product_category` property value to EquipmentCategory.
 * Returns the enum string or `null` if unrecognized.
 */
export function resolveHubSpotCategory(
  productCategory: string | undefined | null,
): string | null {
  if (!productCategory) return null;
  return HUBSPOT_CATEGORY_MAP[productCategory] ?? null;
}

// ── Zuper category name → EquipmentCategory ─────────────────────────────────
// CANNOT be auto-generated from CATEGORY_CONFIGS because multiple internal
// categories share the same zuperCategory value:
//   "Electrical Hardwire" → ELECTRICAL_BOS, RAPID_SHUTDOWN
//   "Relay Device"        → MONITORING, GATEWAY
//   "Service"             → SERVICE, ADDER_SERVICES, PROJECT_MILESTONES
// Auto-generating would silently overwrite earlier entries with later ones.
// Instead, we use an explicit map where ambiguous categories return null
// (routed to manual review via PendingCatalogPush).

const ZUPER_CATEGORY_MAP: Record<string, string | null> = {
  // Unambiguous 1:1 mappings
  "Module": "MODULE",
  "Inverter": "INVERTER",
  "Battery": "BATTERY",
  "Battery Expansion": "BATTERY_EXPANSION",
  "EV Charger": "EV_CHARGER",
  "Mounting Hardware": "RACKING",
  "Optimizer": "OPTIMIZER",
  "D&R": "D_AND_R",                    // Prisma enum is D_AND_R, not DNR
  "Tesla System Components": "TESLA_SYSTEM_COMPONENTS",

  // Ambiguous — multiple internal categories share this Zuper category.
  // Route to manual review (null) instead of silently picking one.
  "Electrical Hardwire": null,  // ELECTRICAL_BOS or RAPID_SHUTDOWN
  "Relay Device": null,         // MONITORING or GATEWAY
  "Service": null,              // SERVICE, ADDER_SERVICES, or PROJECT_MILESTONES
};

/**
 * Resolve a Zuper product category name to EquipmentCategory.
 * Returns the enum string, or `null` if unrecognized or ambiguous
 * (should route to manual review).
 */
export function resolveZuperCategory(
  categoryName: string | undefined | null,
): string | null {
  if (!categoryName) return null;
  if (categoryName in ZUPER_CATEGORY_MAP) {
    return ZUPER_CATEGORY_MAP[categoryName];
  }
  return null;
}
