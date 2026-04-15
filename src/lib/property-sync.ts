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

import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { geocodeAddress, type GeocodeResult } from "@/lib/geocode";
import { addressHash } from "@/lib/address-hash";
import {
  createProperty,
  associateProperty,
  updateProperty,
  fetchAllProperties,
  fetchAssociatedIdsFromProperty,
  type PropertyRecord,
} from "@/lib/hubspot-property";
import {
  fetchContactById,
  fetchLineItemsForDeals,
  fetchDealById,
  fetchTicketById,
  fetchPrimaryContactId,
  fetchPrimaryContactIdForTicket,
} from "@/lib/hubspot";
import { batchReadTickets, getTicketStageMap } from "@/lib/hubspot-tickets";
import { EquipmentCategory } from "@/generated/prisma/enums";
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
 * HubSpot. Reads associated deals + tickets + line items, classifies the
 * line items by `InternalProduct.category`, and writes:
 *   - firstInstallDate / mostRecentInstallDate (min/max of `Deal.constructionCompleteDate`)
 *   - associatedDealsCount / associatedTicketsCount / openTicketsCount
 *   - systemSizeKwDc (sum of MODULE wattage × qty / 1000)
 *   - hasBattery (any BATTERY or BATTERY_EXPANSION)
 *   - hasEvCharger (any EV_CHARGER)
 *   - lastServiceDate (max of closed_date ?? hs_lastmodifieddate across tickets)
 *   - earliestWarrantyExpiry = null in v1 (see note below)
 */
export async function computePropertyRollups(propertyCacheId: string): Promise<void> {
  const property = await prisma.hubSpotPropertyCache.findUnique({
    where: { id: propertyCacheId },
    include: {
      dealLinks: true,
      ticketLinks: true,
    },
  });
  if (!property) return;

  // `dealLinks` / `ticketLinks` are `include`d above; fall back to [] so a
  // freshly-created Property with no associations still rollups cleanly.
  const dealIds = (property.dealLinks ?? []).map((l) => l.dealId);
  const ticketIds = (property.ticketLinks ?? []).map((l) => l.ticketId);

  // Deal sources of truth (verified against prisma/schema.prisma `model Deal`):
  //   - first/most-recent install date → `constructionCompleteDate` (the actual
  //     field set when a deal's install is completed; `installScheduleDate` is
  //     a forecast/plan, not actuals, and would overcount).
  //   - warranty expiry → NOT present on the Deal model today.
  //     `earliestWarrantyExpiry` stays null in v1 and is documented as a
  //     follow-up. Adding a `Deal.warrantyExpiresAt` column is a separate
  //     project because warranty term varies by product mix (module vs
  //     inverter vs battery) and would require a data backfill to be meaningful.
  const deals = dealIds.length
    ? await prisma.deal.findMany({
        where: { hubspotDealId: { in: dealIds } },
        select: {
          hubspotDealId: true,
          constructionCompleteDate: true,
          closeDate: true,
          amount: true,
        },
      })
    : [];

  const installDates = deals
    .map((d) => d.constructionCompleteDate)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());

  // Line-item rollup. We classify by `InternalProduct.category` via the
  // `hubspotProductId` the line item points at — matching the join used by
  // `bom-hubspot-line-items.ts`. Raw line items are not cached (see decision 8
  // in the plan); only the rollup lands on the cache row.
  const lineItems = dealIds.length ? await fetchLineItemsForDeals(dealIds) : [];
  const byCategory = await categorizeLineItemsByInternalProduct(lineItems);
  const moduleWatts = sumWattage(byCategory.get(EquipmentCategory.MODULE) ?? []);
  const systemSizeKwDc = moduleWatts > 0 ? moduleWatts / 1000 : null;
  const hasBattery =
    (byCategory.get(EquipmentCategory.BATTERY)?.length ?? 0) > 0 ||
    (byCategory.get(EquipmentCategory.BATTERY_EXPANSION)?.length ?? 0) > 0;
  const hasEvCharger = (byCategory.get(EquipmentCategory.EV_CHARGER)?.length ?? 0) > 0;

  // Ticket fields — tickets live in HubSpot (no ServiceTicketCache model).
  // `getTicketStageMap()` returns `{ map, orderedStageIds }`; we destructure
  // `map` (stageId → label) — `.stageMap` does not exist.
  const tickets = ticketIds.length
    ? await batchReadTickets(ticketIds, [
        "subject",
        "hs_pipeline_stage",
        "hs_lastmodifieddate",
        "closed_date",
      ])
    : [];
  const stageMap = ticketIds.length ? (await getTicketStageMap()).map : {};
  const isOpenStage = (stageId: string | null | undefined): boolean => {
    if (!stageId) return false;
    const label = (stageMap[stageId] ?? "").toLowerCase();
    return !["closed", "resolved", "cancelled"].some((needle) => label.includes(needle));
  };
  const openTicketsCount = tickets.filter((t) => isOpenStage(t.properties.hs_pipeline_stage)).length;
  const lastServiceDate =
    tickets
      .map((t) => {
        const raw = t.properties.closed_date ?? t.properties.hs_lastmodifieddate;
        return raw ? new Date(raw) : null;
      })
      .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  await prisma.hubSpotPropertyCache.update({
    where: { id: propertyCacheId },
    data: {
      firstInstallDate: installDates[0] ?? null,
      mostRecentInstallDate: installDates[installDates.length - 1] ?? null,
      associatedDealsCount: deals.length,
      associatedTicketsCount: tickets.length,
      openTicketsCount,
      systemSizeKwDc,
      hasBattery,
      hasEvCharger,
      lastServiceDate,
      earliestWarrantyExpiry: null, // v1: not yet derivable — see note above.
      lastReconciledAt: new Date(),
    },
  });

  await updateProperty(property.hubspotObjectId, {
    first_install_date: toDateString(installDates[0] ?? null),
    most_recent_install_date: toDateString(installDates[installDates.length - 1] ?? null),
    associated_deals_count: deals.length,
    associated_tickets_count: tickets.length,
    open_tickets_count: openTicketsCount,
    system_size_kw_dc: systemSizeKwDc,
    has_battery: hasBattery,
    has_ev_charger: hasEvCharger,
    last_service_date: toDateString(lastServiceDate),
    earliest_warranty_expiry: "", // v1: not yet derivable.
  });
}

