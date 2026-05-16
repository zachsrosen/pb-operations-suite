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
  searchPropertyByPlaceId,
  searchPropertyByNormalizedAddress,
  searchPropertyByStreetAddress,
  archiveProperty,
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

/**
 * HubSpot association typeIds for Property → Deal / Property → Ticket.
 *
 * HubSpot does NOT register a HUBSPOT_DEFINED (typeId 1) default between the
 * custom Property object and standard Deal/Ticket objects, so we must send an
 * explicit USER_DEFINED typeId on every create. Missing or zero means the
 * associate call will 400 with a misleading "INVALID_OBJECT_IDS" error — fail
 * loudly here instead of at the API boundary.
 */
function dealAssocTypeId(): number {
  const id = Number(process.env.HUBSPOT_PROPERTY_DEAL_ASSOC_DEFAULT ?? 0);
  if (!id) throw new Error("HUBSPOT_PROPERTY_DEAL_ASSOC_DEFAULT is not set");
  return id;
}

function ticketAssocTypeId(): number {
  const id = Number(process.env.HUBSPOT_PROPERTY_TICKET_ASSOC_DEFAULT ?? 0);
  if (!id) throw new Error("HUBSPOT_PROPERTY_TICKET_ASSOC_DEFAULT is not set");
  return id;
}

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
  const street = (p.address ?? "").trim();
  const city = (p.city ?? "").trim();
  const state = (p.state ?? "").trim();
  const zip = (p.zip ?? "").trim();
  const unit = (p.address2 ?? "").trim() || undefined;
  const country = (p.country ?? "").trim();

  if (!street || !city || !state || !zip) {
    return { status: "skipped", reason: "address incomplete" };
  }

  const quality = validateAddressQuality(street);
  if (quality) {
    return { status: "skipped", reason: quality };
  }

  // 3) Geocode + find-or-create — delegated to `upsertPropertyFromGeocode`
  //    so the admin manual-create route can reuse the exact same path.
  const upsert = await upsertPropertyFromGeocode({
    street,
    unit,
    city,
    state,
    zip,
    country: country || "USA",
  });
  if ("status" in upsert) {
    await logActivity("PROPERTY_SYNC_FAILED", "Property sync rejected for contact", {
      contactId,
      reason: upsert.reason,
    });
    return { status: "failed", reason: upsert.reason };
  }

  const result = upsert;

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
// Address quality validation
// ---------------------------------------------------------------------------

/**
 * Returns a skip-reason string if the street value is obviously not a real
 * address (email, URL, placeholder text, numeric-only fragment). Returns
 * null when the address looks plausible.
 */
