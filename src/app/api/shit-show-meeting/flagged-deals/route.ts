import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { hubspotClient } from "@/lib/hubspot";
import { SHIT_SHOW_PROPS } from "@/lib/shit-show/hubspot-flag";
import {
  SNAPSHOT_PROPERTIES,
  snapshotDealProperties,
  buildOwnerMap,
} from "@/lib/idr-meeting";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";

/**
 * GET /api/shit-show-meeting/flagged-deals
 *
 * Returns the live list of deals currently flagged with pb_shit_show_flagged=true
 * in HubSpot — no session required. Used by the Shit Show meeting hub to render
 * the queue when there's no active session (or the session is COMPLETED), so
 * users can always browse what's flagged + flag new deals without first
 * starting a meeting.
 *
 * Returned shape matches ShitShowItem fields where possible (with synthetic IDs
 * and zero-defaults for meeting fields like decision/notes/assignments).
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const properties = [
    ...SNAPSHOT_PROPERTIES,
    "dealstage",
    SHIT_SHOW_PROPS.REASON,
    SHIT_SHOW_PROPS.FLAGGED_SINCE,
  ];

  let after: string | undefined;
  const all: Array<{ id: string; properties: Record<string, string | null> }> = [];

  do {
    const res = await hubspotClient.crm.deals.searchApi.doSearch({
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
    for (const d of res.results) {
      all.push({
        id: d.id,
        properties: (d.properties ?? {}) as Record<string, string | null>,
      });
    }
    after = (res.paging?.next?.after as string | undefined) ?? undefined;
  } while (after);

  const ownerMap = await buildOwnerMap(all.map((d) => ({ properties: d.properties })));

  // Synthetic items shaped like ShitShowItem so the UI can render them with the
  // same components used for session items. IDs are prefixed "preview-" to
  // distinguish from real session item IDs (the UI hides meeting controls when
  // the ID starts with "preview-").
  const items = all.map((d) => {
    const snap = snapshotDealProperties(d.properties, ownerMap);
    return {
      id: `preview-${d.id}`,
      sessionId: null as string | null,
      dealId: d.id,
      region: snap.region,
      sortOrder: 0,
      dealName: snap.dealName,
      dealAmount: snap.dealAmount,
      systemSizeKw: snap.systemSizeKw,
      stage: d.properties.dealstage ?? null,
      dealOwner: snap.dealOwner,
      reasonSnapshot: d.properties[SHIT_SHOW_PROPS.REASON] ?? null,
      flaggedSince: d.properties[SHIT_SHOW_PROPS.FLAGGED_SINCE] ?? null,
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
      meetingNotes: null,
      decision: "PENDING" as const,
      decisionRationale: null,
      resolvedAt: null,
      resolvedBy: null,
      hubspotNoteId: null,
      noteSyncStatus: "PENDING" as const,
      noteSyncError: null,
      idrEscalationQueueId: null,
      hubspotEscalationTaskId: null,
      addedBy: "SYSTEM" as const,
      addedByUser: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assignments: [],
    };
  });

  return NextResponse.json({ items });
}
