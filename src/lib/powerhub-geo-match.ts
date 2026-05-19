/**
 * PowerHub geo-coordinate matching.
 *
 * Tesla's REST partner API doesn't return site addresses or coordinates, but
 * the GridLogic portal's GraphQL endpoint (`assetGetSiteLocations`) does.
 * That endpoint requires a browser-cookie SSO session, so we can't call it
 * from the backend. Instead, an authenticated user runs the portal's GraphQL
 * query from their browser (via Chrome MCP or the equivalent manual import
 * UI), posts the resulting [{ siteId, lat, lng }] payload to
 * /api/powerhub/import-locations, and the backend does the geo-matching.
 *
 * Distance thresholds:
 *   ≤  25m   → HIGH    auto-link
 *   ≤  50m   → MEDIUM  auto-link
 *   ≤ 100m   → LOW     auto-link (flag for admin review)
 *   > 100m   → no auto-link (admin queue)
 *
 * See: docs/superpowers/specs/2026-05-19-powerhub-geo-linking-design.md
 */

import type { PowerhubLinkConfidence } from "@/generated/prisma/enums";

const EARTH_RADIUS_M = 6_371_000;

const DEG_TO_RAD = Math.PI / 180;

/** Bounding-box pre-filter half-extent in degrees (~110m at the equator). */
export const GEO_PREFILTER_DEG = 0.001;

/** Distance ceilings in meters. */
export const GEO_THRESHOLDS = {
  HIGH: 25,
  MEDIUM: 50,
  LOW: 100,
} as const;

/**
 * Haversine great-circle distance in meters.
 * Standard formula; accurate enough at the meter scale for residential matching.
 */
export function haversineDistanceM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const φ1 = lat1 * DEG_TO_RAD;
  const φ2 = lat2 * DEG_TO_RAD;
  const Δφ = (lat2 - lat1) * DEG_TO_RAD;
  const Δλ = (lng2 - lng1) * DEG_TO_RAD;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Pick the confidence tier for a given distance (meters).
 * Returns null if the distance is beyond the LOW threshold — no auto-link.
 */
export function confidenceForDistance(
  distanceM: number,
): PowerhubLinkConfidence | null {
  if (distanceM <= GEO_THRESHOLDS.HIGH) return "HIGH";
  if (distanceM <= GEO_THRESHOLDS.MEDIUM) return "MEDIUM";
  if (distanceM <= GEO_THRESHOLDS.LOW) return "LOW";
  return null;
}

export interface PropertyCandidate {
  id: string;
  latitude: number;
  longitude: number;
}

export interface GeoMatchResult {
  propertyId: string;
  distanceM: number;
  confidence: PowerhubLinkConfidence;
}

/**
 * Find the nearest property candidate to a site location.
 * Returns null if no candidate is within the LOW threshold.
 *
 * Caller is responsible for passing in pre-filtered candidates (bounding-box
 * narrows the haversine work; this fn just picks the closest).
 */
export function findNearestProperty(
  siteLat: number,
  siteLng: number,
  candidates: readonly PropertyCandidate[],
): GeoMatchResult | null {
  let best: { propertyId: string; distanceM: number } | null = null;
  for (const c of candidates) {
    const d = haversineDistanceM(siteLat, siteLng, c.latitude, c.longitude);
    if (best === null || d < best.distanceM) {
      best = { propertyId: c.id, distanceM: d };
    }
  }
  if (!best) return null;
  const confidence = confidenceForDistance(best.distanceM);
  if (!confidence) return null;
  return {
    propertyId: best.propertyId,
    distanceM: best.distanceM,
    confidence,
  };
}

/**
 * Filter a property candidate list down to those within a bounding box around
 * the target lat/lng. Cheap pre-filter for very large candidate sets — the
 * subsequent haversine loop only runs on this narrowed list.
 */
export function filterByBoundingBox(
  siteLat: number,
  siteLng: number,
  candidates: readonly PropertyCandidate[],
  halfExtentDeg: number = GEO_PREFILTER_DEG,
): PropertyCandidate[] {
  const latMin = siteLat - halfExtentDeg;
  const latMax = siteLat + halfExtentDeg;
  const lngMin = siteLng - halfExtentDeg;
  const lngMax = siteLng + halfExtentDeg;
  return candidates.filter(
    (c) =>
      c.latitude >= latMin &&
      c.latitude <= latMax &&
      c.longitude >= lngMin &&
      c.longitude <= lngMax,
  );
}
