import type { CanonicalLocation } from "@/lib/locations";

/**
 * Dashboard-level grouping of canonical locations for the Office Performance TV system.
 *
 * Most of the system tracks each canonical location separately (5 shops). The Office
 * Performance carousel groups them down to 4 by combining SLO + Camarillo into a single
 * "California" view, mirroring how revenue tracking and the install calendar already
 * treat them as one bucket.
 *
 * IMPORTANT: this grouping is scoped to the office-performance dashboard. Do not import
 * these constants into other dashboards, schedulers, exec rollups, or revenue logic — they
 * each track per-canonical numbers and should keep doing so.
 */

export const DASHBOARD_LOCATION_SLUGS = [
  "westminster",
  "centennial",
  "colorado-springs",
  "california",
] as const;

export type DashboardLocationSlug = (typeof DASHBOARD_LOCATION_SLUGS)[number];

export interface DashboardLocationGroup {
  /** URL slug + cache key suffix */
  slug: DashboardLocationSlug;
  /** Display label rendered on the TV dashboard */
  label: string;
  /** Canonical pb_location values that roll into this group */
  canonicals: CanonicalLocation[];
}

export const DASHBOARD_LOCATION_GROUPS: DashboardLocationGroup[] = [
  { slug: "westminster", label: "Westminster", canonicals: ["Westminster"] },
  { slug: "centennial", label: "Centennial", canonicals: ["Centennial"] },
  { slug: "colorado-springs", label: "Colorado Springs", canonicals: ["Colorado Springs"] },
  { slug: "california", label: "California", canonicals: ["San Luis Obispo", "Camarillo"] },
];

const GROUPS_BY_SLUG: Record<string, DashboardLocationGroup> = Object.fromEntries(
  DASHBOARD_LOCATION_GROUPS.map((g) => [g.slug, g])
);

/**
 * Slugs that previously had their own dashboard but now redirect to a combined group.
 * Used by the page to client-side replace the URL and by the API to serve the combined data.
 */
export const LEGACY_SLUG_REDIRECTS: Record<string, DashboardLocationSlug> = {
  "san-luis-obispo": "california",
  "camarillo": "california",
};

/**
 * Resolves a URL slug (current or legacy) to its dashboard group.
 * Returns null for unknown slugs and for the special "all" slug — callers handle those.
 */
export function resolveDashboardGroup(slug: string): DashboardLocationGroup | null {
  const target = LEGACY_SLUG_REDIRECTS[slug] ?? slug;
  return GROUPS_BY_SLUG[target] ?? null;
}

/**
 * True when a slug is a legacy slug that should be redirected at the page level.
 */
export function isLegacySlug(slug: string): slug is keyof typeof LEGACY_SLUG_REDIRECTS {
  return slug in LEGACY_SLUG_REDIRECTS;
}
