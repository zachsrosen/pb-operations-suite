import { prisma } from "@/lib/db";
import {
  fetchAllAHJs,
  fetchAHJsForDeal,
  fetchAllUtilities,
  fetchUtilitiesForDeal,
} from "@/lib/hubspot-custom-objects";

export interface GeoResolveInput {
  zip: string;
  city: string;
  state: string;
}

export interface GeoLinkResult {
  objectId: string;
  name: string;
}

type CustomObjectRecord = { id: string; properties: Record<string, string | null> };

// ---------------------------------------------------------------------------
// Per-process geo cache
// ---------------------------------------------------------------------------
//
// AHJ and Utility assignments are deterministic from (state, zip) — two
// contacts at different addresses but the same zip+state resolve to the same
// AHJ and the same Utility. During the Property backfill, we hit the same
// zip+state pairs thousands of times; each resolve call without a cache costs
// 5–10 HubSpot custom-object reads and several deal DB queries.
//
// Caching by (state, zip) inside the process gives near-zero overhead for
// repeated lookups and bounds the HubSpot rate-limit burn to O(unique zips)
// instead of O(contacts). Negative results (no match found) are cached too,
// so we don't re-attempt the expensive `fetchAll` fallback for a dead zip.
//
// Lifetime is the process — backfill runs, reconcile cron runs, and Next.js
// serverless invocations each get their own fresh cache. No TTL needed.
//
// Memory bound: ~42k US zip codes × 2 kinds ≈ 84k entries max, <10MB.
const AHJ_CACHE = new Map<string, GeoLinkResult | null>();
const UTILITY_CACHE = new Map<string, GeoLinkResult | null>();

function cacheKey(input: GeoResolveInput): string {
  return `${input.state}:${input.zip}`;
}

export async function resolveAhjForProperty(
  input: GeoResolveInput,
): Promise<GeoLinkResult | null> {
  const key = cacheKey(input);
  if (AHJ_CACHE.has(key)) return AHJ_CACHE.get(key) ?? null;
  const result = await resolveCustomObjectLink(input, {
    fetchFromDeal: fetchAHJsForDeal,
    fetchAll: fetchAllAHJs,
  });
  AHJ_CACHE.set(key, result);
  return result;
}

export async function resolveUtilityForProperty(
  input: GeoResolveInput,
): Promise<GeoLinkResult | null> {
  const key = cacheKey(input);
  if (UTILITY_CACHE.has(key)) return UTILITY_CACHE.get(key) ?? null;
  const result = await resolveCustomObjectLink(input, {
    fetchFromDeal: fetchUtilitiesForDeal,
    fetchAll: fetchAllUtilities,
  });
  UTILITY_CACHE.set(key, result);
  return result;
}

/**
 * Test-only: clear both caches between test runs to prevent cross-test bleed.
 * Production code paths never call this.
 */
export function __resetGeoCacheForTests(): void {
  AHJ_CACHE.clear();
  UTILITY_CACHE.clear();
}

async function resolveCustomObjectLink(
  { zip, city, state }: GeoResolveInput,
  adapters: {
    fetchFromDeal: (dealId: string) => Promise<CustomObjectRecord[]>;
    fetchAll: () => Promise<CustomObjectRecord[]>;
  },
): Promise<GeoLinkResult | null> {
  // 1) Exact-zip deal mining — cheapest & most reliable signal.
  // NOTE: Deal model uses `zipCode` (not `zip`) and has no "DELETED" stage
  // enum (stage is a free-form String). We filter on zipCode + state only.
  const nearbyDeals = await prisma.deal.findMany({
    where: { zipCode: zip, state },
    select: { hubspotDealId: true },
    take: 5,
    orderBy: { lastSyncedAt: "desc" },
  });
  for (const d of nearbyDeals) {
    const linked = await adapters.fetchFromDeal(d.hubspotDealId);
    if (linked.length) {
      return { objectId: linked[0].id, name: linked[0].properties.record_name ?? "" };
    }
  }

  // 2) service_area substring on city name.
  const all = await adapters.fetchAll();
  const cityLower = city.toLowerCase();
  const serviceAreaHit = all.find((r) =>
    (r.properties.service_area ?? "").toLowerCase().includes(cityLower),
  );
  if (serviceAreaHit) {
    return {
      objectId: serviceAreaHit.id,
      name: serviceAreaHit.properties.record_name ?? "",
    };
  }

  // 3) Closest-match by zip within state.
  const closest = await resolveByClosestZip(state, zip, adapters.fetchFromDeal);
  if (closest) return closest;

  // 4) No match — return null.
  return null;
}

async function resolveByClosestZip(
  state: string,
  targetZip: string,
  fetchFromDeal: (dealId: string) => Promise<CustomObjectRecord[]>,
): Promise<GeoLinkResult | null> {
  const targetNum = Number(targetZip);
  if (!Number.isFinite(targetNum)) return null;

  const sameStateDeals = await prisma.deal.findMany({
    where: { state, zipCode: { not: null } },
    select: { hubspotDealId: true, zipCode: true },
    take: 200,
    orderBy: { lastSyncedAt: "desc" },
  });

  const bestByObject = new Map<string, { distance: number; name: string }>();
  for (const d of sameStateDeals) {
    const dZip = Number(d.zipCode);
    if (!Number.isFinite(dZip)) continue;
    const distance = Math.abs(dZip - targetNum);
    const linked = await fetchFromDeal(d.hubspotDealId);
    for (const r of linked) {
      const prior = bestByObject.get(r.id);
      if (!prior || distance < prior.distance) {
        bestByObject.set(r.id, { distance, name: r.properties.record_name ?? "" });
      }
    }
  }

  if (bestByObject.size === 0) return null;

  let winnerId: string | null = null;
  let winner: { distance: number; name: string } | null = null;
  for (const [id, entry] of bestByObject) {
    if (!winner || entry.distance < winner.distance) {
      winnerId = id;
      winner = entry;
    }
  }
  return winner && winnerId ? { objectId: winnerId, name: winner.name } : null;
}
