/**
 * Property Sync Orchestration
 *
 * Coordinates the contact-→-Property flow: geocode → find-or-create → associate
 * → upsert cache → rollups. The public entry points are webhook/cron friendly
 * and return a small `SyncOutcome` shape describing what happened.
 *
 * Feature flag: `PROPERTY_SYNC_ENABLED=true` gates all public entry points.
 * Rollout plan ships with the flag OFF until the backfill run completes.
 *
 * Only `onContactAddressChange` is fully implemented in this module — the
 * other exports are stubs that later tasks will fill in (see plan
 * `docs/superpowers/plans/2026-04-14-hubspot-property-object.md` Tasks 2.5–3.2).
 */

import { prisma } from "@/lib/db";
import { geocodeAddress, type GeocodeResult } from "@/lib/geocode";
import { addressHash } from "@/lib/address-hash";
import {
  createProperty,
  associateProperty,
} from "@/lib/hubspot-property";
import { fetchContactById } from "@/lib/hubspot";
import {
  resolveAhjForProperty,
  resolveUtilityForProperty,
} from "@/lib/resolve-geo-links";
import { resolvePbLocationFromAddress } from "@/lib/locations";
import {
  AHJ_OBJECT_TYPE,
  UTILITY_OBJECT_TYPE,
} from "@/lib/hubspot-custom-objects";
import type { ActivityType } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SyncStatus = "created" | "associated" | "skipped" | "deferred" | "failed";

export interface SyncOutcome {
  status: SyncStatus;
  propertyCacheId?: string;
  reason?: string;
}

