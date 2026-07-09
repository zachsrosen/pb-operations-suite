/**
 * RTB Review Queue — Business Logic
 *
 * Lists HubSpot deals parked in Project pipeline (6900017) at stage
 * "RTB - Blocked" (71052436) so a PM can review and approve them. Approval
 * sets `pm_rtb_approved="true"` on the deal; a HubSpot workflow (not this
 * code) is responsible for moving the deal stage forward.
 */

import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import {
  searchWithRetry,
  fetchLineItemsForDeals,
  resolveHubSpotOwnerContact,
  DEAL_STAGE_MAP,
} from "@/lib/hubspot";
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

export interface RtbLineItem {
  name: string;
  quantity: number;
  category: string | null;
}

export interface RtbQueueItem {
  dealId: string;
  dealName: string;
  location: string | null;
  /** Resolved owner-directory name (project_manager stores a HubSpot userId). */
  projectManager: string | null;
  ownerId: string | null;
  /** Display label for the deal's pipeline stage (e.g. "RTB - Blocked"). */
  dealStage: string | null;
  /** Project type (e.g. "Solar", "Battery"). */
  projectType: string | null;
  /** Deal amount in dollars. */
  amount: number | null;
  permitIssueDate: string | null;
  /** Interconnection status, resolved to the HubSpot display label. */
  interconnectionStatus: string | null;
  /** Free-text RTB - Blocked Reason from the deal (why it's parked). */
  rtbBlockedReason: string | null;
  /** Construction (install) status, resolved to the HubSpot display label. */
  constructionStatus: string | null;
  /** DA invoice status ("Pending Approval" | "Open" | "Paid In Full"). */
  daStatus: string | null;
  /** True when the DA milestone is Paid In Full. */
  daPaid: boolean;
  /** Link to the project's Google Drive folder, or null when unset. */
  driveFolderUrl: string | null;
  /** HubSpot line items on the deal (equipment the PM is releasing to build). */
  lineItems: RtbLineItem[];
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
  "project_type",
  "amount",
  "permit_completion_date",
  "interconnection_status",
  "rtb_blocked_reason",
  "install_status",
  "all_document_parent_folder_id",
  "da_invoice_status",
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
  if (results.length === 0) return [];

  // One batched pass for every parked deal's line items. Non-fatal: the queue
  // is still useful without equipment, so swallow failures into empty lists.
  const lineItemsByDeal = new Map<string, RtbLineItem[]>();
  try {
    const lineItems = await fetchLineItemsForDeals(results.map((r) => r.id));
    for (const li of lineItems) {
      const list = lineItemsByDeal.get(li.dealId) ?? [];
      list.push({
        name: li.name,
        quantity: li.quantity,
        category: li.productCategory || null,
      });
      lineItemsByDeal.set(li.dealId, list);
    }
  } catch (error) {
    console.error("[rtb-review] line-item fetch failed:", error);
  }

  // project_manager stores a HubSpot userId — resolve each distinct id to a
  // display name via the (cached) owner directory. Non-fatal: fall back to
  // the raw value so the queue still renders if the owners API is down.
  const pmIds = [
    ...new Set(
      results
        .map((r) => (r.properties?.project_manager ?? "").trim())
        .filter(Boolean)
    ),
  ];
  const pmNameById = new Map<string, string>();
  await Promise.all(
    pmIds.map(async (id) => {
      try {
        const contact = await resolveHubSpotOwnerContact(id);
        if (contact?.name) pmNameById.set(id, contact.name);
      } catch (error) {
        console.error(`[rtb-review] owner resolution failed for ${id}:`, error);
      }
    })
  );

  return results.map((r) => {
      const p = r.properties ?? {};
      return {
        dealId: r.id,
        dealName: p.dealname ?? "",
        location: p.pb_location ?? null,
        projectManager: p.project_manager
          ? pmNameById.get(p.project_manager.trim()) ?? p.project_manager
          : null,
        ownerId: p.hubspot_owner_id ?? null,
        dealStage: p.dealstage ? DEAL_STAGE_MAP[p.dealstage] ?? p.dealstage : null,
        projectType: p.project_type ?? null,
        amount: p.amount ? Number(p.amount) || null : null,
        permitIssueDate: p.permit_completion_date ?? null,
        interconnectionStatus: statusLabel(
          "interconnection_status",
          p.interconnection_status
        ),
        rtbBlockedReason: p.rtb_blocked_reason ?? null,
        constructionStatus: statusLabel("install_status", p.install_status),
        daStatus: p.da_invoice_status ?? null,
        daPaid: p.da_invoice_status === "Paid In Full",
        driveFolderUrl: driveFolderUrl(p.all_document_parent_folder_id),
        lineItems: lineItemsByDeal.get(r.id) ?? [],
        approved: p.pm_rtb_approved === "true",
        lastModified: p.hs_lastmodifieddate ?? null,
      };
    }
  );
}
