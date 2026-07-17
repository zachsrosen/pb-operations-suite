/**
 * Permit Hub — Business Logic
 *
 * Solo workspace that aggregates context for open permit action items and
 * writes back via HubSpot task completion (preserving existing Workflows).
 * Mirrors lib/idr-meeting.ts structurally; extraction to shared primitives
 * deferred until IC Hub (second consumer).
 */

import { prisma } from "@/lib/db";
import { hubspotClient, searchWithRetry } from "@/lib/hubspot";
import { fetchStatusEnteredAt } from "@/lib/status-entered";
import { getEnumLabelMap, labelFor } from "@/lib/hubspot-enum-labels";
import { createDealNote } from "@/lib/hubspot-engagements";
import { updateTask } from "@/lib/hubspot-tasks";
import { withHubSpotRetry } from "@/lib/bulk-sync-confirmation";
import {
  fetchAHJsForDeal,
  fetchAllAHJs,
  type AHJRecord,
} from "@/lib/hubspot-custom-objects";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import {
  PERMIT_ACTION_STATUSES,
  PERMIT_ACTION_TASK_SUBJECTS,
  STALE_THRESHOLD_DAYS,
  actionKindForStatus,
  type PermitActionKind,
} from "@/lib/pi-statuses";
import {
  EXCLUDED_STAGES,
  INCLUDED_PIPELINES,
  PI_LEADS,
} from "@/lib/daily-focus/config";
import { buildOwnerMap, locationInBucket } from "@/lib/idr-meeting";
import { buildStageDisplayMap } from "@/lib/daily-focus/format";
import { getHubSpotDealUrl } from "@/lib/external-links";
import {
  buildGmailThreadQuery,
  extractIdentifierTokens,
  fetchSharedInboxThreads,
  getSharedInboxAddress,
  type SharedInboxThread,
} from "@/lib/gmail-shared-inbox";

/**
 * HubSpot owner ID → permit lead name.
 * Sourced from PI_LEADS so adding a new lead in daily-focus/config.ts
 * automatically populates here too.
 */
const PERMIT_LEAD_BY_OWNER_ID: Record<string, string> = Object.fromEntries(
  PI_LEADS.filter((l) => l.roles.includes("permit_tech")).map((l) => [
    l.hubspotOwnerId,
    l.name,
  ]),
);

function resolvePermitLeadName(
  props: Record<string, string | null>,
  ownerMap?: Map<string, string>,
): string | null {
  // 1. Explicit name field (rarely populated in prod).
  if (props.permit_lead_name) return props.permit_lead_name;
  // 2. permit_tech owner-id → owner map (full HubSpot owners API).
  const ownerId = props.permit_tech;
  if (ownerId) {
    const resolved = ownerMap?.get(ownerId) ?? PERMIT_LEAD_BY_OWNER_ID[ownerId];
    if (resolved) return resolved;
  }
  return null;
}
import type { ActivityType } from "@/generated/prisma/enums";

/**
 * The queue carries every deal that HAS a permitting_status except the terminal
 * ones below. Statuses that map to a permit action land in the action tabs
 * (Ready / Rejections / Resubmit / Waiting); everything else — design-owned
 * revision work, plus states with no permit action like "Waiting On
 * Information" — falls into the "Other" tab, so nothing is invisible.
 *
 * Expressed as an exclusion rather than an allowlist so a newly added
 * permitting_status surfaces in "Other" instead of silently vanishing.
 *
 * These are HubSpot internal VALUES, not labels — several differ ("Complete" is
 * labelled "Permit Issued").
 */
const PERMIT_TERMINAL_STATUSES = [
  "Complete",   // labelled "Permit Issued" — done (~432 deals; would swamp the hub)
  "Not Needed", // no permit required for this project
];

/**
 * Safety cap on queue pagination — 10 pages x 200 = 2000 deals, far above the
 * real queue (~57). Guards against an unbounded loop if HubSpot keeps
 * returning a cursor; a hit is logged rather than silently truncating.
 */
const MAX_QUEUE_PAGES = 10;

// ---------------------------------------------------------------------------
// Permission + flag helpers
// ---------------------------------------------------------------------------

// Keep this list tight to the spec (PERMIT, TECH_OPS, ADMIN, EXECUTIVE).
// PMs can view the page via allowedRoutes if/when added to PROJECT_MANAGER's
// block in roles.ts, but action writes stay scoped to the permitting team.
export const PERMIT_HUB_ROLES = [
  "ADMIN",
  "EXECUTIVE",
  "PERMIT",
  "TECH_OPS",
] as const;