// ---------------------------------------------------------------------------
// Rollup helpers
// ---------------------------------------------------------------------------

interface CategorizableLineItem {
  hubspotProductId: string | null;
  quantity: number;
}

interface ModuleLineItem extends CategorizableLineItem {
  /** Wattage pulled off the joined InternalProduct.moduleSpec.wattage. */
  _wattage: number;
}

/**
 * Group line items by the EquipmentCategory of their joined InternalProduct.
 * Line items with no HubSpot product ID or no catalog match are skipped — they
 * cannot be classified and would pollute the rollup (e.g. freeform "Service
 * Call" line items on a service deal).
 */
async function categorizeLineItemsByInternalProduct(
  lineItems: ReadonlyArray<CategorizableLineItem>
): Promise<Map<EquipmentCategory, Array<CategorizableLineItem | ModuleLineItem>>> {
  const byCategory = new Map<EquipmentCategory, Array<CategorizableLineItem | ModuleLineItem>>();
  const productIds = Array.from(
    new Set(
      lineItems
        .map((li) => li.hubspotProductId)
        .filter((id): id is string => !!id && id.length > 0)
    )
  );
  if (productIds.length === 0) return byCategory;

  const products = await prisma.internalProduct.findMany({
    where: { hubspotProductId: { in: productIds } },
    select: {
      id: true,
      category: true,
      hubspotProductId: true,
      moduleSpec: { select: { wattage: true } },
    },
  });

  const byHubspotId = new Map<
    string,
    { category: EquipmentCategory; wattage: number | null }
  >();
  for (const p of products) {
    if (!p.hubspotProductId) continue;
    byHubspotId.set(p.hubspotProductId, {
      category: p.category,
      wattage: p.moduleSpec?.wattage ?? null,
    });
  }

  for (const item of lineItems) {
    if (!item.hubspotProductId) continue;
    const match = byHubspotId.get(item.hubspotProductId);
    if (!match) continue;
    const bucket = byCategory.get(match.category) ?? [];
    if (match.category === EquipmentCategory.MODULE) {
      bucket.push({
        hubspotProductId: item.hubspotProductId,
        quantity: item.quantity,
        _wattage: match.wattage ?? 0,
      });
    } else {
      bucket.push(item);
    }
    byCategory.set(match.category, bucket);
  }
  return byCategory;
}

