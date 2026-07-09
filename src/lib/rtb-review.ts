/**
 * RTB Review Queue — Business Logic
 *
 * Lists HubSpot deals parked in Project pipeline (6900017) at stage
 * "RTB - Blocked" (71052436) so a PM can review and approve them. Approval
 * sets `pm_rtb_approved="true"` on the deal; a HubSpot workflow (not this
 * code) is responsible for moving the deal stage forward.
 */

import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { searchWithRetry } from "@/lib/hubspot";

const PROJECT_PIPELINE = "6900017";
const RTB_BLOCKED_STAGE = "71052436";

export interface RtbQueueItem {
  dealId: string;
  dealName: string;
  location: string | null;
  ownerId: string | null;
  permitIssueDate: string | null;
  permittingStatus: string | null;
  designStatus: string | null;
  revisionCount: number | null;
  approved: boolean;
  lastModified: string | null;
}

const PROPERTIES = [
  "dealname",
  "pb_location",
  "hubspot_owner_id",
  "dealstage",
  "pipeline",
  "permit_completion_date",
  "permitting_status",
  "design_status",
  "total_revision_count",
  "pm_rtb_approved",
  "hs_lastmodifieddate",
];

export async function fetchRtbQueue(): Promise<RtbQueueItem[]> {
  const response = await searchWithRetry({
    filterGroups: [
      {
        filters: [
          {
            propertyName: "pipeline",
            operator: FilterOperatorEnum.Eq,
            value: PROJECT_PIPELINE,
          },
          {
            propertyName: "dealstage",
            operator: FilterOperatorEnum.Eq,
            value: RTB_BLOCKED_STAGE,
          },
        ],
      },
    ],
    properties: PROPERTIES,
    limit: 200,
    sorts: ["hs_lastmodifieddate"],
  } as unknown as Parameters<typeof searchWithRetry>[0]);

  return (response.results ?? []).map(
    (r: { id: string; properties: Record<string, string> }) => {
      const p = r.properties ?? {};
      return {
        dealId: r.id,
        dealName: p.dealname ?? "",
        location: p.pb_location ?? null,
        ownerId: p.hubspot_owner_id ?? null,
        permitIssueDate: p.permit_completion_date ?? null,
        permittingStatus: p.permitting_status ?? null,
        designStatus: p.design_status ?? null,
        revisionCount: p.total_revision_count
          ? Number(p.total_revision_count)
          : null,
        approved: p.pm_rtb_approved === "true",
        lastModified: p.hs_lastmodifieddate ?? null,
      };
    }
  );
}
