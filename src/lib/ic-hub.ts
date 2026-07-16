/**
 * Interconnection Hub — Business Logic
 *
 * Sister to lib/permit-hub.ts. Structurally identical; swaps:
 *   • permitting_status → interconnection_status
 *   • permit_tech       → interconnections_tech
 *   • AHJ custom object → Utility custom object
 *   • permit inboxes    → interconnections@ / interconnectionsca@
 *   • PERMIT_*          → IC_* action kinds, activity types
 *
 * Shares: queue ↔ email via PI_QUERY_DEFS.interconnection, shared-inbox
 * helper (team="ic"), buildOwnerMap/buildStageDisplayMap, createDealNote,
 * PermitHubDraft table (same row shape, different actionKind prefix).
 *
 * Extraction into a shared `workspace-hub/` module is deferred — this is
 * the second consumer of the pattern but we want both live and stable
 * before touching the shared surface. See docs/superpowers/specs.
 */

import { prisma } from "@/lib/db";
import { hubspotClient, searchWithRetry } from "@/lib/hubspot";
import { fetchStatusEnteredAt } from "@/lib/status-entered";
import { getEnumLabelMap, labelFor } from "@/lib/hubspot-enum-labels";
import { createDealNote } from "@/lib/hubspot-engagements";
import { updateTask } from "@/lib/hubspot-tasks";
import { withHubSpotRetry } from "@/lib/bulk-sync-confirmation";
import {
  fetchUtilitiesForDeal,
  fetchAllUtilities,
  type UtilityRecord,
} from "@/lib/hubspot-custom-objects";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import {
  IC_ACTION_STATUSES,
  IC_ACTION_TASK_SUBJECTS,
  STALE_THRESHOLD_DAYS,
  icActionKindForStatus,
  type IcActionKind,
} from "@/lib/pi-statuses";
import {
  PI_QUERY_DEFS,
  EXCLUDED_STAGES,
  INCLUDED_PIPELINES,
  PI_LEADS,
} from "@/lib/daily-focus/config";
import { buildOwnerMap, locationInBucket } from "@/lib/idr-meeting";
import { buildStageDisplayMap } from "@/lib/daily-focus/format";
import { getHubSpotDealUrl } from "@/lib/external-links";
import {
  buildGmailThreadQuery,
  fetchSharedInboxThreads,
  getSharedInboxAddress,
  type SharedInboxThread,
} from "@/lib/gmail-shared-inbox";
import type { ActivityType } from "@/generated/prisma/enums";

/**
 * Queue statuses = email's Ready + Resubmit buckets, plus a handful of
 * follow-up + rejection statuses so the Hub covers more of the "ball in
 * our court" surface than the email (which is tightly scoped to daily
 * actionable items only).
 *
 * Excludes the value "Rejected" — labelled "Rejected - Revisions Needed". A
 * rejection that needs a revision is a handoff to the design team; IC picks it
 * back up at "Revision Returned From Design" (labelled "Revision Ready To
 * Resubmit"), which is in the base list. Same call as permit-hub.ts.
 *
 * "Rejected (New)" (labelled just "Rejected") and "Non-Design Related
 * Rejection" DO stay — neither signals a design revision.
 */
const IC_HUB_STATUSES = (() => {
  const def = PI_QUERY_DEFS.find((d) => d.key === "interconnection");
  const base = def
    ? [...def.readyStatuses, ...(def.resubmitStatuses ?? [])]
    : [];
  return Array.from(
    new Set([
      ...base,
      "Submitted To Utility",
      "Resubmitted To Utility",
      "Waiting On Information",
      "Rejected (New)",
      "Non-Design Related Rejection",
    ]),
  );
})();

/**
 * Safety cap on queue pagination — 10 pages x 200 = 2000 deals, far above the
 * real queue (~108). Guards against an unbounded loop if HubSpot keeps
 * returning a cursor; a hit is logged rather than silently truncating.
 */
