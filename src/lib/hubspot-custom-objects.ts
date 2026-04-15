/**
 * HubSpot Custom Object Data Layer — AHJ & Utility
 *
 * Provides typed fetch helpers for the AHJ and Utility custom objects
 * discovered via GET /crm/v3/schemas.
 *
 * Object IDs (portal 21710069):
 *   AHJ     → 2-7957390  (p21710069_AHJ)
 *   Utility → 2-7957429  (p21710069_Utility)
 */

import { Client } from "@hubspot/api-client";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  numberOfApiCallRetries: 2,
});

// ---------------------------------------------------------------------------
// Object Type IDs
// ---------------------------------------------------------------------------

export const AHJ_OBJECT_TYPE = "2-7957390";
export const UTILITY_OBJECT_TYPE = "2-7957429";
export const LOCATION_OBJECT_TYPE = "2-50570396";

// ---------------------------------------------------------------------------
// Properties to fetch (non-hs_ business fields only)
// ---------------------------------------------------------------------------

/** AHJ properties relevant to D&E + P&I dashboards */
export const AHJ_PROPERTIES = [
  "record_name",
  "ahj_code",
  "city",
  "county",
  "state",
  "address",
  "email",
  "phone_number",
  "primary_contact_name",
  // Permitting
  "permits_required",
  "submission_method",
  "permit_turnaround_time",
  "average_permit_turnaround_time__365_days_",
  "most_recent_permit_turnaround_time",
  "last_90_days_permit_turnaround_time",
  "permit_issued_count",
  "permit_rejection_count",
  "average_permit_revision_count",
  "permit_turnaround_average",
  "permit_issues",
  "customer_signature_required_on_permit",
  "resubmission_required_",
  // Design / codes
  "design_snow_load",
  "design_wind_speed",
  "stamping_requirements",
  "fire_offsets_required",
  "fire_inspection_required",
  "snow_guards_required",
  "is_rsd_required_",
  "ibc_code",
  "ifc_code",
  "irc_code",
  "nec_code",
  "local_building_code",
  "local_electrical_code",
  "local_fire_code",
  "local_residential_code",
  "building_code_notes",
  "electrical_code_notes",
  "fire_code_notes",
  "residential_code_notes",
  "dr_permits_required",
  "dr_permit_requirements",
  "ev_permit_requirements",
  // Inspections
  "inspection_requirements",
  "inspection_notes",
  "electrician_required_for_inspection_",
  "inspection_turnaround_time",
  "inspection_turnaround_time__365_days_",
  "inspections_fpr",
  "count_of_inspections_passed",
  "count_of_inspections_failed",
  "total_first_time_passed_inspections",
  "total_inspections_passed__365__",
  "total_inspections_scheduled",
  // Deals
  "deal_count__365_days_",
  "last_90_days_deals",
  "number_of_associated_deals",
  // Misc
  "general_notes",
  "requires_utility_approval",
  "sales_tax_rate",
  "portal_link",
  "application_link",
  "payment_process",
  "service_area",
] as const;

/** Utility properties relevant to P&I dashboards */
export const UTILITY_PROPERTIES = [
  "record_name",
  "utility_company_name",
  "city",
  "state",
  "email",
  "phone_number",
  "primary_contact_name",
  "service_area",
  // Interconnection
  "interconnection_required",
  "average_interconnection_turnaround_time",
  "average_interconnection_revision_count",
  "interconnection_turnaround_average__365_days_",
  "most_recent_interconnection_turnaround_time",
  "last_90_days_interconnection_turnaround_time",
  "last_90_days_interconnection_approval_count",
  "rejection_count",
  "submission_type",
  "communicated_review_time",
  // PTO
  "pto_first_time_pass_rate",
  "pto_fpr__365_",
  "pto_passed__365_",
  "pto_notes",
  // Design
  "ac_disconnect_required_",
  "backup_switch_allowed_",
  "is_production_meter_required_",
  "system_size_rule",
  "design_notes",
  // Rates
  "energy_rate",
  "battery_arbitrage_summer",
  "battery_arbitrage_winter",
  "vpp_annual_sales",
  "vpp_per_battery",
  "fees",
  // Insurance / inspections
  "insurance_required",
  "inspection_required",
  "utility_inspection_required",
  "util_app_requires_customer_signature",
  // Deals
  "number_of_associated_deals",
  "utility_approval_count",
  // Misc
  "general_notes",
  "ia_notes",
  "rebate_information",
  "portal_link",
  "payment_process",
] as const;

