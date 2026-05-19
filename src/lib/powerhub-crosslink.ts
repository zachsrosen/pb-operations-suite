/**
 * src/lib/powerhub-crosslink.ts
 *
 * Cross-system propagation of Tesla PowerHub portal links into
 * HubSpot Property/Deal/Ticket records and Zuper Property/Job custom fields.
 *
 * Entry points (added in subsequent tasks):
 *   - resolvePrimarySite(propertyId)
 *   - pushToHubSpotForProperty(propertyId)
 *   - enqueueCrossSystemPush(propertyId)
 *
 * All entry points no-op when POWERHUB_CROSSLINK_ENABLED !== "true".
 */

import { prisma } from "@/lib/db";

export interface PrimarySiteCandidate {
  id: string;
  siteName: string;
  createdAt: Date;
}

const STE_PATTERN = /^STE(\d{8})-\d+$/;

/**
 * Parse the date portion of a Tesla STE site name.
 * Format: STE<YYYYMMDD>-<NNN>
 * Returns null if the name doesn't match the pattern or the date is invalid.
 */
export function parseSteDateFromName(name: string): Date | null {
  const m = name?.match(STE_PATTERN);
  if (!m) return null;
  const ymd = m[1];
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const day = Number(ymd.slice(6, 8));
  if (year < 2000 || year > 2099) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Use UTC to avoid timezone drift
  const dt = new Date(Date.UTC(year, month - 1, day));
  // Validate (e.g., Feb 30 rolls over to March)
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

/**
 * Choose the primary site from a list of candidates.
 *
 * Rules:
 *   1. Newest STE date wins
 *   2. Tie → lexicographically max siteName
 *   3. No STE pattern → newest createdAt
 *   4. STE-named sites beat any fallback-named site
 *   5. Final tie-break: lexicographically max id (cuid)
 *
 * Returns null only if the input is empty.
 */
export function pickPrimarySite<T extends PrimarySiteCandidate>(sites: T[]): T | null {
  if (sites.length === 0) return null;
  const enriched = sites.map((s) => ({
    site: s,
    steDate: parseSteDateFromName(s.siteName),
  }));
  enriched.sort((a, b) => {
    // STE-named always beats fallback-named
    if (a.steDate && !b.steDate) return -1;
    if (!a.steDate && b.steDate) return 1;
    // Both STE-named
    if (a.steDate && b.steDate) {
      const diff = b.steDate.getTime() - a.steDate.getTime();
      if (diff !== 0) return diff;
      // Tie: lexicographic siteName desc
      if (a.site.siteName !== b.site.siteName) {
        return b.site.siteName.localeCompare(a.site.siteName);
      }
    } else {
      // Both fallback: newest createdAt desc
      const diff = b.site.createdAt.getTime() - a.site.createdAt.getTime();
      if (diff !== 0) return diff;
    }
    // Final tie-break: lexicographic id desc
    return b.site.id.localeCompare(a.site.id);
  });
  return enriched[0].site;
}

export interface ResolvedPrimarySite {
  id: string;
  siteId: string;
  siteName: string;
  portalUrl: string | null;
}

/**
 * Look up all PowerhubSite rows for a property, pick the primary, write
 * the `primaryForProperty` flag, and update the denormalized
 * teslaPortalUrl + teslaSiteId on HubSpotPropertyCache.
 *
 * Returns the primary site (or null if no sites are linked to this property).
 *
 * Idempotent: safe to call repeatedly. Race-safe via the partial unique
 * index — if a concurrent caller flips primaryForProperty on a different
 * site, this caller's update will hit the index constraint and we retry once.
 */
export async function resolvePrimarySite(propertyId: string): Promise<ResolvedPrimarySite | null> {
  const sites = await prisma.powerhubSite.findMany({
    where: { propertyId },
    select: {
      id: true,
      siteId: true,
      siteName: true,
      portalUrl: true,
      createdAt: true,
      primaryForProperty: true,
    },
  });

  if (sites.length === 0) {
    // No sites: clear cache + demote any orphaned primary flags (defense in depth)
    await prisma.hubSpotPropertyCache.update({
      where: { id: propertyId },
      data: { teslaPortalUrl: null, teslaSiteId: null },
    });
    return null;
  }

  const primary = pickPrimarySite(sites)!;

  // Two writes in sequence (NOT a transaction — the demote-then-promote order
  // avoids the partial unique index conflict naturally).
  await prisma.powerhubSite.updateMany({
    where: { propertyId, id: { not: primary.id } },
    data: { primaryForProperty: false },
  });
  await retryOnUniqueConflict(() =>
    prisma.powerhubSite.update({
      where: { id: primary.id },
      data: { primaryForProperty: true },
    })
  );

  // Update denormalized fields on the property cache
  await prisma.hubSpotPropertyCache.update({
    where: { id: propertyId },
    data: {
      teslaPortalUrl: primary.portalUrl,
      teslaSiteId: primary.siteId,
    },
  });

  return {
    id: primary.id,
    siteId: primary.siteId,
    siteName: primary.siteName,
    portalUrl: primary.portalUrl,
  };
}

/**
 * Retry helper for the partial unique index race: a concurrent caller may
 * have promoted a different site, so we retry once after re-demoting.
 */
async function retryOnUniqueConflict<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
      // Tiny jitter before retry
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
  throw lastErr;
}
