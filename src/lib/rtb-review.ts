/**
 * RTB Review Queue — Business Logic
 *
 * Lists HubSpot deals parked in Project pipeline (6900017) at stage
 * "RTB - Blocked" (71052436) so a PM can review and approve them. Approval
 * sets `pm_rtb_approved="true"` on the deal; a HubSpot workflow (not this
 * code) is responsible for moving the deal stage forward.
 */

import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { searchWithRetry, DEAL_STAGE_MAP } from "@/lib/hubspot";
import { statusLabel } from "@/lib/deal-status-labels";

const PROJECT_PIPELINE = "6900017";
const RTB_BLOCKED_STAGE = "71052436";

export interface RtbQueueItem {
  dealId: string;
  dealName: string;
  location: string | null;
  projectManager: string | null;
  ownerId: string | null;
  /** Display label for the deal's pipeline stage (e.g. "RTB - Blocked"). */
  dealStage: string | null;
  permitIssueDate: string | null;
  /** Resolved to the HubSpot display label, not the raw option value. */
  permittingStatus: string | null;
  /** Resolved to the HubSpot display label, not the raw option value. */
  designStatus: string | null;
  revisionCount: number | null;
  approved: boolean;
  lastModified: string | null;
}

const PROPERTIES = [
  "dealname",
  "pb_location",
  "project_manager",
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

  const results = (response.results ?? []) as unknown as Array<{
    id: string;
    properties: Record<string, string>;
  }>;
  return results.map((r) => {
      const p = r.properties ?? {};
      return {
        dealId: r.id,
        dealName: p.dealname ?? "",
        location: p.pb_location ?? null,
        projectManager: p.project_manager ?? null,
        ownerId: p.hubspot_owner_id ?? null,
        dealStage: p.dealstage ? DEAL_STAGE_MAP[p.dealstage] ?? p.dealstage : null,
        permitIssueDate: p.permit_completion_date ?? null,
        permittingStatus: statusLabel("permitting_status", p.permitting_status),
        designStatus: statusLabel("design_status", p.design_status),
        revisionCount: p.total_revision_count
          ? Number(p.total_revision_count)
          : null,
        approved: p.pm_rtb_approved === "true",
        lastModified: p.hs_lastmodifieddate ?? null,
      };
    }
  );
}
