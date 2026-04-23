// src/lib/map-proximity.ts
import type { JobMarker, CrewPin } from "./map-types";

const EARTH_RADIUS_MI = 3958.8;

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

export interface NearbyOptions {
  maxMiles?: number;
  limit?: number;
  excludeId?: string;
}

export interface MarkerWithDistance extends JobMarker {
  distanceMiles: number;
}

export function nearbyMarkers(
  origin: LatLng,
  markers: JobMarker[],
  options: NearbyOptions = {}
): MarkerWithDistance[] {
  const { maxMiles = 10, limit = 5, excludeId } = options;
  const result: MarkerWithDistance[] = [];

  for (const m of markers) {
    if (m.id === excludeId) continue;
    const distanceMiles = haversineMiles(origin, m);
    if (distanceMiles <= maxMiles) {
      result.push({ ...m, distanceMiles });
    }
  }

  result.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return result.slice(0, limit);
}

export interface CrewWithDistance extends CrewPin {
  distanceMiles: number;
}

export interface ClosestCrewsOptions {
  maxMiles?: number;
  limit?: number;
}

export function closestCrews(
  origin: LatLng,
  crews: CrewPin[],
  options: ClosestCrewsOptions = {}
): CrewWithDistance[] {
  const { maxMiles = 10, limit = 3 } = options;
  const result: CrewWithDistance[] = [];

  for (const c of crews) {
    if (c.currentLat == null || c.currentLng == null) continue;
    const distanceMiles = haversineMiles(origin, {
      lat: c.currentLat,
      lng: c.currentLng,
    });
    if (distanceMiles <= maxMiles) {
      result.push({ ...c, distanceMiles });
    }
  }

  result.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return result.slice(0, limit);
}
