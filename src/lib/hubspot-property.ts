/**
 * HubSpot Custom Object Data Layer — Property
 *
 * Thin typed wrappers around the HubSpot CRM Objects + Associations v4 APIs
 * for the Property custom object. Mirrors the patterns in `hubspot-custom-objects.ts`
 * (AHJ / Utility / Location).
 *
 * The HubSpot custom object type ID is supplied via env var
 * `HUBSPOT_PROPERTY_OBJECT_TYPE` (e.g. "2-XXXXXXX") because it is portal-specific
 * and may differ between sandbox / production.
 */

import { Client } from "@hubspot/api-client";
import { AssociationSpecAssociationCategoryEnum } from "@hubspot/api-client/lib/codegen/crm/associations/v4";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/objects/models/Filter";
import { withRetry } from "@/lib/hubspot-custom-objects";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  numberOfApiCallRetries: 2,
});

// ---------------------------------------------------------------------------
// Object Type ID (env-driven; portal-specific)
// ---------------------------------------------------------------------------

const PROPERTY_OBJECT_TYPE = (): string => {
  const id = process.env.HUBSPOT_PROPERTY_OBJECT_TYPE;
  if (!id) throw new Error("HUBSPOT_PROPERTY_OBJECT_TYPE is not set");
  return id;
};

// ---------------------------------------------------------------------------
// Properties to fetch / update
// ---------------------------------------------------------------------------

