// scripts/create-hubspot-property-object.ts
// Usage: HUBSPOT_ACCESS_TOKEN=... tsx scripts/create-hubspot-property-object.ts
// Creates the Property custom object in the currently authenticated portal (whichever token is loaded).
// After success, it prints the objectTypeId + association IDs — copy them to .env and Vercel env vars.
// IDEMPOTENT: safe to re-run; reports "already exists" without side effects.

import "dotenv/config";
import { Client } from "@hubspot/api-client";

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("HUBSPOT_ACCESS_TOKEN is required");
  process.exit(1);
}

const hubspot = new Client({ accessToken: TOKEN, numberOfApiCallRetries: 2 });

// ---------------------------------------------------------------------------
// Property definitions — copied from the spec's Field table.
// (docs/superpowers/specs/2026-04-14-hubspot-property-object-design.md §HubSpot Object Schema)
//
// NOTE: `address_hash` is intentionally EXCLUDED from this list. It lives only
// in the Neon cache (`HubSpotPropertyCache.addressHash @unique` — see
// prisma/schema.prisma), not on the HubSpot object. Keeping it out of HubSpot
// avoids UI noise and duplicating a uniqueness check the DB already owns. See
// `property-sync.ts` for dedup enforcement (search-by-place_id first, then
// DB unique constraint as the backstop).
// ---------------------------------------------------------------------------

type HubSpotPropertyDef = {
  name: string;
  label: string;
  type: "string" | "number" | "date" | "datetime" | "bool" | "enumeration";
  fieldType: "text" | "textarea" | "number" | "date" | "booleancheckbox" | "select";
  groupName: string;
  description?: string;
  options?: Array<{ label: string; value: string; displayOrder?: number }>;
};

const GROUP_IDENTITY = "property_identity";
const GROUP_PARCEL = "property_parcel";
const GROUP_STRUCTURE = "property_structure";
const GROUP_ROOF = "property_roof";
const GROUP_RISK = "property_risk";
const GROUP_ELECTRICAL = "property_electrical";
const GROUP_ROLLUPS = "property_rollups";
const GROUP_GEO = "property_geo_links";
const GROUP_SYNC = "property_sync_meta";
const GROUP_NOTES = "property_notes";

const str = (name: string, label: string, groupName: string, description?: string): HubSpotPropertyDef => ({
  name,
  label,
  type: "string",
  fieldType: "text",
  groupName,
  ...(description ? { description } : {}),
});

const num = (name: string, label: string, groupName: string, description?: string): HubSpotPropertyDef => ({
  name,
  label,
  type: "number",
  fieldType: "number",
  groupName,
  ...(description ? { description } : {}),
});

const date = (name: string, label: string, groupName: string, description?: string): HubSpotPropertyDef => ({
  name,
  label,
  type: "date",
  fieldType: "date",
  groupName,
  ...(description ? { description } : {}),
});

const bool = (name: string, label: string, groupName: string, description?: string): HubSpotPropertyDef => ({
  name,
  label,
  type: "bool",
  fieldType: "booleancheckbox",
  groupName,
  // HubSpot requires boolean properties to declare exactly two options with
  // values 'true' and 'false'. Without this the schema create call 400s with
  // "Boolean properties must have exactly two options".
  options: [
    { label: "Yes", value: "true", displayOrder: 0 },
    { label: "No", value: "false", displayOrder: 1 },
  ],
  ...(description ? { description } : {}),
});

const richText = (name: string, label: string, groupName: string, description?: string): HubSpotPropertyDef => ({
  name,
  label,
  type: "string",
  fieldType: "textarea",
  groupName,
  ...(description ? { description } : {}),
});

