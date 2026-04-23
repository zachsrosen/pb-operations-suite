// src/lib/map-aggregator.ts
import { prisma } from "@/lib/db";
import { geocodeAddress as liveGeocode } from "@/lib/travel-time";
import type { JobMarkerAddress } from "./map-types";

export interface ResolvedCoords {
  lat: number;
  lng: number;
  source: "cache" | "live";
}

/**
 * Resolve an address to lat/lng via cascade:
 *   1. HubSpotPropertyCache exact-address match (streetAddress + city + state + zip)
 *   2. Live Google geocode (cached in travel-time.ts for 24h)
 *
 * Returns null when the address is incomplete or geocoding fails.
 */
export async function resolveAddressCoords(
  addr: JobMarkerAddress
): Promise<ResolvedCoords | null> {
  if (!addr.street || !addr.city || !addr.state || !addr.zip) {
    return null;
  }

  // 1. Property cache (use streetAddress — Prisma field name)
  try {
    const cached = await prisma.hubSpotPropertyCache.findFirst({
      where: {
        streetAddress: addr.street,
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
      },
      select: { latitude: true, longitude: true },
    });
    if (cached?.latitude != null && cached?.longitude != null) {
      return { lat: cached.latitude, lng: cached.longitude, source: "cache" };
    }
  } catch {
    // Fall through to live
  }

  // 2. Live geocode
  const full = `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`;
  const point = await liveGeocode(full);
  if (point) return { lat: point.lat, lng: point.lng, source: "live" };

  return null;
}