// NOTE: `address_hash` is intentionally absent — it lives in the DB cache only
// (`HubSpotPropertyCache.addressHash @unique`), not on the HubSpot object.
export const PROPERTY_PROPERTIES = [
  "record_name",
  "google_place_id",
  "normalized_address",
  "full_address",
  "street_address",
  "unit_number",
  "city",
  "state",
  "zip",
  "county",
  "latitude",
  "longitude",
  "attom_id",
  "first_install_date",
  "most_recent_install_date",
  "associated_deals_count",
  "associated_tickets_count",
  "open_tickets_count",
  "system_size_kw_dc",
  "has_battery",
  "has_ev_charger",
  "last_service_date",
  "earliest_warranty_expiry",
  "ahj_name",
  "utility_name",
  "pb_location",
  "property_type",
  "main_panel_amperage",
  "main_panel_manufacturer",
  "service_entrance_type",
  "general_notes",
  "parcel_apn",
  "zoning",
  "assessed_value",
  "last_sale_date",
  "last_sale_price",
  "public_record_owner_name",
  "year_built",
  "square_footage",
  "lot_size_sqft",
  "stories",
  "bedrooms",
  "bathrooms",
  "foundation_type",
  "construction_type",
  "roof_material",
  "roof_age_years",
  "roof_last_replaced_year",
  "roof_condition_notes",
  "flood_zone",
  "wildfire_risk_zone",
  "hoa_name",
  "attom_last_synced_at",
  "attom_match_confidence",
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PropertyRecord {
  id: string;
  properties: Record<string, string | null>;
}

export type PropertyAssociableObjectType =
  | "contacts"
  | "deals"
  | "tickets"
  | "companies"
  | string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Coerce arbitrary input values into the `Record<string, string>` shape
 * HubSpot's CRM Objects API expects:
 *   - `null`/`undefined` → `""` (empty string clears the property)
 *   - `boolean`          → `"true" | "false"`
 *   - everything else    → `String(value)`
 */
function coerceHubSpotProps(
  props: Record<string, string | number | boolean | null | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) {
      out[key] = "";
    } else if (typeof value === "boolean") {
      out[key] = value ? "true" : "false";
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

/**
 * Internal helper: batch-read a set of property IDs and return PropertyRecords.
 * Returns `[]` when given no IDs.
 */
async function batchReadProperties(ids: string[]): Promise<PropertyRecord[]> {
  if (!ids.length) return [];
  const props: string[] = [...PROPERTY_PROPERTIES];

  const response = await withRetry(() =>
    hubspotClient.crm.objects.batchApi.read(PROPERTY_OBJECT_TYPE(), {
      inputs: ids.map((id) => ({ id })),
      properties: props,
      propertiesWithHistory: [],
    })
  );

  return response.results.map((r) => ({
    id: r.id,
    properties: r.properties as Record<string, string | null>,
  }));
}

/**
 * Internal helper: page through associations from one object to property
 * records, batch-read those properties, and return as PropertyRecord[].
 */
async function fetchPropertiesFor(
  fromObjectType: "contacts" | "deals" | "tickets" | "companies",
  fromObjectId: string
): Promise<PropertyRecord[]> {
  const propertyIds: string[] = [];
  let after: string | undefined;

  do {
    const associations = await withRetry(() =>
      hubspotClient.crm.associations.v4.basicApi.getPage(
        fromObjectType,
        fromObjectId,
        PROPERTY_OBJECT_TYPE(),
        after,
        undefined
      )
    );
    propertyIds.push(
      ...associations.results.map((a) => a.toObjectId.toString())
    );
    after = associations.paging?.next?.after;
  } while (after);

  return batchReadProperties(propertyIds);
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all Property records via paged listing.
 * Uses `basicApi.getPage` with cursor-based pagination (HubSpot hard limit ~10k).
 */
export async function fetchAllProperties(): Promise<PropertyRecord[]> {
  const results: PropertyRecord[] = [];
  let after: string | undefined;

  do {
    const response = await withRetry(() =>
      hubspotClient.crm.objects.basicApi.getPage(
        PROPERTY_OBJECT_TYPE(),
        100,
        after,
        [...PROPERTY_PROPERTIES],
        undefined,
        undefined
      )
    );

    results.push(
      ...response.results.map((r) => ({
        id: r.id,
        properties: r.properties as Record<string, string | null>,
      }))
    );
    after = response.paging?.next?.after;
  } while (after);

  return results;
}

/**
 * Fetch a single Property record by its HubSpot object ID.
 * Returns `null` if the object is missing (404).
 */
export async function fetchPropertyById(
  id: string
): Promise<PropertyRecord | null> {
  try {
    const response = await withRetry(() =>
      hubspotClient.crm.objects.basicApi.getById(
        PROPERTY_OBJECT_TYPE(),
        id,
        [...PROPERTY_PROPERTIES],
        undefined,
        undefined
      )
    );
    return {
      id: response.id,
      properties: response.properties as Record<string, string | null>,
    };
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 404) return null;
    throw err;
  }
}

/**
 * Page through associations FROM a Property TO another object type, returning
 * the associated object IDs. Used by the nightly reconciliation cron to
 * refresh local `PropertyContactLink` / `PropertyDealLink` / `PropertyTicketLink`
 * rows against HubSpot's source of truth.
 */
export async function fetchAssociatedIdsFromProperty(
  propertyId: string,
  toObjectType: "contacts" | "deals" | "tickets" | "companies"
): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;

  do {
    const associations = await withRetry(() =>
      hubspotClient.crm.associations.v4.basicApi.getPage(
        PROPERTY_OBJECT_TYPE(),
        propertyId,
        toObjectType,
        after,
        undefined
      )
    );
    ids.push(...associations.results.map((a) => a.toObjectId.toString()));
    after = associations.paging?.next?.after;
  } while (after);

  return ids;
}

/** Fetch all Property records associated with a given contact. */
export async function fetchPropertiesForContact(
  contactId: string
): Promise<PropertyRecord[]> {
  return fetchPropertiesFor("contacts", contactId);
}

/** Fetch all Property records associated with a given deal. */
export async function fetchPropertiesForDeal(
  dealId: string
): Promise<PropertyRecord[]> {
  return fetchPropertiesFor("deals", dealId);
}

/** Fetch all Property records associated with a given ticket. */
export async function fetchPropertiesForTicket(
  ticketId: string
): Promise<PropertyRecord[]> {
  return fetchPropertiesFor("tickets", ticketId);
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * Create a new Property record. Returns the new HubSpot object ID.
 */
export async function createProperty(
  props: Record<string, string | number | boolean | null>
): Promise<{ id: string }> {
  const response = await withRetry(() =>
    hubspotClient.crm.objects.basicApi.create(PROPERTY_OBJECT_TYPE(), {
      properties: coerceHubSpotProps(props),
      associations: [],
    })
  );
  return { id: response.id };
}

/**
 * Update properties on an existing Property record.
 * Pass `null` for any field you want to clear.
 */
export async function updateProperty(
  id: string,
  props: Record<string, string | number | boolean | null>
): Promise<void> {
  await withRetry(() =>
    hubspotClient.crm.objects.basicApi.update(PROPERTY_OBJECT_TYPE(), id, {
      properties: coerceHubSpotProps(props),
    })
  );
}

/**
 * Associate a Property record with another HubSpot object (deal / contact /
 * ticket / company). When `labelAssociationTypeId` is provided, a USER_DEFINED
 * (labeled) association is created — otherwise the default unlabeled
 * HUBSPOT_DEFINED association (typeId 1) is used.
 */
export async function associateProperty(
  propertyId: string,
  toObjectType: PropertyAssociableObjectType,
  toObjectId: string,
  labelAssociationTypeId?: number
): Promise<void> {
  const associationSpec = labelAssociationTypeId
    ? [
        {
          associationCategory:
            AssociationSpecAssociationCategoryEnum.UserDefined,
          associationTypeId: labelAssociationTypeId,
        },
      ]
    : [
        {
          associationCategory:
            AssociationSpecAssociationCategoryEnum.HubspotDefined,
          associationTypeId: 1,
        },
      ];

  await withRetry(() =>
    hubspotClient.crm.associations.v4.basicApi.create(
      PROPERTY_OBJECT_TYPE(),
      propertyId,
      toObjectType,
      toObjectId,
      associationSpec
    )
  );
}

/**
 * Remove all associations between a Property record and another object.
 * (Exported for completeness — not used in v1 but handy.)
 */
export async function dissociateProperty(
  propertyId: string,
  toObjectType: PropertyAssociableObjectType,
  toObjectId: string
): Promise<void> {
  await withRetry(() =>
    hubspotClient.crm.associations.v4.basicApi.archive(
      PROPERTY_OBJECT_TYPE(),
      propertyId,
      toObjectType,
      toObjectId
    )
  );
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

/**
 * Look up a Property by its `google_place_id` (canonical dedup key when Google
 * returned a place_id). Returns `null` if no match.
 */
export async function searchPropertyByPlaceId(
  placeId: string
): Promise<PropertyRecord | null> {
  const response = await withRetry(() =>
    hubspotClient.crm.objects.searchApi.doSearch(PROPERTY_OBJECT_TYPE(), {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "google_place_id",
              operator: FilterOperatorEnum.Eq,
              value: placeId,
            },
          ],
        },
      ],
      properties: [...PROPERTY_PROPERTIES],
      limit: 1,
      after: "0",
      sorts: [],
      query: "",
    })
  );
  const r = response.results[0];
  if (!r) return null;
  return {
    id: r.id,
    properties: r.properties as Record<string, string | null>,
  };
}