/** Location properties relevant to inspection/construction metrics */
export const LOCATION_PROPERTIES = [
  "location_name",
  "pb_location",
  // Inspection rollups
  "inspection_turnaround_time",
  "inspection_turnaround_time__365_days_",
  "inspections_fpr",
  "inspections_first_time_pass_rate__365_days_",
  "fpr_inspections__365___not_rejected_",
  "count_of_inspections_passed",
  "total_inspections_passe_d__365_days_",
  "count_of_inspections_failed",
  "inspections_failed__365_days_",
  "count_of_inspections_passed_1st_time",
  "total_1st_time_passed_inspections__365_days_",
  "outstanding_failed_inspections",
  "outstanding_failed_inspections__not_rejected_",
  "needs_inspection_reinspection",
  "cc_pending_inspection",
  "ready_for_inspection",
  // Construction cross-match
  "construction_turnaround_time__365_",
  "count_of_cc__365_",
  "time_to_cc__365_",
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AHJRecord {
  id: string;
  properties: Record<string, string | null>;
}

export interface UtilityRecord {
  id: string;
  properties: Record<string, string | null>;
}

export interface LocationRecord {
  id: string;
  properties: Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// Rate-limit retry helper
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { hubspotClient as hubspotCustomObjectsClient };

export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") ||
          error.message.includes("rate") ||
          error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;

      if ((isRateLimit || statusCode === 429) && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt + 1) * 550 + Math.random() * 400;
        console.log(
          `[HubSpot Custom Objects] Rate limited (attempt ${attempt + 1}), retrying in ${Math.round(delay)}ms...`
        );
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

// ---------------------------------------------------------------------------
// AHJ Fetch Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all AHJ records with paginated iteration.
 * Returns up to ~10 000 records (HubSpot hard limit).
 */
export async function fetchAllAHJs(): Promise<AHJRecord[]> {
  const results: AHJRecord[] = [];
  let after: string | undefined;

  do {
    const response = await withRetry(() =>
      hubspotClient.crm.objects.basicApi.getPage(
        AHJ_OBJECT_TYPE,
        100,
        after,
        [...AHJ_PROPERTIES],
        undefined, // propertiesWithHistory
        undefined, // associations
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
 * Fetch AHJ records associated with a specific deal.
 * Paginates the association lookup to handle any cardinality.
 */
export async function fetchAHJsForDeal(
  dealId: string
): Promise<AHJRecord[]> {
  const ahjIds: string[] = [];
  let after: string | undefined;

  do {
    const associations = await withRetry(() =>
      hubspotClient.crm.associations.v4.basicApi.getPage(
        "deals",
        dealId,
        AHJ_OBJECT_TYPE,
        after,   // pagination cursor
        undefined, // limit — defaults to 500
      )
    );
    ahjIds.push(...associations.results.map((a) => a.toObjectId.toString()));
    after = associations.paging?.next?.after;
  } while (after);

  if (!ahjIds.length) return [];

  const props: string[] = [...AHJ_PROPERTIES];

  const response = await withRetry(() =>
    hubspotClient.crm.objects.batchApi.read(AHJ_OBJECT_TYPE, {
      inputs: ahjIds.map((id) => ({ id })),
      properties: props,
      propertiesWithHistory: [],
    })
  );

  return response.results.map((r) => ({
    id: r.id,
    properties: r.properties as Record<string, string | null>,
  }));
}

// ---------------------------------------------------------------------------
// Utility Fetch Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all Utility records with paginated iteration.
 */
export async function fetchAllUtilities(): Promise<UtilityRecord[]> {
  const results: UtilityRecord[] = [];
  let after: string | undefined;

  do {
    const response = await withRetry(() =>
      hubspotClient.crm.objects.basicApi.getPage(
        UTILITY_OBJECT_TYPE,
        100,
        after,
        [...UTILITY_PROPERTIES],
        undefined,
        undefined,
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
 * Fetch Utility records associated with a specific deal.
 * Paginates the association lookup to handle any cardinality.
 */
export async function fetchUtilitiesForDeal(
  dealId: string
): Promise<UtilityRecord[]> {
  const utilityIds: string[] = [];
  let after: string | undefined;

  do {
    const associations = await withRetry(() =>
      hubspotClient.crm.associations.v4.basicApi.getPage(
        "deals",
        dealId,
        UTILITY_OBJECT_TYPE,
        after,   // pagination cursor
        undefined, // limit — defaults to 500
      )
    );
    utilityIds.push(...associations.results.map((a) => a.toObjectId.toString()));
    after = associations.paging?.next?.after;
  } while (after);

  if (!utilityIds.length) return [];

  const props: string[] = [...UTILITY_PROPERTIES];

  const response = await withRetry(() =>
    hubspotClient.crm.objects.batchApi.read(UTILITY_OBJECT_TYPE, {
      inputs: utilityIds.map((id) => ({ id })),
      properties: props,
      propertiesWithHistory: [],
    })
  );

  return response.results.map((r) => ({
    id: r.id,
    properties: r.properties as Record<string, string | null>,
  }));
}

// ---------------------------------------------------------------------------
// Location Fetch Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all Location records with paginated iteration.
 */
export async function fetchAllLocations(): Promise<LocationRecord[]> {
  const results: LocationRecord[] = [];
  let after: string | undefined;

  do {
    const response = await withRetry(() =>
      hubspotClient.crm.objects.basicApi.getPage(
        LOCATION_OBJECT_TYPE,
        100,
        after,
        [...LOCATION_PROPERTIES],
        undefined,
        undefined,
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