export function isPermitHubAllowedRole(role: string): boolean {
  return (PERMIT_HUB_ROLES as readonly string[]).includes(role);
}

export function isPermitHubEnabled(): boolean {
  return process.env.PERMIT_HUB_ENABLED === "true";
}

/**
 * `requireApiAuth()` returns only `email` (no user id). For foreign-key use
 * (e.g., `PermitHubDraft.userId`, optional `ActivityLog.userId`), resolve the
 * id here. Returns null if no user row exists — callers should fall back to
 * `userEmail`-only write paths.
 */
export async function resolveUserIdByEmail(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return user?.id ?? null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PermitQueueItem {
  dealId: string;
  name: string;
  address: string | null;
  pbLocation: string | null;
  /** HubSpot internal VALUE — used for routing/filtering, not for display. */
  status: string;
  /** Human label for `status` (they differ for several options). Display this. */
  statusLabel: string;
  /** Resolved deal-stage name (e.g. "Permitting & Interconnection"); null if unresolved. */
  dealStage: string | null;
  actionLabel: string;
  actionKind: PermitActionKind | null;
  /** Days since the deal entered its current permitting_status; null when unknown. */
  daysInStatus: number | null;
  isStale: boolean;
  permitLead: string | null;
  /** HubSpot owner ID on permit_tech — exposed so the client can filter
   *  unassigned (null) as a pseudo-option alongside named leads. */
  permitLeadOwnerId: string | null;
  pm: string | null;
  amount: number | null;
}

export interface PermitProjectDetail {
  deal: {
    id: string;
    name: string;
    address: string | null;
    amount: number | null;
    pbLocation: string | null;
    permitLead: string | null;
    pm: string | null;
    /** HubSpot internal VALUE — used for routing, not for display. */
    permittingStatus: string;
    /** Human label for `permittingStatus`. Display this. */
    permittingStatusLabel: string;
    actionKind: PermitActionKind | null;
    actionLabel: string | null;
    systemSizeKw: number | null;
    dealStage: string | null;
    hubspotUrl: string;
    designFolderUrl: string | null;
    permitFolderUrl: string | null;
    driveFolderUrl: string | null;
    /** First associated AHJ's portal link (for header quick-access). */
    ahjPortalUrl: string | null;
    /** First associated AHJ's application link. */
    ahjApplicationUrl: string | null;
  };
  ahj: AHJRecord[];
  /** @deprecated use deal.designFolderUrl instead (kept for planset tab backcompat) */
  plansetFolderUrl: string | null;
  correspondenceSearchUrl: string | null;
  /** Recent threads from the region's shared permit inbox — empty when
   *  not configured, service account misconfigured, or no matching threads. */
  correspondenceThreads: SharedInboxThread[];
  /** Which shared inbox the threads came from — shown to Peter so he knows
   *  which mailbox was searched. Null when no thread fetch was attempted. */
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

/** Returns every non-terminal permit deal — action tabs plus the "Other" tab. */
export async function fetchPermitQueue(): Promise<PermitQueueItem[]> {
  // Scope:
  //   • has a permitting_status at all (a deal with none isn't permit work)
  //   • permitting_status NOT IN terminal (Complete / Not Needed)
  //   • dealstage NOT IN cancelled/complete/on-hold terminal stages
  //   • pipeline IN Project / D&R / Service / Roofing
  // The `values` arrays are cast because the HubSpot SDK's Filter type only
  // declares `value: string`, but the API (and runtime SDK) accept `values`
  // for IN / NOT_IN — same pattern used in daily-focus/queries.ts.
  const filters: Record<string, unknown>[] = [
    {
      propertyName: "pipeline",
      operator: FilterOperatorEnum.In,
      values: INCLUDED_PIPELINES,
    },
    {
      propertyName: "permitting_status",
      operator: FilterOperatorEnum.HasProperty,
    },
    {
      propertyName: "permitting_status",
      operator: FilterOperatorEnum.NotIn,
      values: PERMIT_TERMINAL_STATUSES,
    },
    {
      propertyName: "dealstage",
      operator: FilterOperatorEnum.NotIn,
      values: EXCLUDED_STAGES,
    },
  ];

  // HubSpot search returns at most 200 results per page. The queue is well
  // under that today (~57 deals), but a single un-paged call would silently
  // drop the tail if it ever grows past 200, so page with the `after` cursor.
  // Costs nothing while under one page: the loop exits after one request.
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
        "permitting_status",
        "dealstage",
        "pipeline",
        "hs_lastmodifieddate",
        "amount",
        "hubspot_owner_id",
        "project_manager",
        "permit_lead_name",
        "permit_tech",
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
      `[permit-hub] queue hit the ${MAX_QUEUE_PAGES}-page cap (${searchResults.length} deals); results are truncated`,
    );
  }

  // Resolve owner-id + dealstage-id properties to display names in parallel.
  // buildOwnerMap batches the owners API so this is ~1 extra HubSpot call
  // for the whole queue. buildStageDisplayMap is cached via getStageMaps.
  const rawDeals = searchResults.map((d) => ({
    properties: (d.properties ?? {}) as Record<string, string | null>,
  }));
  // Real time-in-status comes from permitting_status property history — NOT
  // hs_lastmodifieddate, which a calc-property loop re-stamps daily (every row
  // computed to 0 days). See lib/status-entered.ts.
  const [ownerMap, stageMap, enteredAtByDeal, statusLabels] = await Promise.all([
    buildOwnerMap(rawDeals),
    buildStageDisplayMap(),
    fetchStatusEnteredAt(
      searchResults.map((d) => ({
        id: d.id,
        status: d.properties?.permitting_status ?? "",
      })),
      "permitting_status",
    ),
    getEnumLabelMap("permitting_status"),
  ]);

  const items: PermitQueueItem[] = [];
  const now = Date.now();
  for (const deal of searchResults) {
    const props = (deal.properties ?? {}) as Record<string, string | null>;
    const status = props.permitting_status ?? "";
    const enteredAt = enteredAtByDeal.get(deal.id);
    // null (not 0) when the entry time can't be resolved — the UI shows "—"
    // rather than implying the deal just changed status.
    const daysInStatus =
      enteredAt === undefined
        ? null
        : Math.floor((now - enteredAt) / (1000 * 60 * 60 * 24));
    const actionLabel = PERMIT_ACTION_STATUSES[status] ?? "";

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
      actionKind: actionKindForStatus(status),
      daysInStatus,
      isStale: daysInStatus !== null && daysInStatus > STALE_THRESHOLD_DAYS,
      permitLead: resolvePermitLeadName(props, ownerMap),
      permitLeadOwnerId: props.permit_tech ?? null,
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

export async function fetchPermitProjectDetail(
  dealId: string,
): Promise<PermitProjectDetail | null> {
  let deal;
  try {
    deal = await hubspotClient.crm.deals.basicApi.getById(dealId, [
      "dealname",
      "project_number",
      // Per-trade permit numbers — the AHJ cites these in correspondence.
      "permit_number___pv",
      "permit_number___ess",
      "permit_number___elec",
      "permit_number___fire_protection",
      "permit_number___zoning___land_use",
      "address_line_1",
      "city",
      "state",
      "zip",
      "pb_location",
      "ahj",                     // deal-level AHJ name — fallback when no association
      "amount",
      "permit_lead_name",
      "permit_tech",
      "project_manager",
      "permitting_status",
      "dealstage",
      "calculated_system_size__kwdc_",
      // Google Drive folder URLs — see CLAUDE.md External system links.
      "design_documents",        // design folder URL
      "permit_documents",        // permitting folder URL
      "g_drive",                 // general project folder (fallback)
      // Legacy / alternative property names — kept as fallbacks since
      // the HubSpot portal may use different ones on older deals.
      "planset_drive_folder_url",
      "design_folder_url",
      "all_document_folder_url",
    ]);
  } catch {
    return null;
  }

  const props = (deal.properties ?? {}) as Record<string, string | null>;
  const [associatedAhj, ownerMap, stageMap] = await Promise.all([
    fetchAHJsForDeal(dealId),
    buildOwnerMap([{ properties: props }]),
    buildStageDisplayMap(),
  ]);

  // Fallback chain when no explicit HubSpot deal→AHJ association exists
  // (common in prod — not every deal has the relationship set):
  //   1. Match the deal's `ahj` property (free-text AHJ name set by sales)
  //      against AHJ custom-object `record_name` or `ahj_code`.
  //   2. Fall back to city + state match if the name lookup finds nothing.
  // Either way, return at most 3 matches so Peter always gets portal +
  // turnaround stats, even without the formal association.
  let ahj: AHJRecord[] = associatedAhj;
  if (ahj.length === 0) {
    try {
      const all = await fetchAllAHJs();

      const dealAhjName = (props.ahj ?? "").trim().toLowerCase();
      if (dealAhjName) {
        ahj = all
          .filter((r) => {
            const p = r.properties as Record<string, string | null>;
            const name = (p.record_name ?? "").trim().toLowerCase();
            const code = (p.ahj_code ?? "").trim().toLowerCase();
            return (
              (name && (name === dealAhjName || name.includes(dealAhjName))) ||
              (code && code === dealAhjName)
            );
          })
          .slice(0, 3);
      }

      if (ahj.length === 0 && props.city) {
        const dealCity = props.city.trim().toLowerCase();
        const dealState = (props.state ?? "").trim().toLowerCase();
        ahj = all
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
      // fetchAllAHJs failed — leave ahj empty; UI falls back to the
      // "no AHJ record" message rather than failing the whole request.
    }
  }

  const permittingStatus = props.permitting_status ?? "";
  const actionLabel = PERMIT_ACTION_STATUSES[permittingStatus] ?? null;
  const resolvedKind = actionKindForStatus(permittingStatus);
  const permittingStatusLabel = labelFor(
    await getEnumLabelMap("permitting_status"),
    permittingStatus,
  );

  const pmId = props.project_manager;
  const resolvedPm = pmId ? (ownerMap.get(pmId) ?? pmId) : null;
  const dealStageId = props.dealstage;
  const resolvedDealStage = dealStageId
    ? (stageMap[dealStageId] ?? dealStageId)
    : null;

  const fullAddress =
    [props.address_line_1, props.city, props.state].filter(Boolean).join(", ") || null;

  const ahjEmail = (ahj[0]?.properties as Record<string, string | null> | undefined)?.email ?? null;
  const correspondenceSearchUrl =
    ahjEmail && fullAddress ? buildGmailSearchUrl(ahjEmail, fullAddress) : null;

  // Region routing for the shared permit inbox fetch. Bucket uses the
  // same CO/CA definition idr-meeting uses (Westminster/Centennial/COSP
  // → CO; SLO/Camarillo → CA). Deals in an unrecognized location get
  // no thread fetch (correspondenceInbox = null).
  let correspondenceInbox: string | null = null;
  let correspondenceThreads: SharedInboxThread[] = [];
  // Project-unique keys the AHJ cites: street address, PROJ number, and the
  // per-trade permit numbers. NOT the AHJ email — it is shared across every
  // project in the jurisdiction and pulled in other projects' threads.
  // Hand-entered fields — extract clean tokens so pollution ("B2404681 (elec)")
  // can't defeat the quoted-phrase match. Clean values pass through unchanged.
  const permitIdentifiers = [
    props.permit_number___pv,
    props.permit_number___ess,
    props.permit_number___elec,
    props.permit_number___fire_protection,
    props.permit_number___zoning___land_use,
  ].flatMap((v) => extractIdentifierTokens(v));
  if (props.address_line_1 || props.project_number || permitIdentifiers.some(Boolean)) {
    const pbLoc = props.pb_location;
    let region: "co" | "ca" | null = null;
    if (locationInBucket(pbLoc, "colorado")) region = "co";
    else if (locationInBucket(pbLoc, "california")) region = "ca";

    if (region) {
      const mailbox = getSharedInboxAddress("permit", region);
      if (mailbox) {
        correspondenceInbox = mailbox;
        correspondenceThreads = await fetchSharedInboxThreads({
          mailbox,
          query: buildGmailThreadQuery({
            address: props.address_line_1,
            projectNumber: props.project_number,
            identifiers: permitIdentifiers,
            lookbackDays: 90,
          }),
          maxThreads: 10,
        });
      }
    }
  }

  const designFolderUrl =
    props.design_documents ??
    props.design_folder_url ??
    props.planset_drive_folder_url ??
    null;
  const permitFolderUrl = props.permit_documents ?? null;
  const driveFolderUrl =
    props.g_drive ?? props.all_document_folder_url ?? null;
  // Back-compat: planset tab used a single URL. Prefer the design folder.
  const plansetFolderUrl = designFolderUrl ?? driveFolderUrl;

  const [statusHistory, activity] = await Promise.all([
    fetchPermitStatusHistory(dealId),
    fetchPermitActivity(dealId),
  ]);

  return {
    deal: {
      id: dealId,
      name: props.dealname ?? "Untitled",
      address: fullAddress,
      amount: props.amount ? Number(props.amount) : null,
      pbLocation: props.pb_location ?? null,
      permitLead: resolvePermitLeadName(props, ownerMap),
      pm: resolvedPm,
      permittingStatus,
      permittingStatusLabel,
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
      ahjPortalUrl:
        ((ahj[0]?.properties as Record<string, string | null | undefined> | undefined)
          ?.portal_link as string | null | undefined) ?? null,
      ahjApplicationUrl:
        ((ahj[0]?.properties as Record<string, string | null | undefined> | undefined)
          ?.application_link as string | null | undefined) ?? null,
    },
    ahj,
    plansetFolderUrl,
    correspondenceSearchUrl,
    correspondenceThreads,
    correspondenceInbox,
    statusHistory,
    activity,
  };
}

function buildGmailSearchUrl(ahjEmail: string, address: string): string {
  const query = encodeURIComponent(`from:${ahjEmail} OR to:${ahjEmail} "${address}"`);
  return `https://mail.google.com/mail/u/0/#search/${query}`;
}

async function fetchPermitStatusHistory(
  dealId: string,
): Promise<Array<{ property: string; value: string | null; timestamp: string }>> {
  // HubSpot property-history endpoint — shape is { propertiesWithHistory: { <prop>: [{ value, timestamp }, ...] } }
  try {
    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) return [];
    const url = new URL(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`);
    url.searchParams.set(
      "propertiesWithHistory",
      "permitting_status,permit_submit,permit_issued",
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

// ---------------------------------------------------------------------------
// Action writeback helpers
// ---------------------------------------------------------------------------

export interface CompleteTaskResult {
  taskCompleted: boolean;
  taskId?: string;
  /** True when no matching open task was found — caller should surface a warning. */
  taskNotFound?: boolean;
}

/**
 * Completes the HubSpot task on `dealId` whose subject matches one of the
 * patterns for this action kind, then attaches a note engagement with the
 * captured payload. Returns `taskNotFound: true` if no matching task found —
 * caller decides whether to write status fields as an escape hatch.
 *
 * SDK paths follow the repo convention (`crm.objects.tasks.*`, not `tasksApi`).
 */
export async function completePermitTask(opts: {
  dealId: string;
  actionKind: PermitActionKind;
  noteBody: string;
  /** Optional — when provided, falls back to updating these deal properties if no task is found. */
  fallbackProperties?: Record<string, string>;
  /** Whether to force fallback path even if task is found. Set by the "escape hatch" UI. */
  forceFallback?: boolean;
}): Promise<CompleteTaskResult> {
  const { dealId, actionKind, noteBody, fallbackProperties, forceFallback } = opts;
  const subjectPatterns = PERMIT_ACTION_TASK_SUBJECTS[actionKind];

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
      "permit-hub.completePermitTask.search",
    );

    if (!searchResult.ok) {
      // Rate-limit or HubSpot outage — surface to caller so the UI can retry
      // rather than silently falling through to the deal-property escape hatch.
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
      // updateTask wraps the call in withHubSpotRetry internally. HubSpot sets
      // hs_task_completion_date automatically when status becomes COMPLETED —
      // don't pass a timestamp property here.
      await updateTask(openMatch.id, { status: "COMPLETED", body: noteBody });
      taskCompleted = true;
    }
  }

  // Fallback: if task not found (or force), write the fallback deal properties.
  if (!taskCompleted && fallbackProperties) {
    await hubspotClient.crm.deals.basicApi.update(dealId, {
      properties: fallbackProperties,
    });
  }

  // Always create a note engagement summarizing the action.
  try {
    await createDealNote(dealId, noteBody);
  } catch (err) {
    console.error("[permit-hub] createDealNote failed", err);
  }

  return {
    taskCompleted,
    taskId,
    taskNotFound: !taskCompleted && !forceFallback,
  };
}

/**
 * Writes a permit-hub ActivityLog entry.
 *
 * Schema (prisma/schema.prisma:305): ActivityLog requires `description` and
 * uses `entityType` + `entityId` (not a `dealId` column). Both `userId` and
 * `userEmail` may be set — we set both so queries can filter by either.
 */
export async function recordPermitActivity(opts: {
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

export async function deletePermitDraft(opts: {
  userId: string;
  dealId: string;
  actionKind: string;
}): Promise<void> {
  await prisma.permitHubDraft.deleteMany({
    where: { userId: opts.userId, dealId: opts.dealId, actionKind: opts.actionKind },
  });
}

// ---------------------------------------------------------------------------
// Existing activity fetch
// ---------------------------------------------------------------------------

async function fetchPermitActivity(
  dealId: string,
): Promise<PermitProjectDetail["activity"]> {
  try {
    const { getDealEngagements } = await import("@/lib/hubspot-engagements");
    const engagements = await getDealEngagements(dealId);
    return engagements
      .filter((e) => {
        const subject = String(e.subject ?? "").toLowerCase();
        const body = String(e.body ?? "").toLowerCase();
        return (
          subject.includes("permit") ||
          body.includes("permit") ||
          subject.includes("ahj") ||
          body.includes("ahj")
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