/** Sum wattage × quantity across MODULE line items. Returns watts (not kW). */
function sumWattage(items: Array<CategorizableLineItem | ModuleLineItem>): number {
  let total = 0;
  for (const item of items) {
    if ("_wattage" in item) {
      total += (item._wattage ?? 0) * (item.quantity ?? 0);
    }
  }
  return total;
}

function toDateString(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/**
 * Associate a freshly-created deal or ticket to the correct Property for its
 * primary contact. Flow per spec §Deal/Ticket creation:
 *   1) Feature-flag gate.
 *   2) Look up the primary contact on the new object; defer if absent.
 *   3) Read the contact's existing PropertyContactLink rows.
 *   4) If exactly one Property → associate + upsert link + recompute rollups.
 *   5) If multiple → geocode the deal/ticket address and match by `place_id`
 *      against the candidate Properties; defer if no match.
 *   6) If zero → trigger `onContactAddressChange` to create-or-associate a
 *      Property from the contact's own address, retry once, and defer if the
 *      contact-side sync can't produce one (e.g. missing address).
 */
export async function onDealOrTicketCreated(
  kind: "deal" | "ticket",
  objectId: string,
): Promise<SyncOutcome> {
  if (!isFeatureEnabled()) {
    return { status: "skipped", reason: "feature flag off" };
  }

  // 1) Resolve the primary contact. Pull the object itself so we can read its
  // address properties later for disambiguation — the extra fetch is cheap and
  // avoids a second round-trip on the ambiguous-Properties branch.
  const addressProps =
    kind === "deal"
      ? ["address", "city", "state", "zip"]
      : ["hs_address", "hs_city", "hs_state", "hs_zip"];

  const object =
    kind === "deal"
      ? await fetchDealById(objectId, addressProps)
      : await fetchTicketById(objectId, addressProps);

  const contactId =
    kind === "deal"
      ? await fetchPrimaryContactId(objectId)
      : await fetchPrimaryContactIdForTicket(objectId);

  if (!contactId) {
    return { status: "deferred", reason: "no primary contact" };
  }

  // 2) Read Properties the contact is already associated to. Single cheap
  // table scan; labels don't matter for this lookup (any ownership label
  // qualifies the contact as "tied to" that Property).
  let links = await prisma.propertyContactLink.findMany({ where: { contactId } });

  // 3) Zero-property recovery: trigger contact sync, retry once.
  if (links.length === 0) {
    await onContactAddressChange(contactId);
    links = await prisma.propertyContactLink.findMany({ where: { contactId } });
    if (links.length === 0) {
      await logActivity("PROPERTY_SYNC_FAILED", "No properties for contact on deal/ticket creation", {
        kind,
        objectId,
        contactId,
      });
      return { status: "deferred", reason: "no properties for contact" };
    }
  }

  const candidateIds = Array.from(new Set(links.map((l) => l.propertyId)));
  const candidates = await prisma.hubSpotPropertyCache.findMany({
    where: { id: { in: candidateIds } },
  });

  // 4) Pick a single Property. One candidate → trivial match. Multiple
  // candidates → disambiguate by geocoding the deal/ticket address and
  // matching `place_id` against candidate cache rows. If the address is
  // missing or the geocode doesn't match any candidate, defer rather than
  // guess — linking to the wrong Property would be harder to unwind than
  // waiting for the next webhook cycle.
  let chosen: { id: string; hubspotObjectId: string } | null = null;
  if (candidates.length === 1) {
    chosen = { id: candidates[0].id, hubspotObjectId: candidates[0].hubspotObjectId };
  } else if (candidates.length > 1) {
    const addr = object?.properties ?? {};
    const street = kind === "deal" ? addr.address : addr.hs_address;
    const city = kind === "deal" ? addr.city : addr.hs_city;
    const state = kind === "deal" ? addr.state : addr.hs_state;
    const zip = kind === "deal" ? addr.zip : addr.hs_zip;

    if (street && city && state && zip) {
      const geo = await geocodeAddress({
        street,
        city,
        state,
        zip,
        country: "USA",
      });
      const placeId = geo?.placeId ?? null;
      if (placeId) {
        const match = candidates.find((c) => c.googlePlaceId === placeId);
        if (match) chosen = { id: match.id, hubspotObjectId: match.hubspotObjectId };
      }
    }
    if (!chosen) {
      return { status: "deferred", reason: "ambiguous properties, no address match" };
    }
  }

  if (!chosen) {
    // Defensive — candidates.length was 0 above, we returned early. This
    // keeps the type checker happy without a non-null assertion.
    return { status: "deferred", reason: "no properties for contact" };
  }

  // 5) Mirror the association in HubSpot and in the local link table. No
  // labelAssociationTypeId means `associateProperty` falls back to the
  // HUBSPOT_DEFINED (unlabeled) association — the spec's default for
  // deal/ticket links.
  await associateProperty(chosen.hubspotObjectId, kind === "deal" ? "deals" : "tickets", objectId);

  if (kind === "deal") {
    await prisma.propertyDealLink.upsert({
      where: { propertyId_dealId: { propertyId: chosen.id, dealId: objectId } },
      create: { propertyId: chosen.id, dealId: objectId },
      update: {},
    });
  } else {
    await prisma.propertyTicketLink.upsert({
      where: { propertyId_ticketId: { propertyId: chosen.id, ticketId: objectId } },
      create: { propertyId: chosen.id, ticketId: objectId },
      update: {},
    });
  }

  // 6) Refresh denormalized rollups so the associated counts and
  // install/service dates include the new object immediately.
  await computePropertyRollups(chosen.id);

  await logActivity(
    "PROPERTY_ASSOCIATION_ADDED",
    `Property associated to new ${kind}`,
    { kind, objectId, contactId, propertyCacheId: chosen.id },
  );

  return { status: "associated", propertyCacheId: chosen.id };
}

/**
 * Nightly reconciliation: page through all HubSpot Property records and
 * refresh the local cache + association link tables. This is a HubSpot → DB
 * sync — geocoding is intentionally NOT re-run here (that only happens on
 * contact address change or explicit manual create).
 *
 * Per-Property failures are logged and counted but do NOT abort the run —
 * one bad record shouldn't stall the whole pass.
 *
 * After the pass, any cache row with `lastReconciledAt > 48h` indicates the
 * webhook is dropping events on the floor. We surface that via Sentry.
 *
 * Finally, we drop `PropertySyncWatermark` rows older than 7 days. Watermarks
 * are per-contact coalescing markers with a 2-second window; 7 days is a safe
 * retention far in excess of the coalescing TTL.
 */
export async function reconcileAllProperties(): Promise<ReconcileStats> {
  const stats: ReconcileStats = { processed: 0, drifted: 0, failed: 0 };

  let properties: PropertyRecord[] = [];
  try {
    properties = await fetchAllProperties();
  } catch (err) {
    Sentry.captureException(err, { tags: { module: "property-reconcile", step: "fetchAll" } });
    throw err;
  }

  for (const record of properties) {
    try {
      const drifted = await reconcileSingleProperty(record);
      stats.processed += 1;
      if (drifted) stats.drifted += 1;
    } catch (err) {
      stats.failed += 1;
      await logActivity(
        "PROPERTY_SYNC_FAILED",
        "Property reconciliation failed",
        {
          propertyId: record.id,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      Sentry.captureException(err, {
        tags: { module: "property-reconcile", step: "perProperty" },
        extra: { propertyId: record.id },
      });
      // Continue to the next property — don't abort the whole pass.
    }
  }

  // Post-pass drift check: any cache rows not touched in 48h suggest the
  // webhook pipeline is silently dropping events. This is an anomaly signal,
  // not a data-integrity problem — we've just refreshed everything visible in
  // HubSpot, so stale cache rows mean the HubSpot object itself is missing.
  const STALE_MS = 48 * 60 * 60 * 1000;
  const staleCutoff = new Date(Date.now() - STALE_MS);
  const stale = await prisma.hubSpotPropertyCache.findMany({
    where: { lastReconciledAt: { lt: staleCutoff } },
    select: { id: true, hubspotObjectId: true, lastReconciledAt: true },
  });
  if (stale.length > 0) {
    Sentry.captureMessage(
      `Property reconciliation: ${stale.length} cache rows stale (>48h since last reconcile)`,
      {
        level: "warning",
        tags: { module: "property-reconcile", alert: "stale-cache" },
        extra: { staleIds: stale.map((s) => s.id) },
      },
    );
  }

  // Watermark cleanup — spec §Contact address change: drop rows > 7 days old.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);
  await prisma.propertySyncWatermark.deleteMany({
    where: { lastSyncAt: { lt: sevenDaysAgo } },
  });

  return stats;
}

/**
 * Reconcile a single HubSpot Property record against the local cache:
 *   1. Find the cache row (create if missing, update if present).
 *   2. Refresh associations (contacts / deals / tickets) via add-only reconcile.
 *   3. Recompute rollups.
 *   4. Stamp `lastReconciledAt`.
 *
 * Returns `true` if any of the watched drift fields changed on an existing
 * cache row (triggers the `drifted` counter). New cache rows are not counted
 * as drift — they're simple first-sight creates.
 */
async function reconcileSingleProperty(record: PropertyRecord): Promise<boolean> {
  const props = record.properties;
  const existing = await prisma.hubSpotPropertyCache.findUnique({
    where: { hubspotObjectId: record.id },
  });

  // Watched fields for drift detection — a small stable set we expect HubSpot
  // to be the source of truth for. The full column list gets overwritten
  // regardless; we only count the flip.
  const nextStreet = props.street_address ?? null;
  const nextCity = props.city ?? null;
  const nextState = props.state ?? null;
  const nextZip = props.zip ?? null;
  const nextPlaceId = props.google_place_id || null;

  let cacheId: string;
  let drifted = false;

  if (!existing) {
    // Create minimally from HubSpot data — no geocode. `addressHash` is
    // required + unique, so derive it from the HubSpot-supplied address.
    // Several cache columns are non-null in the schema (fullAddress,
    // streetAddress, city/state/zip, latitude/longitude, geocodedAt) — fall
    // back to safe defaults when HubSpot has blanks rather than throw.
    const hash = addressHash({
      street: nextStreet ?? "",
      unit: props.unit_number ?? null,
      city: nextCity ?? "",
      state: nextState ?? "",
      zip: nextZip ?? "",
    });
    const created = await prisma.hubSpotPropertyCache.create({
      data: {
        hubspotObjectId: record.id,
        googlePlaceId: nextPlaceId,
        addressHash: hash,
        normalizedAddress: props.normalized_address ?? "",
        fullAddress: props.full_address ?? "",
        streetAddress: nextStreet ?? "",
        unitNumber: props.unit_number || null,
        city: nextCity ?? "",
        state: nextState ?? "",
        zip: nextZip ?? "",
        county: props.county || null,
        latitude: props.latitude ? Number(props.latitude) : 0,
        longitude: props.longitude ? Number(props.longitude) : 0,
        ahjName: props.ahj_name || null,
        utilityName: props.utility_name || null,
        pbLocation: props.pb_location || null,
        geocodedAt: new Date(),
        lastReconciledAt: new Date(),
      },
    });
    cacheId = created.id;
  } else {
    drifted =
      existing.streetAddress !== nextStreet ||
      existing.city !== nextCity ||
      existing.state !== nextState ||
      existing.zip !== nextZip ||
      existing.googlePlaceId !== nextPlaceId;

    await prisma.hubSpotPropertyCache.update({
      where: { id: existing.id },
      data: {
        googlePlaceId: nextPlaceId,
        normalizedAddress: props.normalized_address ?? existing.normalizedAddress,
        fullAddress: props.full_address ?? existing.fullAddress,
        streetAddress: nextStreet ?? existing.streetAddress,
        unitNumber: props.unit_number || null,
        city: nextCity ?? existing.city,
        state: nextState ?? existing.state,
        zip: nextZip ?? existing.zip,
        county: props.county || null,
        latitude: props.latitude ? Number(props.latitude) : existing.latitude,
        longitude: props.longitude ? Number(props.longitude) : existing.longitude,
        ahjName: props.ahj_name || existing.ahjName,
        utilityName: props.utility_name || existing.utilityName,
        pbLocation: props.pb_location || existing.pbLocation,
        lastReconciledAt: new Date(),
      },
    });
    cacheId = existing.id;
  }

  // Refresh associations — add-only reconcile for v1 (documented deviation).
  // We upsert missing link rows; we don't delete stale ones. HubSpot is the
  // source of truth for add/remove — aggressive deletion risks racing with
  // in-flight webhooks. A follow-up can add deletion once we're confident.
  await refreshAssociationLinks(record.id, cacheId);

  // Recompute denormalized rollups from the freshly reconciled links.
  await computePropertyRollups(cacheId);

  return drifted;
}

/**
 * Add-only association refresh: fetch current contacts/deals/tickets for a
 * Property from HubSpot and upsert each as a link row. Does not remove stale
 * link rows in v1 (see `reconcileSingleProperty` comment).
 */
async function refreshAssociationLinks(
  hubspotObjectId: string,
  propertyCacheId: string,
): Promise<void> {
  const [contactIds, dealIds, ticketIds] = await Promise.all([
    fetchAssociatedIdsFromProperty(hubspotObjectId, "contacts"),
    fetchAssociatedIdsFromProperty(hubspotObjectId, "deals"),
    fetchAssociatedIdsFromProperty(hubspotObjectId, "tickets"),
  ]);

  // Contacts: labels come from HubSpot, but the nightly reconcile API doesn't
  // surface labels cheaply — default to "Current Owner" for any link HubSpot
  // reports that we don't already have. (The webhook path sets the correct
  // label on new associations; this path only patches gaps.)
  for (const contactId of contactIds) {
    await prisma.propertyContactLink.upsert({
      where: {
        propertyId_contactId_label: {
          propertyId: propertyCacheId,
          contactId,
          label: "Current Owner",
        },
      },
      create: {
        propertyId: propertyCacheId,
        contactId,
        label: "Current Owner",
      },
      update: {},
    });
  }

  for (const dealId of dealIds) {
    await prisma.propertyDealLink.upsert({
      where: { propertyId_dealId: { propertyId: propertyCacheId, dealId } },
      create: { propertyId: propertyCacheId, dealId },
      update: {},
    });
  }

  for (const ticketId of ticketIds) {
    await prisma.propertyTicketLink.upsert({
      where: { propertyId_ticketId: { propertyId: propertyCacheId, ticketId } },
      create: { propertyId: propertyCacheId, ticketId },
      update: {},
    });
  }
}

/** Implemented in Task 3.2. */
export async function upsertPropertyFromGeocode(
  _contactId: string,
  _addressParts: unknown,
): Promise<{ propertyCacheId: string; created: boolean }> {
  throw new Error("not implemented");
}
