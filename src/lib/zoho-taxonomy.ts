// src/lib/zoho-taxonomy.ts
//
// Source-of-truth mapping from internal EquipmentCategory enums to live Zoho
// Inventory categories. Values here MUST match what exists in Zoho — do not
// guess from internal labels.
//
// History: this file used to write Zoho `group_name`. A 2026-04-24 audit found
// that field was unused in our prod org (2 of 1717 items). The real field that
// drives Zoho's category UI is `category_name` / `category_id`. This registry
// now writes both the human-readable name and the stable category_id (preferred
// for writes — resilient to renames in Zoho admin).
//
// Status key:
//   confirmed       — verified live category_id; shipped on Zoho writes
//   likely          — candidate match, NOT shipped until promoted to confirmed
//   unresolved      — no Zoho category yet (waiting on admin action); NOT shipped
//   not_applicable  — intentionally has no Zoho category; NOT shipped, no warning

type MappingStatus = "confirmed" | "likely" | "unresolved" | "not_applicable";

interface ZohoCategoryMapping {
  /** Exact Zoho Inventory category name, or undefined if unresolved/not_applicable */
  categoryName: string | undefined;
  /** Zoho category_id (preferred for writes — resilient to renames in Zoho admin) */
  categoryId: string | undefined;
  status: MappingStatus;
  /** Notes for ops review */
  note?: string;
}

/**
 * Internal category enum → Zoho Inventory category.
 *
 * Only `confirmed` entries produce category fields in the Zoho API payload.
 * `likely` / `unresolved` log a warning so ops can track follow-ups.
 * `not_applicable` returns empty silently — those categories intentionally
 * have no Zoho counterpart.
 *
 * Live category IDs pulled from prod Zoho org on 2026-04-24.
 */
export const ZOHO_CATEGORY_MAP: Record<string, ZohoCategoryMapping> = {
  // ── Confirmed ──────────────────────────────────────────────────────────────
  MODULE: {
    categoryName: "Module",
    categoryId: "5385454000001229316",
    status: "confirmed",
  },
  INVERTER: {
    categoryName: "Inverter",
    categoryId: "5385454000001229328",
    status: "confirmed",
  },
  ELECTRICAL_BOS: {
    categoryName: "Electrical Component",
    categoryId: "5385454000001229324",
    status: "confirmed",
  },
  TESLA_SYSTEM_COMPONENTS: {
    categoryName: "Tesla",
    categoryId: "5385454000001229320",
    status: "confirmed",
  },
  SERVICE: {
    categoryName: "Non-inventory",
    categoryId: "5385454000008795730",
    status: "confirmed",
  },
  ADDER_SERVICES: {
    categoryName: "Non-inventory",
    categoryId: "5385454000008795730",
    status: "confirmed",
  },
  PROJECT_MILESTONES: {
    categoryName: "Non-inventory",
    categoryId: "5385454000008795730",
    status: "confirmed",
  },
  RACKING: {
    categoryName: "Solar Component",
    categoryId: "5385454000001289023",
    status: "confirmed",
  },
  MONITORING: {
    categoryName: "Solar Component",
    categoryId: "5385454000001289023",
    status: "confirmed",
  },
  RAPID_SHUTDOWN: {
    categoryName: "Solar Component",
    categoryId: "5385454000001289023",
    status: "confirmed",
  },
  OPTIMIZER: {
    categoryName: "Solar Component",
    categoryId: "5385454000001289023",
    status: "confirmed",
  },
  GATEWAY: {
    categoryName: "Solar Component",
    categoryId: "5385454000001289023",
    status: "confirmed",
  },

  // ── Categories created in Zoho admin via _create-zoho-categories.ts (2026-04-24) ──
  BATTERY: {
    categoryName: "Battery",
    categoryId: "5385454000020010899",
    status: "confirmed",
  },
  BATTERY_EXPANSION: {
    categoryName: "Battery",
    categoryId: "5385454000020010899",
    status: "confirmed",
    note: "Shares Battery category with BATTERY",
  },
  EV_CHARGER: {
    categoryName: "EV Charger",
    categoryId: "5385454000019964645",
    status: "confirmed",
  },

  // ── Not applicable (no Zoho category fits — leave items uncategorized) ─────
  D_AND_R: {
    categoryName: undefined,
    categoryId: undefined,
    status: "not_applicable",
    note: "D&R items aren't tracked discretely in Zoho today",
  },
};

/**
 * Look up the Zoho Inventory category for an internal category enum.
 *
 * Returns IDs/names ONLY for `confirmed` mappings.
 * Returns `{}` for `unresolved` / `not_applicable` / unknown — callers
 * should treat that as "leave Zoho item uncategorized".
 */
export function getZohoCategory(category: string): { categoryId?: string; categoryName?: string } {
  const mapping = ZOHO_CATEGORY_MAP[category];

  if (!mapping) {
    console.warn(
      `[zoho-taxonomy] Unknown category "${category}" — no Zoho category mapping exists. ` +
        `Add it to ZOHO_CATEGORY_MAP in src/lib/zoho-taxonomy.ts.`
    );
    return {};
  }

  // Intentional no-op — these categories have no Zoho counterpart by design.
  if (mapping.status === "not_applicable") return {};

  if (mapping.status === "confirmed") {
    return { categoryId: mapping.categoryId, categoryName: mapping.categoryName };
  }

  // unresolved / likely — log so ops can track
  console.warn(
    `[zoho-taxonomy] Category "${category}" has no confirmed Zoho category (status: ${mapping.status}). ` +
      `Item will be created without a category. ${mapping.note || ""}`
  );
  return {};
}

/**
 * Check whether a category has a confirmed Zoho mapping that will be shipped.
 * Useful for UI hints or pre-submission validation.
 */
export function hasVerifiedZohoMapping(category: string): boolean {
  const mapping = ZOHO_CATEGORY_MAP[category];
  return !!mapping && mapping.status === "confirmed" && !!mapping.categoryId;
}

/**
 * @deprecated Use `getZohoCategory()` instead. The Zoho `group_name` field is
 * effectively unused in our prod org (2 of 1717 items). The real field is
 * `category_name`/`category_id`. This alias remains so callers that haven't
 * migrated keep working — it returns the new categoryName.
 */
export function getZohoGroupName(category: string): string | undefined {
  return getZohoCategory(category).categoryName;
}
