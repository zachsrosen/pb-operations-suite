/**
 * Shit Show — snapshot helpers
 *
 * - snapshotFlaggedDeals(sessionId): pulls every deal where pb_shit_show_flagged=true
 *   from HubSpot and creates one ShitShowSessionItem per deal. Reuses IDR's
 *   SNAPSHOT_PROPERTIES + snapshotDealProperties + buildOwnerMap so display
 *   fields (owners-as-names, equipment summary, address composition, statuses)
 *   match the IDR meeting hub exactly.
 * - readShitShowFlagsBatch(dealIds): batched property read for known dealIds; used
 *   by the IDR preview route to hydrate the flag without per-deal fetches.
 */

import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import { SHIT_SHOW_PROPS } from "@/lib/shit-show/hubspot-flag";
import {
  SNAPSHOT_PROPERTIES,
  snapshotDealProperties,
  buildOwnerMap,
} from "@/lib/idr-meeting";
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
 * - First-time deals → INSERT a new ShitShowSessionItem.
 * - Existing deals (re-snapshot via "↻ Refresh from HubSpot" or repeated
 *   session-start) → UPDATE the snapshot fields only. Meeting-time fields
 *   (decision, meeting notes, assignments, sync IDs) stay untouched.
 *
 * Display fields use the same shape IDR uses (owner names resolved, equipment
 * one-liner built from module/inverter/battery brand+model+qty, address composed
 * from address_line_1 + city + state, etc.).
 */
export async function snapshotFlaggedDeals(sessionId: string): Promise<{
  created: number;
  refreshed: number;
}> {
  const properties = [
    ...SNAPSHOT_PROPERTIES,
    "dealstage",
    SHIT_SHOW_PROPS.REASON,
    SHIT_SHOW_PROPS.FLAGGED_SINCE,
  ];

  let after: string | undefined;
  const allDeals: Array<{ id: string; properties: Record<string, string | null> }> = [];

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
      allDeals.push({
        id: deal.id,
        properties: (deal.properties ?? {}) as Record<string, string | null>,
      });
    }
    after = (results.paging?.next?.after as string | undefined) ?? undefined;
  } while (after);

  // Resolve owner IDs → names in one batched lookup.
  const ownerMap = await buildOwnerMap(
    allDeals.map((d) => ({ properties: d.properties })),
  );

  let created = 0;
  let refreshed = 0;

  for (const deal of allDeals) {
    const p = deal.properties;
    const snap = snapshotDealProperties(p, ownerMap);

    // Snapshot fields refresh on every re-snapshot. Meeting-time fields stay.
    const snapshotData = {
      region: snap.region,
      dealName: snap.dealName,
      dealAmount: snap.dealAmount,
      systemSizeKw: snap.systemSizeKw,
      stage: p.dealstage ?? null,
      dealOwner: snap.dealOwner,
      reasonSnapshot: p[SHIT_SHOW_PROPS.REASON] ?? null,
      flaggedSince: p[SHIT_SHOW_PROPS.FLAGGED_SINCE]
        ? new Date(p[SHIT_SHOW_PROPS.FLAGGED_SINCE]!)
        : null,
      address: snap.address,
      projectType: snap.projectType,
      equipmentSummary: snap.equipmentSummary,
      surveyStatus: snap.surveyStatus,
      surveyDate: snap.surveyDate,
      designStatus: snap.designStatus,
      designApprovalStatus: snap.designApprovalStatus,
      plansetDate: snap.plansetDate,
      ahj: snap.ahj,
      utilityCompany: snap.utilityCompany,
      projectManager: snap.projectManager,
      operationsManager: snap.operationsManager,
      siteSurveyor: snap.siteSurveyor,
      driveFolderUrl: snap.driveFolderUrl,
      surveyFolderUrl: snap.surveyFolderUrl,
      designFolderUrl: snap.designFolderUrl,
      salesFolderUrl: snap.salesFolderUrl,
      openSolarUrl: snap.openSolarUrl,
      snapshotUpdatedAt: new Date(),
    };

    const existing = await prisma.shitShowSessionItem.findUnique({
      where: { sessionId_dealId: { sessionId, dealId: deal.id } },
      select: { id: true },
    });

    if (existing) {
      await prisma.shitShowSessionItem.update({
        where: { id: existing.id },
        data: snapshotData,
      });
      refreshed += 1;
    } else {
      await prisma.shitShowSessionItem.create({
        data: {
          sessionId,
          dealId: deal.id,
          ...snapshotData,
          addedBy: "SYSTEM",
        },
      });
      created += 1;
    }
  }

  return { created, refreshed };
}