function validateAddressQuality(street: string): string | null {
  if (street.includes("@")) return "street contains email";
  if (/^https?:\/\//i.test(street)) return "street is a URL";
  if (/\.(com|org|net|io|gov)\b/i.test(street)) return "street contains domain";
  if (/^[0-9]+$/.test(street)) return "street is numeric-only";
  if (street.length < 5) return "street too short";
  // Reject strings with no digits — real US addresses almost always have a
  // street number. Exceptions (e.g. "Main Street") are rare enough that
  // missing them is better than creating garbage records.
  if (!/\d/.test(street)) return "street has no number";
  return null;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function createNewProperty(args: {
  geo: GeocodeResult;
  hash: string;
  unit: string | null | undefined;
}): Promise<{ propertyCacheId: string; hubspotObjectId: string; created: boolean }> {
  const { geo, hash, unit } = args;

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

  // ── HubSpot-side pre-check: don't create a duplicate object ──
  // Three-tier dedup: placeId (canonical) → normalized_address → street
  // component match (catches bare records created outside our webhook, e.g.
  // by a HubSpot workflow "Create custom object" action).
  let hubspotObjectId: string | null = null;
  let adoptedBareRecord = false;
  if (geo.placeId) {
    const existing = await searchPropertyByPlaceId(geo.placeId);
    if (existing) hubspotObjectId = existing.id;
  }
  if (!hubspotObjectId && normalizedAddress) {
    try {
      const existing = await searchPropertyByNormalizedAddress(normalizedAddress);
      if (existing) hubspotObjectId = existing.id;
    } catch (err) {
      console.warn(
        "[property-sync] searchPropertyByNormalizedAddress failed; falling through",
        err,
      );
    }
  }
  if (!hubspotObjectId && geo.streetAddress && geo.city && geo.state && geo.zip) {
    try {
      const existing = await searchPropertyByStreetAddress({
        streetAddress: geo.streetAddress,
        city: geo.city,
        state: geo.state,
        zip: geo.zip,
      });
      if (existing) {
        hubspotObjectId = existing.id;
        adoptedBareRecord = true;
      }
    } catch (err) {
      console.warn(
        "[property-sync] searchPropertyByStreetAddress failed; falling through",
        err,
      );
    }
  }

  // Resolve geographic links — AHJ / utility from the resolver (deal-mining
  // → service_area fallback) and PB location from the zip-prefix table.
  const [ahj, utility] = await Promise.all([
    resolveAhjForProperty({ zip: geo.zip, city: geo.city, state: geo.state }),
    resolveUtilityForProperty({ zip: geo.zip, city: geo.city, state: geo.state }),
  ]);
  const pbLocation = resolvePbLocationFromAddress(geo.zip, geo.state);

  const enrichmentProps = {
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
  };

  // If we adopted a bare record (created outside our webhook), enrich it
  // with geocode data so it's on par with records we create ourselves.
  if (adoptedBareRecord && hubspotObjectId) {
    try {
      await updateProperty(hubspotObjectId, enrichmentProps);
      console.log(
        "[property-sync] enriched adopted bare Property %s",
        hubspotObjectId,
      );
    } catch (err) {
      console.warn(
        "[property-sync] failed to enrich adopted bare Property %s",
        hubspotObjectId,
        err,
      );
    }
  }

  let createdHubspotId: string | null = null;
  if (!hubspotObjectId) {
    const hs = await createProperty(enrichmentProps);
    hubspotObjectId = hs.id;
    createdHubspotId = hs.id;
  }

  // AHJ / Utility custom-object associations are intentionally NOT mirrored to
  // HubSpot here. HubSpot has no registered association type between Property
  // and either custom object in this portal, so any create call 400s with a
  // misleading "INVALID_OBJECT_IDS" error. The AHJ/Utility objectIds we
  // resolved above are persisted on the cache row below, which is the
  // authoritative source for local queries. If HubSpot UI links to AHJ/Utility
  // are needed later, register labeled association types in the portal, add
  // typeId env vars, and wire them here — same pattern as Contact / Deal /
  // Ticket. Location association is also future work.

  // Persist the cache row. Field parity with HubSpot is deliberate — the cache
  // is the authoritative source for local queries and backfill diff detection.
  //
  // Race handling: two concurrent `upsertPropertyFromGeocode` calls for the
  // same address can both pass the initial cache miss and reach this line.
  // The DB unique constraints on `googlePlaceId` / `addressHash` /
  // `hubspotObjectId` guarantee exactly one winner. The loser catches
  // Prisma P2002, re-reads the winner, and — if the loser also created a
  // NEW HubSpot object while the winner adopted a different one — archives
  // the orphan so HubSpot doesn't accumulate dupes.
  try {
    const cache = await prisma.hubSpotPropertyCache.create({
      data: {
        hubspotObjectId,
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
        shovelsEnrichmentStatus: "PENDING",
      },
    });
    return { propertyCacheId: cache.id, hubspotObjectId, created: createdHubspotId !== null };
  } catch (err) {
    if (!isPrismaUniqueViolation(err)) throw err;

    // Race loser: re-read the winner by the same key we used to dedup.
    const winner = geo.placeId
      ? await prisma.hubSpotPropertyCache.findUnique({
          where: { googlePlaceId: geo.placeId },
        })
      : await prisma.hubSpotPropertyCache.findUnique({ where: { addressHash: hash } });

    if (!winner) {
      // Extremely rare: P2002 fired but no row found by either key. Re-throw
      // so callers see the original error rather than fabricating success.
      throw err;
    }

    // If we created a fresh HubSpot object AND the winner references a
    // different one, our create is an orphan — archive it best-effort.
    if (createdHubspotId && winner.hubspotObjectId !== createdHubspotId) {
      try {
        await archiveProperty(createdHubspotId);
      } catch (archiveErr) {
        Sentry.captureException(archiveErr, {
          tags: { module: "property-sync", step: "archive-orphan" },
          extra: { orphanId: createdHubspotId, winnerId: winner.hubspotObjectId },
        });
        console.error(
          "[property-sync] orphan HubSpot Property %s needs manual cleanup (winner=%s)",
          createdHubspotId,
          winner.hubspotObjectId,
          archiveErr,
        );
      }
    }

    return {
      propertyCacheId: winner.id,
      hubspotObjectId: winner.hubspotObjectId,
      // From this caller's perspective, they did not create the winning
      // record — another concurrent caller did.
      created: false,
    };
  }
}

/**
 * Narrow type guard for Prisma unique-constraint violations (error code P2002).
 * Kept local so we don't import `@prisma/client` just for the error class.
 */
function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
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

  // Equipment summaries — human-readable brand/model × qty strings
  const equipSummaries = await buildEquipmentSummaries(lineItems);

  // Deal value + latest deal info
  const totalDealValue = deals.reduce(
    (sum, d) => sum + (d.amount ? Number(d.amount) : 0),
    0,
  );
  // Most recent deal by close date (if closed) or creation order (fallback)
  const latestDeal = deals.length
    ? [...deals].sort((a, b) => {
        const aDate = a.closeDate ?? a.constructionCompleteDate;
        const bDate = b.closeDate ?? b.constructionCompleteDate;
        if (aDate && bDate) return bDate.getTime() - aDate.getTime();
        if (bDate) return 1;
        if (aDate) return -1;
        return 0;
      })[0]
    : null;
  // Fetch deal name + stage from the Deal mirror table
  const latestDealInfo = latestDeal
    ? await prisma.deal.findUnique({
        where: { hubspotDealId: latestDeal.hubspotDealId },
        select: { dealName: true, stage: true },
      })
    : null;

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
  const openTickets = tickets.filter((t) => isOpenStage(t.properties.hs_pipeline_stage));
  const openTicketsCount = openTickets.length;
  const closedTicketsCount = tickets.length - openTicketsCount;
  const lastServiceDate =
    tickets
      .map((t) => {
        const raw = t.properties.closed_date ?? t.properties.hs_lastmodifieddate;
        return raw ? new Date(raw) : null;
      })
      .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  // Latest open ticket subject — most recently modified open ticket
  const latestOpenTicketSubject = openTickets.length
    ? [...openTickets]
        .sort((a, b) => {
          const aT = a.properties.hs_lastmodifieddate;
          const bT = b.properties.hs_lastmodifieddate;
          return (bT ?? "").localeCompare(aT ?? "");
        })[0]?.properties.subject ?? null
    : null;

  // NOTE: install_age_months and days_since_last_service are HubSpot calculation
  // properties (time_between) created in the HubSpot UI — they auto-compute from
  // first_install_date / last_service_date. No local computation needed.

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
      // NOTE: Extended rollups (moduleSummary, inverterSummary, batterySummary,
      // evChargerSummary, panelCount, totalDealValue, latestDealName,
      // latestDealStage, latestOpenTicketSubject, installAgeMonths,
      // daysSinceLastService) are pushed to HubSpot below but NOT stored in the
      // local cache — columns don't exist in the schema yet. Add them in a
      // follow-up migration.
      lastReconciledAt: new Date(),
    },
  });

  await updateProperty(property.hubspotObjectId, {
    first_install_date: toDateString(installDates[0] ?? null),
    most_recent_install_date: toDateString(installDates[installDates.length - 1] ?? null),
    associated_deals_count: deals.length,
    associated_tickets_count: tickets.length,
    open_tickets_count: openTicketsCount,
    closed_tickets_count: closedTicketsCount,
    system_size_kw_dc: systemSizeKwDc,
    has_battery: hasBattery,
    has_ev_charger: hasEvCharger,
    last_service_date: toDateString(lastServiceDate),
    earliest_warranty_expiry: "", // v1: not yet derivable.
    // Extended rollups
    module_summary: equipSummaries.moduleSummary ?? "",
    inverter_summary: equipSummaries.inverterSummary ?? "",
    battery_summary: equipSummaries.batterySummary ?? "",
    ev_charger_summary: equipSummaries.evChargerSummary ?? "",
    panel_count: equipSummaries.panelCount,
    total_deal_value: totalDealValue > 0 ? totalDealValue : null,
    latest_deal_name: latestDealInfo?.dealName ?? "",
    latest_deal_stage: latestDealInfo?.stage ?? "",
    latest_open_ticket_subject: latestOpenTicketSubject ?? "",
    // NOTE: install_age_months and days_since_last_service are HubSpot calc
    // properties — they auto-compute from first_install_date / last_service_date.
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
 * Build human-readable equipment summary strings from line items.
 * Groups by brand+model, sums quantities, and joins into a single line.
 * E.g. "REC 400W × 30" or "Enphase IQ8M × 15, SolarEdge SE7600H × 1"
 */
async function buildEquipmentSummaries(
  lineItems: ReadonlyArray<CategorizableLineItem>,
): Promise<{
  moduleSummary: string | null;
  inverterSummary: string | null;
  batterySummary: string | null;
  evChargerSummary: string | null;
  panelCount: number | null;
}> {
  const productIds = Array.from(
    new Set(
      lineItems
        .map((li) => li.hubspotProductId)
        .filter((id): id is string => !!id && id.length > 0),
    ),
  );
  if (productIds.length === 0) {
    return { moduleSummary: null, inverterSummary: null, batterySummary: null, evChargerSummary: null, panelCount: null };
  }

  const products = await prisma.internalProduct.findMany({
    where: { hubspotProductId: { in: productIds } },
    select: {
      hubspotProductId: true,
      category: true,
      brand: true,
      model: true,
      unitSpec: true,
      unitLabel: true,
    },
  });

  const productMap = new Map<string, typeof products[number]>();
  for (const p of products) {
    if (p.hubspotProductId) productMap.set(p.hubspotProductId, p);
  }

  // Group by category → brand+model, summing quantities
  const groups = new Map<EquipmentCategory, Map<string, { label: string; qty: number }>>();
  let totalPanels = 0;

  for (const item of lineItems) {
    if (!item.hubspotProductId) continue;
    const prod = productMap.get(item.hubspotProductId);
    if (!prod) continue;

    const catGroups = groups.get(prod.category) ?? new Map();
    const key = `${prod.brand}|${prod.model}`;
    const existing = catGroups.get(key);

    // Build display label: "Brand Model [Spec]" e.g. "REC 400W" or "Enphase IQ8M"
    const specSuffix = prod.unitSpec && prod.unitLabel
      ? ` ${prod.unitSpec}${prod.unitLabel}`
      : "";
    const label = `${prod.brand} ${prod.model}${specSuffix}`;

    if (existing) {
      existing.qty += item.quantity;
    } else {
      catGroups.set(key, { label, qty: item.quantity });
    }
    groups.set(prod.category, catGroups);

    if (prod.category === EquipmentCategory.MODULE) {
      totalPanels += item.quantity;
    }
  }

  const summarize = (cat: EquipmentCategory): string | null => {
    const catGroups = groups.get(cat);
    if (!catGroups || catGroups.size === 0) return null;
    return Array.from(catGroups.values())
      .map((g) => `${g.label} × ${g.qty}`)
      .join(", ");
  };

  return {
    moduleSummary: summarize(EquipmentCategory.MODULE),
    inverterSummary: summarize(EquipmentCategory.INVERTER),
    batterySummary: summarize(EquipmentCategory.BATTERY) ?? summarize(EquipmentCategory.BATTERY_EXPANSION),
    evChargerSummary: summarize(EquipmentCategory.EV_CHARGER),
    panelCount: totalPanels > 0 ? totalPanels : null,
  };
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
  // address properties later for disambiguation and Property creation from
  // the object's own address. Deal fields: `address_line_1` + `postal_code`.
  // Ticket fields: `street_address` + `city` + `state` + `zip_code`.
  const addressProps =
    kind === "deal"
      ? ["address_line_1", "city", "state", "postal_code"]
      : ["street_address", "city", "state", "zip_code"];

  const object =
    kind === "deal"
      ? await fetchDealById(objectId, addressProps)
      : await fetchTicketById(objectId, addressProps);

  const contactId =
    kind === "deal"
      ? await fetchPrimaryContactId(objectId)
      : await fetchPrimaryContactIdForTicket(objectId);

  // Extract the object's own address (if available) for disambiguation and
  // object-driven Property creation. Deals use `address_line_1` + `postal_code`;
  // tickets use `street_address` + `city` + `state` + `zip_code`.
  const addr = object?.properties ?? {};
  const objectStreet = kind === "deal" ? addr.address_line_1 : addr.street_address;
  const objectCity = addr.city;
  const objectState = addr.state;
  const objectZip = kind === "deal" ? addr.postal_code : addr.zip_code;
  const hasGeocodableAddress = !!(objectStreet && objectCity && objectState);
  // zip is optional for geocoding — street + city + state is sufficient

  // --- Object-driven Property creation helper ---
  // When the contact path can't find a matching Property, try creating one
  // from the deal/ticket's own address. This covers the gap where a deal or
  // ticket address differs from all of its contact's addresses.
  const tryCreatePropertyFromObjectAddress = async (): Promise<
    { id: string; hubspotObjectId: string } | null
  > => {
    if (!hasGeocodableAddress) return null;

    const upsert = await upsertPropertyFromGeocode({
      street: objectStreet!,
      city: objectCity!,
      state: objectState!,
      zip: objectZip || "", // zip optional — geocoder handles missing zip
    });

    if ("status" in upsert) {
      // Geocode failed or outside operating area — nothing we can do
      return null;
    }

    // Also associate the contact to this newly found/created Property so
    // future deal/ticket webhooks for this contact find it via the normal path.
    if (contactId) {
      await associateProperty(
        upsert.hubspotObjectId,
        "contacts",
        contactId,
        CONTACT_LABEL_ASSOCIATION_IDS.CURRENT_OWNER,
      );
      await prisma.propertyContactLink.upsert({
        where: {
          propertyId_contactId_label: {
            propertyId: upsert.propertyCacheId,
            contactId,
            label: "Current Owner",
          },
        },
        create: {
          propertyId: upsert.propertyCacheId,
          contactId,
          label: "Current Owner",
        },
        update: {},
      });
    }

    if (upsert.created) {
      await logActivity("PROPERTY_CREATED", `Property created from ${kind} address`, {
        kind,
        objectId,
        contactId,
        propertyCacheId: upsert.propertyCacheId,
      });
    }

    return { id: upsert.propertyCacheId, hubspotObjectId: upsert.hubspotObjectId };
  };

  if (!contactId) {
    // No contact — try the object's own address
    const fromObject = await tryCreatePropertyFromObjectAddress();
    if (!fromObject) {
      return { status: "deferred", reason: "no primary contact" };
    }
    // Skip contact-based lookup, go straight to association
    return finishAssociation(kind, objectId, fromObject, null);
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
      // Contact has no geocodable address — try the object's own address
      const fromObject = await tryCreatePropertyFromObjectAddress();
      if (fromObject) {
        return finishAssociation(kind, objectId, fromObject, contactId);
      }
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

  // 4) Pick a single Property. Disambiguate by geocoding the deal/ticket
  // address and matching `place_id` or `addressHash` against candidates.
  // Even when there's only one candidate, we verify the address matches —
  // a contact can have deals at multiple addresses, and blindly linking to
  // the single known Property produces cross-contamination (e.g. D&R jobs
  // from 10 different addresses all showing on one Property).
  let chosen: { id: string; hubspotObjectId: string } | null = null;

  if (hasGeocodableAddress) {
    const geo = await geocodeAddress({
      street: objectStreet!,
      city: objectCity!,
      state: objectState!,
      zip: objectZip || "",
      country: "USA",
    });
    const placeId = geo?.placeId ?? null;
    if (placeId) {
      const match = candidates.find((c) => c.googlePlaceId === placeId);
      if (match) chosen = { id: match.id, hubspotObjectId: match.hubspotObjectId };
    }
    // Fallback: rural / new-construction addresses geocode successfully
    // but without a placeId. Match by addressHash instead.
    if (!chosen && geo && !placeId) {
      const hash = addressHash({
        street: geo.streetAddress ?? (objectStreet as string),
        unit: null,
        city: geo.city ?? (objectCity as string),
        state: geo.state ?? (objectState as string),
        zip: geo.zip ?? (objectZip as string),
      });
      const match = candidates.find((c) => c.addressHash === hash);
      if (match) chosen = { id: match.id, hubspotObjectId: match.hubspotObjectId };
    }
  }

  // No address match among existing Properties — deal/ticket may be at a
  // NEW address. Try creating a Property from the object's own address.
  if (!chosen) {
    const fromObject = await tryCreatePropertyFromObjectAddress();
    if (fromObject) {
      chosen = fromObject;
    } else if (candidates.length === 1 && !hasGeocodableAddress) {
      // Last resort: deal has no geocodable address, contact has exactly one
      // Property — link there (better than orphaning entirely). This is the
      // only case where we skip address verification.
      chosen = { id: candidates[0].id, hubspotObjectId: candidates[0].hubspotObjectId };
    } else {
      return { status: "deferred", reason: "no address match among contact properties" };
    }
  }

  if (!chosen) {
    // Defensive — candidates.length was 0 above, we returned early. This
    // keeps the type checker happy without a non-null assertion.
    return { status: "deferred", reason: "no properties for contact" };
  }

  return finishAssociation(kind, objectId, chosen, contactId);
}

/**
 * Shared tail for `onDealOrTicketCreated` — associates the deal/ticket to the
 * chosen Property in HubSpot + DB and refreshes rollups.
 */
async function finishAssociation(
  kind: "deal" | "ticket",
  objectId: string,
  chosen: { id: string; hubspotObjectId: string },
  contactId: string | null,
): Promise<SyncOutcome> {
  // Mirror the association in HubSpot and in the local link table. HubSpot
  // has no HUBSPOT_DEFINED (typeId 1) default registered between Property and
  // Deal / Ticket — the portal only has USER_DEFINED labels — so we MUST pass
  // an explicit typeId or the create 400s with an "INVALID_OBJECT_IDS" error.
  await associateProperty(
    chosen.hubspotObjectId,
    kind === "deal" ? "deals" : "tickets",
    objectId,
    kind === "deal" ? dealAssocTypeId() : ticketAssocTypeId(),
  );

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

  // Refresh denormalized rollups so the associated counts and
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
 * Add-only association refresh: fetch current deals/tickets for a Property
 * from HubSpot and upsert each as a link row. Does not remove stale link
 * rows in v1 (see `reconcileSingleProperty` comment).
 *
 * Contact links are intentionally NOT refreshed here. HubSpot's association
 * pager doesn't surface labels cheaply, so this path used to default every
 * missing link to "Current Owner" — which invented ownership state we
 * couldn't actually observe (e.g. marking a Tenant as the Owner). The
 * webhook path owns contact-link upserts because it has access to the
 * real label via `HUBSPOT_PROPERTY_CONTACT_ASSOC_*` typeId → label mapping.
 */
async function refreshAssociationLinks(
  hubspotObjectId: string,
  propertyCacheId: string,
): Promise<void> {
  const [dealIds, ticketIds] = await Promise.all([
    fetchAssociatedIdsFromProperty(hubspotObjectId, "deals"),
    fetchAssociatedIdsFromProperty(hubspotObjectId, "tickets"),
  ]);

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

/**
 * Geocode a structured address and find-or-create a Property cache row.
 *
 * Used by `onContactAddressChange` for webhook-driven creation and by
 * `/api/properties/manual-create` for admin-driven creation. Intentionally
 * contact-agnostic: callers handle association, watermarks, and rollups.
 *
 * Returns `{ status: "failed", reason }` on geocode miss, non-US address,
 * or missing street component. Does NOT throw (callers decide how to surface).
 */
export async function upsertPropertyFromGeocode(args: {
  street: string;
  unit?: string | null;
  city: string;
  state: string;
  zip: string;
  country?: string;
}): Promise<
  | { propertyCacheId: string; hubspotObjectId: string; created: boolean }
  | { status: "failed"; reason: string }
> {
  const geo = await geocodeAddress({
    street: args.street,
    unit: args.unit,
    city: args.city,
    state: args.state,
    zip: args.zip,
    country: args.country ?? "USA",
  });
  if (!geo) {
    return { status: "failed", reason: "geocode failed" };
  }

  // Only create properties for PB's operating states.
  const ALLOWED_STATES = new Set(["CO", "CA"]);
  if (!geo.state || !ALLOWED_STATES.has(geo.state.toUpperCase())) {
    return { status: "failed", reason: `outside operating area: ${geo.state || geo.country || "unknown"}` };
  }

  // Reject geocode results with no street component — indicates the input
  // wasn't a real address (placeholder text, company names, etc.)
  if (!geo.streetAddress) {
    return { status: "failed", reason: "geocode returned no street component" };
  }

  const hash = addressHash({
    street: geo.streetAddress,
    unit: args.unit ?? null,
    city: geo.city,
    state: geo.state,
    zip: geo.zip,
  });

  // Two-key local dedup: check placeId first (canonical), then addressHash
  // as fallback. Previous logic was an exclusive OR that missed cases where
  // Google returned a different placeId for the same physical address.
  let existing = geo.placeId
    ? await prisma.hubSpotPropertyCache.findUnique({
        where: { googlePlaceId: geo.placeId },
      })
    : null;
  if (!existing) {
    existing = await prisma.hubSpotPropertyCache.findUnique({ where: { addressHash: hash } });
  }

  if (existing) {
    return {
      propertyCacheId: existing.id,
      hubspotObjectId: existing.hubspotObjectId,
      created: false,
    };
  }

  return createNewProperty({ geo, hash, unit: args.unit });
}