const PROPERTY_FIELDS: HubSpotPropertyDef[] = [
  // Identity
  str("record_name", "Record Name", GROUP_IDENTITY, 'Computed display name, e.g. "1234 Main St, Boulder CO 80301"'),
  str("google_place_id", "Google Place ID", GROUP_IDENTITY, "Google Geocoding place_id"),
  str("normalized_address", "Normalized Address", GROUP_IDENTITY, "Lowercased/trimmed address used for dedup"),
  str("full_address", "Full Address", GROUP_IDENTITY, "Formatted address from Google Geocoding"),
  str("street_address", "Street Address", GROUP_IDENTITY),
  str("unit_number", "Unit Number", GROUP_IDENTITY),
  str("city", "City", GROUP_IDENTITY),
  str("state", "State", GROUP_IDENTITY),
  str("zip", "ZIP", GROUP_IDENTITY),
  str("county", "County", GROUP_IDENTITY),
  num("latitude", "Latitude", GROUP_IDENTITY),
  num("longitude", "Longitude", GROUP_IDENTITY),
  str("attom_id", "ATTOM ID", GROUP_IDENTITY, "ATTOM property identifier (future)"),

  // Parcel / ownership
  str("parcel_apn", "Parcel APN", GROUP_PARCEL, "Assessor's parcel number (ATTOM, future)"),
  str("zoning", "Zoning", GROUP_PARCEL),
  num("assessed_value", "Assessed Value", GROUP_PARCEL),
  date("last_sale_date", "Last Sale Date", GROUP_PARCEL),
  num("last_sale_price", "Last Sale Price", GROUP_PARCEL),
  str("public_record_owner_name", "Public Record Owner Name", GROUP_PARCEL),

  // Structure
  {
    name: "property_type",
    label: "Property Type",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_STRUCTURE,
    description: "High-level classification from ATTOM or manual entry",
    options: [
      { label: "Residential", value: "residential", displayOrder: 0 },
      { label: "Multi-Family", value: "multi_family", displayOrder: 1 },
      { label: "Commercial", value: "commercial", displayOrder: 2 },
      { label: "Land", value: "land", displayOrder: 3 },
      { label: "Other", value: "other", displayOrder: 4 },
    ],
  },
  num("year_built", "Year Built", GROUP_STRUCTURE),
  num("square_footage", "Square Footage", GROUP_STRUCTURE),
  num("lot_size_sqft", "Lot Size (sqft)", GROUP_STRUCTURE),
  num("stories", "Stories", GROUP_STRUCTURE),
  num("bedrooms", "Bedrooms", GROUP_STRUCTURE),
  num("bathrooms", "Bathrooms", GROUP_STRUCTURE),
  str("foundation_type", "Foundation Type", GROUP_STRUCTURE),
  str("construction_type", "Construction Type", GROUP_STRUCTURE),

  // Roof
  str("roof_material", "Roof Material", GROUP_ROOF),
  num("roof_age_years", "Roof Age (years)", GROUP_ROOF, "Derived from roof_last_replaced_year"),
  num("roof_last_replaced_year", "Roof Last Replaced (year)", GROUP_ROOF),
  richText("roof_condition_notes", "Roof Condition Notes", GROUP_ROOF),

  // Risk / permitting
  str("flood_zone", "Flood Zone", GROUP_RISK),
  str("wildfire_risk_zone", "Wildfire Risk Zone", GROUP_RISK),
  str("hoa_name", "HOA Name", GROUP_RISK),

  // Electrical
  num("main_panel_amperage", "Main Panel Amperage", GROUP_ELECTRICAL),
  str("main_panel_manufacturer", "Main Panel Manufacturer", GROUP_ELECTRICAL),
  str("service_entrance_type", "Service Entrance Type", GROUP_ELECTRICAL),

  // Rollups (sync-maintained, treat as read-only in UI)
  date("first_install_date", "First Install Date", GROUP_ROLLUPS, "Earliest install date across associated deals"),
  date("most_recent_install_date", "Most Recent Install Date", GROUP_ROLLUPS),
  num("associated_deals_count", "Associated Deals Count", GROUP_ROLLUPS),
  num("associated_tickets_count", "Associated Tickets Count", GROUP_ROLLUPS),
  num("open_tickets_count", "Open Tickets Count", GROUP_ROLLUPS),
  num("system_size_kw_dc", "System Size (kW DC)", GROUP_ROLLUPS, "Sum of DC system size from line items across deals"),
  bool("has_battery", "Has Battery", GROUP_ROLLUPS),
  bool("has_ev_charger", "Has EV Charger", GROUP_ROLLUPS),
  date("last_service_date", "Last Service Date", GROUP_ROLLUPS),
  date("earliest_warranty_expiry", "Earliest Warranty Expiry", GROUP_ROLLUPS),

  // Geographic links (denormalized strings for HubSpot-side filtering)
  str("ahj_name", "AHJ Name", GROUP_GEO),
  str("utility_name", "Utility Name", GROUP_GEO),
  str("pb_location", "PB Location", GROUP_GEO),

  // Sync metadata
  date("attom_last_synced_at", "ATTOM Last Synced At", GROUP_SYNC),
  str("attom_match_confidence", "ATTOM Match Confidence", GROUP_SYNC),

  // Notes
  richText("general_notes", "General Notes", GROUP_NOTES),
];

