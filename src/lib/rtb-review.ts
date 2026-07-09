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

/**
 * Build a Google Drive folder URL from the `all_document_parent_folder_id`
 * deal property, which holds a bare folder id (e.g. "1PVPgD…"). Some legacy
 * values are already full URLs, so pass those through untouched.
 */
function driveFolderUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (v.startsWith("http")) return v;
  return `https://drive.google.com/drive/folders/${v}`;
}

export interface RtbQueueItem {
  dealId: string;
  dealName: string;
  location: string | null;
  projectManager: string | null;
  ownerId: string | null;
  /** Display label for the deal's pipeline stage (e.g. "RTB - Blocked"). */
  dealStage: string | null;
  permitIssueDate: string | null;
  /** Interconnection status, resolved to the HubSpot display label. */
  interconnectionStatus: string | null;
  /** Free-text RTB - Blocked Reason from the deal (why it's parked). */
  rtbBlockedReason: string | null;
  /** Construction (install) status, resolved to the HubSpot display label. */
  constructionStatus: string | null;
  revisionCount: number | null;
  /** Link to the project's Google Drive folder, or null when unset. */
  driveFolderUrl: string | null;
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
  "interconnection_status",
  "rtb_blocked_reason",
  "install_status",
  "all_document_parent_folder_id",
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
        interconnectionStatus: statusLabel(
          "interconnection_status",
          p.interconnection_status
        ),
        rtbBlockedReason: p.rtb_blocked_reason ?? null,
        constructionStatus: statusLabel("install_status", p.install_status),
        revisionCount: p.total_revision_count
          ? Number(p.total_revision_count)
          : null,
        driveFolderUrl: driveFolderUrl(p.all_document_parent_folder_id),
        approved: p.pm_rtb_approved === "true",
        lastModified: p.hs_lastmodifieddate ?? null,
      };
    }
  );
}