/**
 * Look up a Property by its address hash.
 *
 * IMPORTANT: `address_hash` is NOT a HubSpot property — it lives only on the
 * local `HubSpotPropertyCache.addressHash @unique` row. So this lookup is
 * indirect: find the cache row first, then read the corresponding HubSpot
 * object via `fetchPropertyById`. Returns `null` if no cache row exists.
 */
export async function searchPropertyByAddressHash(
  hash: string
): Promise<PropertyRecord | null> {
  if (!prisma) throw new Error("Database unavailable");

  const cache = await prisma.hubSpotPropertyCache.findUnique({
    where: { addressHash: hash },
    select: { hubspotObjectId: true },
  });

  if (!cache) return null;
  return fetchPropertyById(cache.hubspotObjectId);
}

/**
 * Best-effort lookup of a Property by its exact `normalized_address` string.
 *
 * Used as a HubSpot-side dedup check when Google did NOT return a `place_id`
 * (rural / new-construction addresses) and we would otherwise fall through to
 * a fresh create. This is intentionally NOT a canonical key — the DB-side
 * `addressHash` is the source of truth for dedup. We trust this enough to
 * adopt an existing HubSpot record rather than create a second, but not
 * enough to rely on it for correctness.
 *
 * Returns `null` if no exact match.
 */
export async function searchPropertyByNormalizedAddress(
  normalizedAddress: string
): Promise<PropertyRecord | null> {
  if (!normalizedAddress) return null;
  const response = await withRetry(() =>
    hubspotClient.crm.objects.searchApi.doSearch(PROPERTY_OBJECT_TYPE(), {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "normalized_address",
              operator: FilterOperatorEnum.Eq,
              value: normalizedAddress,
            },
          ],
        },
      ],
      properties: [...PROPERTY_PROPERTIES],
      limit: 1,
      after: "0",
      sorts: [],
      query: "",
    })
  );
  const r = response.results[0];
  if (!r) return null;
  return {
    id: r.id,
    properties: r.properties as Record<string, string | null>,
  };
}

/**
 * Archive (soft-delete) a Property record. Used to clean up orphan HubSpot
 * objects produced when our create-side dedup loses a race — see
 * `createNewProperty` in `property-sync.ts`. Best-effort: callers must handle
 * failures (we log + Sentry; never throw into the sync flow).
 */
export async function archiveProperty(id: string): Promise<void> {
  await withRetry(() =>
    hubspotClient.crm.objects.basicApi.archive(PROPERTY_OBJECT_TYPE(), id)
  );
}