// ---------------------------------------------------------------------------
// Association labels — defined in spec §Associations table.
// Contact side uses toObjectType "0-1"; Company side uses "0-2".
// ---------------------------------------------------------------------------

const CONTACT_LABELS = [
  "Current Owner",
  "Previous Owner",
  "Tenant",
  "Property Manager",
  "Authorized Contact",
] as const;

const COMPANY_LABELS = ["Owner", "Manager"] as const;

// Hardcoded custom-object type IDs from `src/lib/hubspot-custom-objects.ts`.
// These are portal-specific (production values); in a sandbox portal the IDs
// will differ and this block needs to be adjusted before running there.
// TODO: promote these to env vars (e.g. HUBSPOT_AHJ_OBJECT_TYPE, ...) to
// parallel the new HUBSPOT_PROPERTY_OBJECT_TYPE pattern.
const AHJ_OBJECT_TYPE = process.env.HUBSPOT_AHJ_OBJECT_TYPE ?? "2-7957390";
const UTILITY_OBJECT_TYPE = process.env.HUBSPOT_UTILITY_OBJECT_TYPE ?? "2-7957429";
const LOCATION_OBJECT_TYPE = process.env.HUBSPOT_LOCATION_OBJECT_TYPE ?? "2-50570396";

function envKey(label: string): string {
  return label.toUpperCase().replace(/\s+/g, "_");
}

// HubSpot association-definition `name` values are unique PORTAL-WIDE, not per
// (fromTypeId, toTypeId) pair. Bare names like "OWNER" / "TENANT" already
// exist in portal 21710069 from other custom objects, so we namespace ours.
// Env var keys stay unprefixed (HUBSPOT_PROPERTY_CONTACT_ASSOC_TENANT, etc.)
// to match the runbook and integration guide.
function hubspotAssocName(label: string): string {
  return `PROPERTY_${envKey(label)}`;
}

// ---------------------------------------------------------------------------
// Helper: ensure a single association label exists, creating it if absent.
//
// GETs existing labels for the (fromTypeId, toTypeId) pair and skips the POST
// if a label with the same name already exists — making this safe to call on
// both the "newly created object" path and the "object already existed" recovery
// path. On POST error the label is logged and skipped (Fix 3); the caller
// accumulates whichever IDs succeed.
// ---------------------------------------------------------------------------

