// src/lib/zuper-categories.ts
//
// Pure Zuper job-category constants. Deliberately FREE of any Prisma / DB / Node
// imports so client components (e.g. the construction scheduler) can import these
// without dragging the Prisma client into the browser bundle. `@/lib/zuper`
// re-exports everything here for back-compat — import from there for server code,
// and from here (or via a type-only path) when the consumer is client-side.

// Job categories mapping for PB workflows - using Zuper category UIDs
// These UIDs are specific to the photonbrothers Zuper account
export const JOB_CATEGORY_UIDS = {
  SITE_SURVEY: "002bac33-84d3-4083-a35d-50626fc49288",
  PRE_SALE_SITE_VISIT: "c53070e5-63fd-41bc-8803-f66ad842dbb5",
  CONSTRUCTION: "6ffbc218-6dad-4a46-b378-1fb02b3ab4bf",
  SOLAR_INSTALL: process.env.ZUPER_CATEGORY_SOLAR_INSTALL ?? "",
  BATTERY_INSTALL: process.env.ZUPER_CATEGORY_BATTERY_INSTALL ?? "",
  EV_INSTALL: process.env.ZUPER_CATEGORY_EV_INSTALL ?? "",
  INSPECTION: "b7dc03d2-25d0-40df-a2fc-b1a477b16b65",
  SERVICE_VISIT: "cff6f839-c043-46ee-a09f-8d0e9f363437",
  SERVICE_REVISIT: "8a29a1c0-9141-4db6-b8bb-9d9a65e2a1de",
  ADDITIONAL_VISIT: "d83c054f-69c1-470c-964c-2b79e88258f4",
  DETACH: "d9d888a1-efc3-4f01-a8d6-c9e867374d71",
  RESET: "43df49e9-3835-48f2-80ca-cc77ad7c3f0d",
  FIRE_INSPECTION: "906c3b52-6799-408c-9a44-2a6f6581769d",
  DNR_INSPECTION: "a5e54b76-8b79-4cd7-a960-bad53d24e1c5",
  WALK_ROOF: "b3289bad-d618-47c7-b592-43454b655982",
  MID_ROOF_INSTALL: "18f08c0d-f767-4e4a-8970-7c67597f4b4a",
  ROOF_FINAL: "92caf51d-1a53-4679-9b64-ba316ccb870d",
} as const;

// Human-readable category names (for display/logging)
export const JOB_CATEGORIES = {
  SITE_SURVEY: "Site Survey",
  PRE_SALE_SITE_VISIT: "Pre-Sale Site Visit",
  CONSTRUCTION: "Construction",
  SOLAR_INSTALL: "Construction - Solar",
  BATTERY_INSTALL: "Construction - Battery",
  EV_INSTALL: "Construction - EV",
  INSPECTION: "Inspection",
  SERVICE_VISIT: "Service Visit",
  SERVICE_REVISIT: "Service Revisit",
  ADDITIONAL_VISIT: "Additional Visit",
  DETACH: "Detach",
  RESET: "Reset",
  FIRE_INSPECTION: "Fire Inspection",
  DNR_INSPECTION: "D&R Inspection",
  WALK_ROOF: "Walk Roof",
  MID_ROOF_INSTALL: "Mid Roof Install",
  ROOF_FINAL: "Roof Final",
} as const;

/**
 * Feature flag: when true, the codebase treats all four construction-category
 * UIDs/names as construction work. When false, only the legacy CONSTRUCTION
 * category counts (rollback path).
 *
 * Default true. Flip to "false" in Vercel env to roll back without redeploying.
 */
export const CONSTRUCTION_JOB_SPLIT_ENABLED =
  process.env.CONSTRUCTION_JOB_SPLIT_ENABLED !== "false";

/** All Zuper category UIDs that count as construction work. Honors the feature flag. */
export const CONSTRUCTION_CATEGORY_UIDS: readonly string[] = CONSTRUCTION_JOB_SPLIT_ENABLED
  ? [
      JOB_CATEGORY_UIDS.CONSTRUCTION,
      JOB_CATEGORY_UIDS.SOLAR_INSTALL,
      JOB_CATEGORY_UIDS.BATTERY_INSTALL,
      JOB_CATEGORY_UIDS.EV_INSTALL,
    ].filter((uid): uid is string => Boolean(uid))
  : ([JOB_CATEGORY_UIDS.CONSTRUCTION] as string[]).filter((uid): uid is string => Boolean(uid));

/** All display names that count as construction work. Honors the feature flag. */
export const CONSTRUCTION_CATEGORY_NAMES: readonly string[] = CONSTRUCTION_JOB_SPLIT_ENABLED
  ? [
      JOB_CATEGORIES.CONSTRUCTION,
      JOB_CATEGORIES.SOLAR_INSTALL,
      JOB_CATEGORIES.BATTERY_INSTALL,
      JOB_CATEGORIES.EV_INSTALL,
    ]
  : [JOB_CATEGORIES.CONSTRUCTION];
