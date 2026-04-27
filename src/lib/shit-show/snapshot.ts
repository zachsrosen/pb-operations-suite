/**
 * Shit Show — snapshot helpers
 *
 * - snapshotFlaggedDeals(sessionId): pulls every deal where pb_shit_show_flagged=true
 *   from HubSpot and creates one ShitShowSessionItem per deal.
 * - readShitShowFlagsBatch(dealIds): batched property read for known dealIds; used
 *   by the IDR preview route to hydrate the flag without per-deal fetches.
 */

import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import { SHIT_SHOW_PROPS } from "@/lib/shit-show/hubspot-flag";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";

export type FlagBatchEntry = { flagged: boolean; reason: string | null };

/**
 * Read the shit-show flag for many deals in one HubSpot call (batched 100 at a time).
 * Used by the IDR preview hydration to avoid N round-trips.
 */
export async function readShitShowFlagsBatch(
  dealIds: string[],
): Promise<Map<string, FlagBatchEntry>> {
  const result = new Map<string, FlagBatchEntry>();
  if (dealIds.length === 0) return result;

  for (let i = 0; i < dealIds.length; i += 100) {
    const slice = dealIds.slice(i, i + 100);
    try {
      const res = await hubspotClient.crm.deals.batchApi.read({
        properties: [SHIT_SHOW_PROPS.FLAGGED, SHIT_SHOW_PROPS.REASON],
        propertiesWithHistory: [],
        inputs: slice.map((id) => ({ id })),
      });
      for (const deal of res.results) {
        const props = (deal.properties ?? {}) as Record<string, string | null | undefined>;
        result.set(deal.id, {
          flagged: props[SHIT_SHOW_PROPS.FLAGGED] === "true",
          reason: (props[SHIT_SHOW_PROPS.REASON] as string | null) || null,
        });
      }
    } catch (e) {
      console.error("[shit-show] batch flag read failed for slice", e);
      // Leave unset entries as missing — caller treats unset as "not flagged".
    }
  }
  return result;
}

/**
 * Snapshot every deal currently flagged in HubSpot into the given session.
 *
 * Idempotent: re-running against the same session skips deals already snapshotted
 * (relies on the @@unique([sessionId, dealId]) constraint).
 */
export async function snapshotFlaggedDeals(sessionId: string): Promise<{
  created: number;
  skipped: number;
}> {
  const properties = [
    "dealname", "amount", "system_size_kw", "dealstage", "hubspot_owner_id",
    SHIT_SHOW_PROPS.REASON, SHIT_SHOW_PROPS.FLAGGED_SINCE,
    "address", "project_type", "equipment_summary", "pb_location",
    "survey_status", "survey_date", "design_status", "layout_status",
    "planset_date", "ahj", "utility_company",
    "project_manager", "operations_manager", "site_surveyor",
    "drive_folder_url", "survey_folder_url", "design_folder_url",
    "sales_documents", "open_solar_url",
  ];

  let created = 0;
  let skipped = 0;
  let after: string | undefined;

  do {
    const results = await hubspotClient.crm.deals.searchApi.doSearch({
      filterGroups: [{
        filters: [{
          propertyName: SHIT_SHOW_PROPS.FLAGGED,
          operator: FilterOperatorEnum.Eq,
          value: "true",
        }],
      }],
      properties,
      limit: 100,
      ...(after ? { after } : {}),
    });

    for (const deal of results.results) {
      const p = (deal.properties ?? {}) as Record<string, string | null | undefined>;
      try {
        await prisma.shitShowSessionItem.create({
          data: {
            sessionId,
            dealId: deal.id,
            region: p.pb_location ?? "Unknown",
            dealName: p.dealname ?? "(no name)",
            dealAmount: p.amount ? Number(p.amount) : null,
            systemSizeKw: p.system_size_kw ? Number(p.system_size_kw) : null,
            stage: p.dealstage ?? null,
            dealOwner: p.hubspot_owner_id ?? null,
            reasonSnapshot: p[SHIT_SHOW_PROPS.REASON] ?? null,
            flaggedSince: p[SHIT_SHOW_PROPS.FLAGGED_SINCE]
              ? new Date(p[SHIT_SHOW_PROPS.FLAGGED_SINCE]!)
              : null,
            address: p.address ?? null,
            projectType: p.project_type ?? null,
            equipmentSummary: p.equipment_summary ?? null,
            surveyStatus: p.survey_status ?? null,
            surveyDate: p.survey_date ?? null,
            designStatus: p.design_status ?? null,
            designApprovalStatus: p.layout_status ?? null,
            plansetDate: p.planset_date ?? null,
            ahj: p.ahj ?? null,
            utilityCompany: p.utility_company ?? null,
            projectManager: p.project_manager ?? null,
            operationsManager: p.operations_manager ?? null,
            siteSurveyor: p.site_surveyor ?? null,
            driveFolderUrl: p.drive_folder_url ?? null,
            surveyFolderUrl: p.survey_folder_url ?? null,
            designFolderUrl: p.design_folder_url ?? null,
            salesFolderUrl: p.sales_documents ?? null,
            openSolarUrl: p.open_solar_url ?? null,
            addedBy: "SYSTEM",
          },
        });
        created += 1;
      } catch (e) {
        // P2002 = unique constraint = already snapshotted in this session.
        if (e instanceof Error && e.message.includes("P2002")) {
          skipped += 1;
        } else {
          throw e;
        }
      }
    }

    // Pagination
    after = (results.paging?.next?.after as string | undefined) ?? undefined;
  } while (after);

  return { created, skipped };
}
