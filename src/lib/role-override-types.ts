import type { LandingCard } from "@/lib/roles";

/**
 * Sparse payload shape for a RoleDefinitionOverride row's `override` JSONB
 * column. Each key is optional; a present key (including empty arrays)
 * means "replace the code default with this value." An absent key means
 * "inherit the code default from src/lib/roles.ts."
 *
 * Resolver: src/lib/role-resolution.ts
 * Writer: PUT /api/admin/roles/[role]/definition
 * Reader (editor): src/app/admin/roles/RoleDefinitionEditor.tsx
 */
export interface RoleDefinitionOverridePayload {
  label?: string;
  description?: string;
  visibleInPicker?: boolean;
  suites?: string[];
  allowedRoutes?: string[];
  landingCards?: LandingCard[];
  scope?: "global" | "location" | "owner";
  badge?: { color?: string; abbrev?: string };
}

/**
 * The full set of badge color values accepted by the guards + surfaced by
 * the editor's swatch picker. Must stay in sync with the Tailwind color
 * families used in src/app/admin/roles/page.tsx's BADGE_COLOR_CLASSES map.
 */
export const BADGE_COLOR_OPTIONS = [
  "red",
  "amber",
  "orange",
  "yellow",
  "emerald",
  "teal",
  "cyan",
  "indigo",
  "purple",
  "zinc",
  "slate",
] as const;

export type BadgeColor = (typeof BADGE_COLOR_OPTIONS)[number];

/**
 * The full set of suite hrefs the editor offers as checkbox options. Mirrors
 * the 8 suite directories under src/app/suites/. New suites must be added
 * here AND to src/lib/suite-nav.ts's canonical list.
 */
export const SUITE_OPTIONS = [
  "/suites/operations",
  "/suites/design-engineering",
  "/suites/permitting-interconnection",
  "/suites/service",
  "/suites/dnr-roofing",
  "/suites/intelligence",
  "/suites/executive",
  "/suites/accounting",
] as const;

export const SCOPE_VALUES = ["global", "location", "owner"] as const;

export type ScopeValue = (typeof SCOPE_VALUES)[number];

/** Per-field length / size limits enforced by the guards + UI. */
export const LABEL_MAX_LEN = 40;
export const DESCRIPTION_MAX_LEN = 200;
export const BADGE_ABBREV_MAX_LEN = 16;
export const LANDING_CARDS_MAX = 10;

/** Shape of a single guard violation returned by validateRoleEdit. */
export interface GuardViolation {
  field:
    | "suites"
    | "allowedRoutes"
    | "landingCards"
    | "scope"
    | "badge"
    | "label"
    | "description"
    | "visibleInPicker";
  message: string;
}