export interface ReconcileStats {
  processed: number;
  drifted: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * HubSpot association typeIds for Contact → Property labeled associations.
 * Populate at deploy time; the `create-hubspot-property-object` script prints
 * the IDs after portal bootstrap. Kept in env so sandbox and prod can diverge.
 */
const CONTACT_LABEL_ASSOCIATION_IDS = {
  CURRENT_OWNER: Number(process.env.HUBSPOT_PROPERTY_CONTACT_ASSOC_CURRENT_OWNER ?? 0),
};

const COALESCE_WINDOW_MS = 2_000;

function isFeatureEnabled(): boolean {
  return process.env.PROPERTY_SYNC_ENABLED === "true";
}

// ---------------------------------------------------------------------------
// onContactAddressChange — the main entry for contact webhook handlers
// ---------------------------------------------------------------------------

export async function onContactAddressChange(contactId: string): Promise<SyncOutcome> {
  if (!isFeatureEnabled()) {
    return { status: "skipped", reason: "feature flag off" };
  }

  // 1) Coalesce bursty webhooks. HubSpot fans out one change into many events.
  const watermark = await prisma.propertySyncWatermark.findUnique({ where: { contactId } });
  if (watermark && Date.now() - watermark.lastSyncAt.getTime() < COALESCE_WINDOW_MS) {
    return { status: "skipped", reason: "coalesced" };
  }

  // 2) Fetch contact from HubSpot (pulls the address component fields only).
  const contact = await fetchContactById(contactId, [
    "address",
    "address2",
    "city",
    "state",
    "zip",
    "country",
  ]);
  if (!contact) return { status: "skipped", reason: "contact not found" };

  const p = contact.properties;
  if (!p.address || !p.city || !p.state || !p.zip) {
    return { status: "skipped", reason: "address incomplete" };
  }

  // 3) Geocode — Google Maps resolution gives us place_id + structured parts.
  const geo = await geocodeAddress({
    street: p.address,
    unit: p.address2,
    city: p.city,
    state: p.state,
    zip: p.zip,
    country: p.country ?? "USA",
  });
  if (!geo) {
    await logActivity("PROPERTY_SYNC_FAILED", "Geocode failed for contact", {
      contactId,
      reason: "geocode miss",
    });
    return { status: "failed", reason: "geocode failed" };
  }

  // 4) Dedup — cache lookup by place_id (preferred) or address hash fallback.
  const hash = addressHash({
    street: geo.streetAddress,
    unit: p.address2,
    city: geo.city,
    state: geo.state,
    zip: geo.zip,
  });

  const existing = geo.placeId
    ? await prisma.hubSpotPropertyCache.findUnique({
        where: { googlePlaceId: geo.placeId },
      })
    : await prisma.hubSpotPropertyCache.findUnique({ where: { addressHash: hash } });

  let result: { propertyCacheId: string; hubspotObjectId: string; created: boolean };
  if (existing) {
    result = {
      propertyCacheId: existing.id,
      hubspotObjectId: existing.hubspotObjectId,
      created: false,
    };
  } else {
    result = await createNewProperty({ geo, hash, unit: p.address2 });
  }

  // 5) Associate Property → Contact with the "Current Owner" label and mirror
  //    the association in the local PropertyContactLink table for fast reads.
  await associateProperty(
    result.hubspotObjectId,
    "contacts",
    contactId,
    CONTACT_LABEL_ASSOCIATION_IDS.CURRENT_OWNER,
  );
  await prisma.propertyContactLink.upsert({
    where: {
      propertyId_contactId_label: {
        propertyId: result.propertyCacheId,
        contactId,
        label: "Current Owner",
      },
    },
    create: {
      propertyId: result.propertyCacheId,
      contactId,
      label: "Current Owner",
    },
    update: {},
  });

  // 6) Touch the watermark so the next burst within COALESCE_WINDOW_MS no-ops.
  await prisma.propertySyncWatermark.upsert({
    where: { contactId },
    create: { contactId, lastSyncAt: new Date() },
    update: { lastSyncAt: new Date() },
  });

  // 7) Recompute rollups (stub in v1 — Task 2.5 fills it in).
  await computePropertyRollups(result.propertyCacheId);

  if (result.created) {
    await logActivity("PROPERTY_CREATED", "Property created from contact address change", {
      contactId,
      propertyCacheId: result.propertyCacheId,
    });
  } else {
    await logActivity(
      "PROPERTY_ASSOCIATION_ADDED",
      "Contact associated to existing Property",
      { contactId, propertyCacheId: result.propertyCacheId },
    );
  }

  return {
    status: result.created ? "created" : "associated",
    propertyCacheId: result.propertyCacheId,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function createNewProperty(args: {
  geo: GeocodeResult;
  hash: string;
  unit: string | null | undefined;
}): Promise<{ propertyCacheId: string; hubspotObjectId: string; created: true }> {
  const { geo, hash, unit } = args;

  // Resolve geographic links — AHJ / utility from the resolver (deal-mining
  // → service_area fallback) and PB location from the zip-prefix table.
  const [ahj, utility] = await Promise.all([
    resolveAhjForProperty({ zip: geo.zip, city: geo.city, state: geo.state }),
    resolveUtilityForProperty({ zip: geo.zip, city: geo.city, state: geo.state }),
  ]);
  const pbLocation = resolvePbLocationFromAddress(geo.zip, geo.state);

  // Build the human-readable normalized address mirrored to HubSpot. Kept in
  // sync with `normalizeAddressForHash` in `address-hash.ts`: both collapse
  // whitespace and lowercase, but we preserve the comma format here so the
  // HubSpot-side search experience stays debuggable.
  const normalizedAddress = [geo.streetAddress, unit ? unit : null, geo.city, geo.state, geo.zip]
    .filter(Boolean)
    .join(", ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  // Create the HubSpot Property record. `address_hash` is intentionally NOT
  // sent — it lives only in the local cache.
  const hs = await createProperty({
    record_name: `${geo.streetAddress}, ${geo.city} ${geo.state} ${geo.zip}`,
    google_place_id: geo.placeId ?? "",
    normalized_address: normalizedAddress,
    full_address: geo.formattedAddress,
    street_address: geo.streetAddress,
    unit_number: unit ?? "",
    city: geo.city,
    state: geo.state,
    zip: geo.zip,
    county: geo.county ?? "",
    latitude: geo.latitude,
    longitude: geo.longitude,
    ahj_name: ahj?.name ?? "",
    utility_name: utility?.name ?? "",
    pb_location: pbLocation ?? "",
  });

  // Associate to AHJ / Utility custom objects (HUBSPOT_DEFINED typeId 1, no
  // label). Location association is future work — needs a bootstrap map from
  // canonical location string → Location object ID.
  if (ahj) await associateProperty(hs.id, AHJ_OBJECT_TYPE, ahj.objectId);
  if (utility) await associateProperty(hs.id, UTILITY_OBJECT_TYPE, utility.objectId);

  // Persist the cache row. Field parity with HubSpot is deliberate — the cache
  // is the authoritative source for local queries and backfill diff detection.
  const cache = await prisma.hubSpotPropertyCache.create({
    data: {
      hubspotObjectId: hs.id,
      googlePlaceId: geo.placeId,
      addressHash: hash,
      normalizedAddress,
      fullAddress: geo.formattedAddress,
      streetAddress: geo.streetAddress,
      unitNumber: unit ?? null,
      city: geo.city,
      state: geo.state,
      zip: geo.zip,
      county: geo.county,
      latitude: geo.latitude,
      longitude: geo.longitude,
      ahjObjectId: ahj?.objectId ?? null,
      ahjName: ahj?.name ?? null,
      utilityObjectId: utility?.objectId ?? null,
      utilityName: utility?.name ?? null,
      pbLocation: pbLocation ?? null,
      geocodedAt: new Date(),
      lastReconciledAt: new Date(),
    },
  });

  return { propertyCacheId: cache.id, hubspotObjectId: hs.id, created: true };
}

async function logActivity(
  type: ActivityType,
  description: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  // Non-blocking: activity log failures must never break the sync flow.
  try {
    await prisma.activityLog.create({
      data: {
        type,
        description,
        metadata: metadata as never,
        entityType: "Property",
        entityId: (metadata.propertyCacheId as string | undefined) ?? null,
      },
    });
  } catch {
    /* swallow */
  }
}

// ---------------------------------------------------------------------------
// Stubs for later tasks
// ---------------------------------------------------------------------------

/**
 * Recompute denormalized rollups on the cache row and push them back to
 * HubSpot. Implemented in Task 2.5 — stubbed so callers here type-check.
 */
export async function computePropertyRollups(propertyCacheId: string): Promise<void> {
  void propertyCacheId;
}

/** Implemented in Task 2.6. */
export async function onDealOrTicketCreated(
  _kind: "deal" | "ticket",
  _objectId: string,
): Promise<SyncOutcome> {
  throw new Error("not implemented");
}

/** Implemented in Task 2.7. */
export async function reconcileAllProperties(): Promise<ReconcileStats> {
  throw new Error("not implemented");
}

/** Implemented in Task 3.2. */
export async function upsertPropertyFromGeocode(
  _contactId: string,
  _addressParts: unknown,
): Promise<{ propertyCacheId: string; created: boolean }> {
  throw new Error("not implemented");
}
