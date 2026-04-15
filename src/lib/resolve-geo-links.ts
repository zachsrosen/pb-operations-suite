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

export async function resolveAhjForProperty(
  input: GeoResolveInput,
): Promise<GeoLinkResult | null> {
  return resolveCustomObjectLink(input, {
    fetchFromDeal: fetchAHJsForDeal,
    fetchAll: fetchAllAHJs,
  });
}

export async function resolveUtilityForProperty(
  input: GeoResolveInput,
): Promise<GeoLinkResult | null> {
  return resolveCustomObjectLink(input, {
    fetchFromDeal: fetchUtilitiesForDeal,
    fetchAll: fetchAllUtilities,
  });
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