async function ensureLabel(
  propertyTypeId: string,
  toTypeId: string,
  label: string,
  labelIds: Record<string, number>,
  failures: string[],
): Promise<void> {
  const key = envKey(label);
  const name = hubspotAssocName(label);

  // Check whether this label already exists.
  try {
    const existing = await hubspot
      .apiRequest({
        method: "GET",
        path: `/crm/v4/associations/${propertyTypeId}/${toTypeId}/labels`,
      })
      .then((r) => r.json());
    const results: Array<{ typeId?: number; label?: string; name?: string }> =
      existing?.results ?? [];
    const found = results.find((r) => r.label === label || r.name === name);
    if (found && typeof found.typeId === "number") {
      console.log(`Skipped existing label: ${label}`);
      labelIds[key] = found.typeId;
      return;
    }
  } catch (err) {
    // Non-fatal — proceed to attempt creation.
    console.warn(`  ! Could not fetch existing labels for "${label}" — attempting POST anyway:`, err);
  }

  // Create the label (Fix 3: per-label try/catch).
  try {
    console.log(`Creating association label: ${label}`);
    const res = await hubspot
      .apiRequest({
        method: "POST",
        path: `/crm/v4/associations/${propertyTypeId}/${toTypeId}/labels`,
        body: {
          label,
          name,
          category: "USER_DEFINED",
        },
      })
      .then((r) => r.json());
    const typeId = res?.results?.[0]?.typeId;
    if (typeof typeId === "number") {
      labelIds[key] = typeId;
    } else {
      console.warn(`  ! Could not parse typeId for "${label}" — response:`, JSON.stringify(res));
      failures.push(label);
    }
  } catch (err) {
    console.error(`Failed to create label ${label}:`, err);
    failures.push(label);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Check if object already exists by name or singular label.
  const schemas = await hubspot.crm.schemas.coreApi.getAll();
  const existing = schemas.results.find(
    (s) => s.name === "property" || s.labels?.singular === "Property",
  );

  let propertyTypeId: string;

  if (existing) {
    // Object already exists. Re-running now reconciles any missing labels that
    // were not created on a previous (partial) run — no destructive reset needed.
    propertyTypeId = existing.objectTypeId;
    console.log(`Property object already exists: ${propertyTypeId}`);
    console.log("Continuing to reconcile association labels...");
  } else {
    // 2. Create the object with identity + geographic + rollup + ATTOM fields.
    console.log("Creating Property custom object...");
    const created = await hubspot.crm.schemas.coreApi.create({
      name: "property",
      labels: { singular: "Property", plural: "Properties" },
      primaryDisplayProperty: "record_name",
      // NOTE: `google_place_id` is intentionally NOT required. The spec supports
      // addresses where Google returns no place_id (rural, PO Box, new
      // construction); those rows dedup via the DB-side `addressHash` unique
      // index (see `HubSpotPropertyCache.addressHash` in the Neon cache schema).
      requiredProperties: ["record_name", "full_address"],
      searchableProperties: [
        "record_name",
        "full_address",
        "normalized_address",
        "street_address",
        "city",
        "zip",
        "google_place_id",
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: PROPERTY_FIELDS as any,
      associatedObjects: ["CONTACT", "DEAL", "TICKET", "COMPANY"],
    });

    propertyTypeId = created.objectTypeId;
    console.log(`Created Property object: ${propertyTypeId}`);
  }

  const failures: string[] = [];

  // 3. Reconcile association labels on the Contact side (toObjectType 0-1).
  //    v4 label endpoint: POST /crm/v4/associations/{fromTypeId}/{toTypeId}/labels
  //    Body: { label, name, category: "USER_DEFINED", inverseLabel? }
  //    Response: { results: [{ typeId, label, category }] }
  const contactLabelIds: Record<string, number> = {};
  for (const label of CONTACT_LABELS) {
    await ensureLabel(propertyTypeId, "0-1", label, contactLabelIds, failures);
  }

  // 4. Reconcile association labels on the Company side (toObjectType 0-2).
  const companyLabelIds: Record<string, number> = {};
  for (const label of COMPANY_LABELS) {
    await ensureLabel(propertyTypeId, "0-2", label, companyLabelIds, failures);
  }

  // 5. Custom-object associations (AHJ, Utility, Location).
  //    Unlabeled (many-to-one, per spec). `associatedObjects` in the create
  //    payload only accepts standard objects (CONTACT/DEAL/TICKET/COMPANY), so
  //    custom-object associations must be registered separately.
  //
  //    v4 endpoint: POST /crm/v4/associations/{fromTypeId}/{toTypeId}/labels
  //    with a null/empty label produces an unlabeled definition. Uncomment
  //    and verify against your sandbox portal before running in prod:
  //
  //    for (const customTypeId of [AHJ_OBJECT_TYPE, UTILITY_OBJECT_TYPE, LOCATION_OBJECT_TYPE]) {
  //      await hubspot.apiRequest({
  //        method: "POST",
  //        path: `/crm/v4/associations/${propertyTypeId}/${customTypeId}/labels`,
  //        body: { label: null, name: `PROPERTY_TO_${customTypeId}` },
  //      });
  //    }
  //
  // Left commented pending manual verification — the production type IDs
  // (2-7957390 / 2-7957429 / 2-50570396) will not exist in a fresh sandbox.
  void AHJ_OBJECT_TYPE;
  void UTILITY_OBJECT_TYPE;
  void LOCATION_OBJECT_TYPE;

  // 6. Pretty-print env block (includes both existing and newly created IDs).
  console.log("\n# Paste into .env and Vercel env vars:");
  console.log(`HUBSPOT_PROPERTY_OBJECT_TYPE=${propertyTypeId}`);
  for (const [k, v] of Object.entries(contactLabelIds)) {
    console.log(`HUBSPOT_PROPERTY_CONTACT_ASSOC_${k}=${v}`);
  }
  for (const [k, v] of Object.entries(companyLabelIds)) {
    console.log(`HUBSPOT_PROPERTY_COMPANY_ASSOC_${k}=${v}`);
  }

  if (failures.length > 0) {
    console.warn(`\n⚠️ ${failures.length} label${failures.length === 1 ? "" : "s"} failed — re-run after resolving the errors above.`);
  } else {
    console.log("\nDone.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