const MAX_QUEUE_PAGES = 10;

// ---------------------------------------------------------------------------
// Permission + flag helpers
// ---------------------------------------------------------------------------

export const IC_HUB_ROLES = [
  "ADMIN",
  "EXECUTIVE",
  "INTERCONNECT",
  "TECH_OPS",
] as const;

export function isIcHubAllowedRole(role: string): boolean {
  return (IC_HUB_ROLES as readonly string[]).includes(role);
}

export function isIcHubEnabled(): boolean {
  return process.env.IC_HUB_ENABLED === "true";
}

export async function resolveUserIdByEmail(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return user?.id ?? null;
}

const IC_LEAD_BY_OWNER_ID: Record<string, string> = Object.fromEntries(
  PI_LEADS.filter((l) => l.roles.includes("interconnections_tech")).map((l) => [
    l.hubspotOwnerId,
    l.name,
  ]),
);

function resolveIcLeadName(
  props: Record<string, string | null>,
  ownerMap?: Map<string, string>,
): string | null {
  if (props.interconnection_lead_name) return props.interconnection_lead_name;
  const ownerId = props.interconnections_tech;
  if (ownerId) {
    const resolved = ownerMap?.get(ownerId) ?? IC_LEAD_BY_OWNER_ID[ownerId];
    if (resolved) return resolved;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IcQueueItem {
  dealId: string;
  name: string;
  address: string | null;
  pbLocation: string | null;
  /** HubSpot internal VALUE — used for routing/filtering, not for display. */
  status: string;
  /** Human label for `status` (they differ for several options). Display this. */
  statusLabel: string;
  /** Resolved deal-stage name (e.g. "Permission To Operate"); null if unresolved. */
  dealStage: string | null;
  actionLabel: string;
  actionKind: IcActionKind | null;
  /** Days since the deal entered its current interconnection_status; null when unknown. */
  daysInStatus: number | null;
  isStale: boolean;
  icLead: string | null;
  icLeadOwnerId: string | null;
  pm: string | null;
  amount: number | null;
}

export interface IcProjectDetail {
  deal: {
    id: string;
    name: string;
    address: string | null;
    amount: number | null;
    pbLocation: string | null;
    icLead: string | null;
    pm: string | null;
    /** HubSpot internal VALUE — used for routing, not for display. */
    interconnectionStatus: string;
    /** Human label for `interconnectionStatus`. Display this. */
    interconnectionStatusLabel: string;
    actionKind: IcActionKind | null;
    actionLabel: string | null;
    systemSizeKw: number | null;
    dealStage: string | null;
    hubspotUrl: string;
    designFolderUrl: string | null;
    permitFolderUrl: string | null;
    driveFolderUrl: string | null;
    utilityPortalUrl: string | null;
    utilityApplicationUrl: string | null;
  };
  utility: UtilityRecord[];
  correspondenceSearchUrl: string | null;
  correspondenceThreads: SharedInboxThread[];
  correspondenceInbox: string | null;
  statusHistory: Array<{
    property: string;
    value: string | null;
    timestamp: string;
  }>;
  activity: Array<{
    id: string;
    type: "email" | "call" | "note" | "meeting" | "task";
    subject: string | null;
    body: string | null;
    timestamp: string;
  }>;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export async function fetchIcQueue(): Promise<IcQueueItem[]> {
  const filters: Record<string, unknown>[] = [
    {
      propertyName: "pipeline",
      operator: FilterOperatorEnum.In,
      values: INCLUDED_PIPELINES,
    },
    {
      propertyName: "interconnection_status",
      operator: FilterOperatorEnum.In,
      values: IC_HUB_STATUSES,
    },
    {
      propertyName: "dealstage",
      operator: FilterOperatorEnum.NotIn,
      values: EXCLUDED_STAGES,
    },
  ];

  // HubSpot search returns at most 200 results per page. This queue is ~108
  // deals today — over half the cap — so page with the `after` cursor rather
  // than silently dropping the tail once it grows past 200. Costs nothing
  // while under one page: the loop exits after one request.
  const searchResults: Array<{
    id: string;
    properties?: Record<string, string | null>;
  }> = [];
  let after: string | undefined;
  let pages = 0;
  do {
    const response = await searchWithRetry({
      filterGroups: [{ filters }],
      properties: [
        "dealname",
        "address_line_1",
        "city",
        "state",
        "pb_location",
        "interconnection_status",
        "dealstage",
        "pipeline",
        "hs_lastmodifieddate",
        "amount",
        "hubspot_owner_id",
        "project_manager",
        "interconnection_lead_name",
        "interconnections_tech",
        "calculated_system_size__kwdc_",
      ],
      limit: 200,
      sorts: ["hs_lastmodifieddate"],
      ...(after ? { after } : {}),
    } as unknown as Parameters<typeof searchWithRetry>[0]);

    searchResults.push(
      ...((response.results ?? []) as Array<{
        id: string;
        properties?: Record<string, string | null>;
      }>),
    );
    after = (response as { paging?: { next?: { after?: string } } }).paging?.next
      ?.after;
    pages += 1;
  } while (after && pages < MAX_QUEUE_PAGES);

  if (after) {
    // Never truncate silently — if this fires, raise MAX_QUEUE_PAGES or
    // tighten the status allowlist.
    console.warn(
      `[ic-hub] queue hit the ${MAX_QUEUE_PAGES}-page cap (${searchResults.length} deals); results are truncated`,
    );
  }

  const rawDeals = searchResults.map((d) => ({
    properties: (d.properties ?? {}) as Record<string, string | null>,
  }));
  // Real time-in-status comes from interconnection_status property history —
  // NOT hs_lastmodifieddate, which a calc-property loop re-stamps daily (every
  // row computed to 0 days). See lib/status-entered.ts.
  const [ownerMap, enteredAtByDeal, statusLabels, stageMap] = await Promise.all([
    buildOwnerMap(rawDeals),
    fetchStatusEnteredAt(
      searchResults.map((d) => ({
        id: d.id,
        status: d.properties?.interconnection_status ?? "",
      })),
      "interconnection_status",
    ),
    getEnumLabelMap("interconnection_status"),
    // Cached via getStageMaps — resolves dealstage IDs to display names.
    buildStageDisplayMap(),
  ]);

  const items: IcQueueItem[] = [];
  const now = Date.now();
  for (const deal of searchResults) {
    const props = (deal.properties ?? {}) as Record<string, string | null>;
    const status = props.interconnection_status ?? "";
    const enteredAt = enteredAtByDeal.get(deal.id);
    // null (not 0) when the entry time can't be resolved — the UI shows "—"
    // rather than implying the deal just changed status.
    const daysInStatus =
      enteredAt === undefined
        ? null
        : Math.floor((now - enteredAt) / (1000 * 60 * 60 * 24));
    const actionLabel = IC_ACTION_STATUSES[status] ?? "";
    const pmId = props.project_manager;
    const resolvedPm = pmId ? (ownerMap.get(pmId) ?? pmId) : null;

    items.push({
      dealId: deal.id,
      name: props.dealname ?? "Untitled",
      address: props.address_line_1 ?? null,
      pbLocation: props.pb_location ?? null,
      status,
      statusLabel: labelFor(statusLabels, status),
      dealStage: props.dealstage ? (stageMap[props.dealstage] ?? null) : null,
      actionLabel,
      actionKind: icActionKindForStatus(status),
      daysInStatus,
      isStale: daysInStatus !== null && daysInStatus > STALE_THRESHOLD_DAYS,
      icLead: resolveIcLeadName(props, ownerMap),
      icLeadOwnerId: props.interconnections_tech ?? null,
      pm: resolvedPm,
      amount: props.amount ? Number(props.amount) : null,
    });
  }

  // Stalest first; deals with an unknown entry time sort last rather than
  // masquerading as brand new.
  items.sort((a, b) => {
    if (a.daysInStatus === null) return b.daysInStatus === null ? 0 : 1;
    if (b.daysInStatus === null) return -1;
    return b.daysInStatus - a.daysInStatus;
  });
  return items;
}

// ---------------------------------------------------------------------------
// Project detail
// ---------------------------------------------------------------------------

export async function fetchIcProjectDetail(
  dealId: string,
): Promise<IcProjectDetail | null> {
  let deal;
  try {
    deal = await hubspotClient.crm.deals.basicApi.getById(dealId, [
      "dealname",
      "project_number",
      "utility_application__", // Utility Application # — utility cites it in correspondence
      "address_line_1",
      "city",
      "state",
      "zip",
      "pb_location",
      "utility",
      "amount",
      "interconnection_lead_name",
      "interconnections_tech",
      "project_manager",
      "interconnection_status",
      "dealstage",
      "calculated_system_size__kwdc_",
      "design_documents",
      "permit_documents",
      "g_drive",
      "design_folder_url",
      "all_document_folder_url",
    ]);
  } catch {
    return null;
  }

  const props = (deal.properties ?? {}) as Record<string, string | null>;
  const [associatedUtility, ownerMap, stageMap] = await Promise.all([
    fetchUtilitiesForDeal(dealId),
    buildOwnerMap([{ properties: props }]),
    buildStageDisplayMap(),
  ]);

  // Fallback: match utility by deal.utility property, then by city+state.
  let utility: UtilityRecord[] = associatedUtility;
  if (utility.length === 0) {
    try {
      const all = await fetchAllUtilities();
      const dealUtilityName = (props.utility ?? "").trim().toLowerCase();
      if (dealUtilityName) {
        utility = all
          .filter((r) => {
            const p = r.properties as Record<string, string | null>;
            const name =
              (p.utility_company_name ?? p.record_name ?? "").trim().toLowerCase();
            return (
              name &&
              (name === dealUtilityName || name.includes(dealUtilityName))
            );
          })
          .slice(0, 3);
      }
      if (utility.length === 0 && props.city) {
        const dealCity = props.city.trim().toLowerCase();
        const dealState = (props.state ?? "").trim().toLowerCase();
        utility = all
          .filter((r) => {
            const p = r.properties as Record<string, string | null>;
            const city = (p.city ?? "").trim().toLowerCase();
            const state = (p.state ?? "").trim().toLowerCase();
            if (!city) return false;
            if (dealState && state && dealState !== state) return false;
            return city === dealCity;
          })
          .slice(0, 3);
      }
    } catch {
      // leave utility empty
    }
  }

  const interconnectionStatus = props.interconnection_status ?? "";
  const actionLabel = IC_ACTION_STATUSES[interconnectionStatus] ?? null;
  const resolvedKind = icActionKindForStatus(interconnectionStatus);
  const interconnectionStatusLabel = labelFor(
    await getEnumLabelMap("interconnection_status"),
    interconnectionStatus,
  );

  const pmId = props.project_manager;
  const resolvedPm = pmId ? (ownerMap.get(pmId) ?? pmId) : null;
  const dealStageId = props.dealstage;
  const resolvedDealStage = dealStageId
    ? (stageMap[dealStageId] ?? dealStageId)
    : null;

  const fullAddress =
    [props.address_line_1, props.city, props.state].filter(Boolean).join(", ") || null;

  const utilityProps = utility[0]?.properties as
    | Record<string, string | null>
    | undefined;
  const utilityEmail = utilityProps?.email ?? null;
  const correspondenceSearchUrl =
    utilityEmail && fullAddress
      ? buildGmailSearchUrl(utilityEmail, fullAddress)
      : null;

  const designFolderUrl =
    props.design_documents ?? props.design_folder_url ?? null;
  const permitFolderUrl = props.permit_documents ?? null;
  const driveFolderUrl = props.g_drive ?? props.all_document_folder_url ?? null;

  // Region routing → interconnections@ (CO) / interconnectionsca@ (CA)
  let correspondenceInbox: string | null = null;
  let correspondenceThreads: SharedInboxThread[] = [];
  // Project-unique keys the utility actually cites: street address, PROJ
  // number, and the Utility Application #. NOT the utility email — that is
  // shared across every project for the utility and pulled in other
  // projects' threads.
  const icIdentifiers = [props.utility_application__];
  if (props.address_line_1 || props.project_number || icIdentifiers.some(Boolean)) {
    const pbLoc = props.pb_location;
    let region: "co" | "ca" | null = null;
    if (locationInBucket(pbLoc, "colorado")) region = "co";
    else if (locationInBucket(pbLoc, "california")) region = "ca";

    if (region) {
      const mailbox = getSharedInboxAddress("ic", region);
      if (mailbox) {
        correspondenceInbox = mailbox;
        correspondenceThreads = await fetchSharedInboxThreads({
          mailbox,
          query: buildGmailThreadQuery({
            address: props.address_line_1,
            projectNumber: props.project_number,
            identifiers: icIdentifiers,
            lookbackDays: 90,
          }),
          maxThreads: 10,
        });
      }
    }
  }

  const [statusHistory, activity] = await Promise.all([
    fetchIcStatusHistory(dealId),
    fetchIcActivity(dealId),
  ]);

  return {
    deal: {
      id: dealId,
      name: props.dealname ?? "Untitled",
      address: fullAddress,
      amount: props.amount ? Number(props.amount) : null,
      pbLocation: props.pb_location ?? null,
      icLead: resolveIcLeadName(props, ownerMap),
      pm: resolvedPm,
      interconnectionStatus,
      interconnectionStatusLabel,
      actionKind: resolvedKind,
      actionLabel,
      systemSizeKw: props.calculated_system_size__kwdc_
        ? Number(props.calculated_system_size__kwdc_)
        : null,
      dealStage: resolvedDealStage,
      hubspotUrl: getHubSpotDealUrl(dealId),
      designFolderUrl,
      permitFolderUrl,
      driveFolderUrl,
      utilityPortalUrl:
        (utilityProps?.portal_link as string | null | undefined) ?? null,
      utilityApplicationUrl:
        (utilityProps?.application_link as string | null | undefined) ?? null,
    },
    utility,
    correspondenceSearchUrl,
    correspondenceThreads,
    correspondenceInbox,
    statusHistory,
    activity,
  };
}

function buildGmailSearchUrl(email: string, address: string): string {
  const query = encodeURIComponent(`from:${email} OR to:${email} "${address}"`);
  return `https://mail.google.com/mail/u/0/#search/${query}`;
}

async function fetchIcStatusHistory(
  dealId: string,
): Promise<Array<{ property: string; value: string | null; timestamp: string }>> {
  try {
    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) return [];
    const url = new URL(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`);
    url.searchParams.set(
      "propertiesWithHistory",
      "interconnection_status,ic_submit,ic_approved",
    );
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return [];
    const body = (await resp.json()) as {
      propertiesWithHistory?: Record<string, Array<{ value: string; timestamp: string }>>;
    };
    const history: Array<{ property: string; value: string | null; timestamp: string }> = [];
    for (const [property, entries] of Object.entries(body.propertiesWithHistory ?? {})) {
      for (const entry of entries) {
        history.push({ property, value: entry.value ?? null, timestamp: entry.timestamp });
      }
    }
    history.sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));
    return history;
  } catch {
    return [];
  }
}

async function fetchIcActivity(
  dealId: string,
): Promise<IcProjectDetail["activity"]> {
  try {
    const { getDealEngagements } = await import("@/lib/hubspot-engagements");
    const engagements = await getDealEngagements(dealId);
    return engagements
      .filter((e) => {
        const subject = String(e.subject ?? "").toLowerCase();
        const body = String(e.body ?? "").toLowerCase();
        return (
          subject.includes("interconnect") ||
          body.includes("interconnect") ||
          subject.includes("utility") ||
          body.includes("utility") ||
          subject.includes("xcel") ||
          body.includes("xcel")
        );
      })
      .slice(0, 50)
      .map((e) => ({
        id: e.id,
        type: e.type,
        subject: e.subject,
        body: e.body,
        timestamp: e.timestamp,
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Action writeback helpers
// ---------------------------------------------------------------------------

export interface CompleteIcTaskResult {
  taskCompleted: boolean;
  taskId?: string;
  taskNotFound?: boolean;
}

export async function completeIcTask(opts: {
  dealId: string;
  actionKind: IcActionKind;
  noteBody: string;
  fallbackProperties?: Record<string, string>;
  forceFallback?: boolean;
}): Promise<CompleteIcTaskResult> {
  const { dealId, actionKind, noteBody, fallbackProperties, forceFallback } = opts;
  const subjectPatterns = IC_ACTION_TASK_SUBJECTS[actionKind];

  let taskCompleted = false;
  let taskId: string | undefined;

  if (!forceFallback) {
    const searchResult = await withHubSpotRetry(
      () =>
        hubspotClient.crm.objects.tasks.searchApi.doSearch({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "associations.deal",
                  operator: FilterOperatorEnum.Eq,
                  value: dealId,
                },
                {
                  propertyName: "hs_task_status",
                  operator: FilterOperatorEnum.Neq,
                  value: "COMPLETED",
                },
              ],
            },
          ],
          properties: ["hs_task_subject", "hs_task_status"],
          limit: 100,
        }),
      "ic-hub.completeIcTask.search",
    );

    if (!searchResult.ok) {
      throw new Error(`HubSpot task search failed: ${searchResult.error}`);
    }

    const openMatch = (searchResult.data.results ?? []).find((t) => {
      const subject = String(
        (t.properties as Record<string, string | null>)?.hs_task_subject ?? "",
      ).toLowerCase();
      return subjectPatterns.some((p) => subject.includes(p.toLowerCase()));
    });

    if (openMatch) {
      taskId = openMatch.id;
      await updateTask(openMatch.id, { status: "COMPLETED", body: noteBody });
      taskCompleted = true;
    }
  }

  if (!taskCompleted && fallbackProperties) {
    await hubspotClient.crm.deals.basicApi.update(dealId, {
      properties: fallbackProperties,
    });
  }

  try {
    await createDealNote(dealId, noteBody);
  } catch (err) {
    console.error("[ic-hub] createDealNote failed", err);
  }

  return {
    taskCompleted,
    taskId,
    taskNotFound: !taskCompleted && !forceFallback,
  };
}

export async function recordIcActivity(opts: {
  userEmail: string;
  userName?: string;
  userId: string | null;
  type: ActivityType;
  dealId: string;
  description: string;
  metadata?: unknown;
  entityName?: string;
  pbLocation?: string;
}): Promise<void> {
  await prisma.activityLog.create({
    data: {
      type: opts.type,
      description: opts.description,
      userId: opts.userId ?? undefined,
      userEmail: opts.userEmail,
      userName: opts.userName,
      entityType: "deal",
      entityId: opts.dealId,
      entityName: opts.entityName,
      pbLocation: opts.pbLocation,
      metadata: (opts.metadata ?? {}) as never,
    },
  });
}

export async function deleteIcDraft(opts: {
  userId: string;
  dealId: string;
  actionKind: string;
}): Promise<void> {
  await prisma.permitHubDraft.deleteMany({
    where: {
      userId: opts.userId,
      dealId: opts.dealId,
      actionKind: opts.actionKind,
    },
  });
}
