/**
 * Transition shims for the Pueblo office rename (formerly Colorado Springs).
 *
 * Between the app deploy and Zach running
 * `npx tsx scripts/migrate-cosp-to-pueblo.ts --apply`, prod OfficeGoal /
 * snapshot rows still say "Colorado Springs" while all read paths query
 * "Pueblo" — without these shims, goals silently fall back to defaults.
 * Safe to remove once the data migration has been applied.
 */

const PUEBLO = "Pueblo";
export const LEGACY_PUEBLO_LOCATION = "Colorado Springs";

/** Expand a canonical location list so "Pueblo" also matches legacy rows. */
export function expandLegacyPueblo(locations: string[]): string[] {
  if (!locations.includes(PUEBLO) || locations.includes(LEGACY_PUEBLO_LOCATION)) {
    return locations;
  }
  return [...locations, LEGACY_PUEBLO_LOCATION];
}

/**
 * Merge goal rows fetched with an expanded filter: drop legacy
 * "Colorado Springs" rows when a "Pueblo" row exists for the same metric
 * (Pueblo wins); remaining legacy rows stand in for Pueblo. Legacy↔Pueblo is
 * 1:1, so metric-level dedupe is safe even for multi-location groups.
 */
export function dedupeLegacyPuebloGoals<
  T extends { location: string; metric: string },
>(rows: T[]): T[] {
  const puebloMetrics = new Set(
    rows.filter((r) => r.location === PUEBLO).map((r) => r.metric),
  );
  return rows.filter(
    (r) => r.location !== LEGACY_PUEBLO_LOCATION || !puebloMetrics.has(r.metric),
  );
}
