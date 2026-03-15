// src/lib/zoho-taxonomy.ts
//
// Source-of-truth mapping from internal EquipmentCategory enums to live Zoho
// Inventory item group names. Values here MUST match what exists in Zoho — do
// not guess from internal labels.
//
// Status key:
//   confirmed  — verified against live Zoho Inventory group list; shipped in API calls
//   likely     — matches user-reported Zoho screenshot; NOT shipped until promoted to confirmed
//   unresolved — no verified Zoho group; NOT shipped in API calls

type MappingStatus = "confirmed" | "likely" | "unresolved";

interface ZohoCategoryMapping {
  /** Exact Zoho Inventory item group name, or undefined if unresolved */
  groupName: string | undefined;
  status: MappingStatus;
  /** Notes for ops review */
  note?: string;
}

/**
 * Internal category enum → Zoho Inventory item group name.
 *
 * Only `confirmed` entries produce a `group_name` in the Zoho API payload.
 * `likely` entries retain their candidate groupName in the map data (so it
 * isn't lost when ops confirms), but `getZohoGroupName()` treats them the
 * same as `unresolved` — returns `undefined` and logs a warning.
 */
export const ZOHO_CATEGORY_MAP: Record<string, ZohoCategoryMapping> = {
  // ── Confirmed ──────────────────────────────────────────────────────────────
  MODULE: {
    groupName: "Module",
    status: "confirmed",
  },
  INVERTER: {
    groupName: "Inverter",
    status: "confirmed",
  },

  // ── Likely (from Zoho screenshots, pending final verification) ─────────────
  TESLA_SYSTEM_COMPONENTS: {
    groupName: "Tesla",
    status: "likely",
    note: "Zoho shows top-level 'Tesla' group, not 'Tesla System Components'",
  },
  ELECTRICAL_BOS: {
    groupName: "Electrical Component",
    status: "likely",
    note: "Zoho shows 'Electrical Component', not 'Electrical Hardware'",
  },
  RAPID_SHUTDOWN: {
    groupName: "Electrical Component",
    status: "likely",
    note: "Shares Zoho group with ELECTRICAL_BOS",
  },

  // ── Unresolved (need ops decision from full Zoho category tree) ────────────
  BATTERY: {
    groupName: undefined,
    status: "unresolved",
    note: "Needs verification — could be 'Battery', 'Energy Storage', or another Zoho group",
  },
  BATTERY_EXPANSION: {
    groupName: undefined,
    status: "unresolved",
    note: "May share group with BATTERY",
  },
  EV_CHARGER: {
    groupName: undefined,
    status: "unresolved",
    note: "Needs verification from Zoho group tree",
  },
  OPTIMIZER: {
    groupName: undefined,
    status: "unresolved",
    note: "Needs verification from Zoho group tree",
  },
  MONITORING: {
    groupName: undefined,
    status: "unresolved",
    note: "Zoho may use 'Relay Device' or 'Monitoring' — needs verification",
  },
  GATEWAY: {
    groupName: undefined,
    status: "unresolved",
    note: "May share group with MONITORING — needs verification",
  },
  RACKING: {
    groupName: undefined,
    status: "unresolved",
    note: "Could be 'Mounting Hardware', 'Racking', or another Zoho group",
  },
  D_AND_R: {
    groupName: undefined,
    status: "unresolved",
    note: "Needs verification — may not have a Zoho group",
  },
  SERVICE: {
    groupName: undefined,
    status: "unresolved",
    note: "Service items may not map to a Zoho inventory group",
  },
  ADDER_SERVICES: {
    groupName: undefined,
    status: "unresolved",
    note: "Service items may not map to a Zoho inventory group",
  },
  PROJECT_MILESTONES: {
    groupName: undefined,
    status: "unresolved",
    note: "Milestones are not physical inventory — likely no Zoho group",
  },
};

/**
 * Look up the Zoho Inventory `group_name` for an internal category enum.
 *
 * Returns the exact Zoho group name ONLY for `confirmed` mappings.
 * Returns `undefined` for `likely`, `unresolved`, or unknown categories,
 * and logs a warning so ops can track which mappings still need verification.
 */
export function getZohoGroupName(category: string): string | undefined {
  const mapping = ZOHO_CATEGORY_MAP[category];

  if (!mapping) {
    console.warn(
      `[zoho-taxonomy] Unknown category "${category}" — no Zoho group_name mapping exists. ` +
        `Add it to ZOHO_CATEGORY_MAP in src/lib/zoho-taxonomy.ts.`
    );
    return undefined;
  }

  if (mapping.status === "confirmed") {
    return mapping.groupName;
  }

  // likely or unresolved — do not ship, log so ops can track
  console.warn(
    `[zoho-taxonomy] Category "${category}" has no confirmed Zoho group_name mapping (status: ${mapping.status}). ` +
      `Item will be created without a group. ${mapping.note || ""}`
  );
  return undefined;
}

/**
 * Check whether a category has a confirmed Zoho mapping that will be shipped.
 * Useful for UI hints or pre-submission validation.
 */
export function hasVerifiedZohoMapping(category: string): boolean {
  const mapping = ZOHO_CATEGORY_MAP[category];
  return !!mapping && mapping.status === "confirmed" && !!mapping.groupName;
}
