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
import { createDealNote } from "@/lib/hubspot-engagements";
import { fetchAHJsForDeal, type AHJRecord } from "@/lib/hubspot-custom-objects";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import {
  PERMIT_ACTION_STATUSES,
  PERMIT_ACTION_TASK_SUBJECTS,
  STALE_THRESHOLD_DAYS,
  actionKindForStatus,
  type PermitActionKind,
} from "@/lib/pi-statuses";
import type { ActivityType } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Permission + flag helpers
// ---------------------------------------------------------------------------

export const PERMIT_HUB_ROLES = [
  "ADMIN",
  "EXECUTIVE",
  "OWNER",
  "PROJECT_MANAGER",
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
  status: string;
  actionLabel: string;
  actionKind: PermitActionKind | null;
  daysInStatus: number;
  isStale: boolean;
  permitLead: string | null;
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
    permittingStatus: string;
    actionKind: PermitActionKind | null;
    actionLabel: string | null;
    systemSizeKw: number | null;
    dealStage: string | null;
  };
  ahj: AHJRecord[];
  plansetFolderUrl: string | null;
  correspondenceSearchUrl: string | null;
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

/** Returns all deals currently sitting in one of the PERMIT_ACTION_STATUSES. */
export async function fetchPermitQueue(): Promise<PermitQueueItem[]> {
  const statuses = Object.keys(PERMIT_ACTION_STATUSES);
  const projectPipelineId = process.env.HUBSPOT_PIPELINE_PROJECT || "6900017";

  const response = await searchWithRetry({
    filterGroups: [
      {
        filters: [
          {
            propertyName: "pipeline",
            operator: FilterOperatorEnum.Eq,
            value: projectPipelineId,
          },
          {
            propertyName: "permitting_status",
            operator: FilterOperatorEnum.In,
            values: statuses,
          },
        ],
      },
    ],
    properties: [
      "dealname",
      "address_line_1",
      "city",
      "state",
      "pb_location",
      "permitting_status",
      "hs_lastmodifieddate",
      "amount",
      "hubspot_owner_id",
      "project_manager",
      "permit_lead_name",
      "calculated_system_size__kwdc_",
    ],
    limit: 200,
    sorts: ["hs_lastmodifieddate"],
  });

  const items: PermitQueueItem[] = [];
  const now = Date.now();
  for (const deal of response.results ?? []) {
    const props = (deal.properties ?? {}) as Record<string, string | null>;
    const status = props.permitting_status ?? "";
    const lastModified = props.hs_lastmodifieddate
      ? new Date(props.hs_lastmodifieddate).getTime()
      : now;
    const daysInStatus = Math.floor((now - lastModified) / (1000 * 60 * 60 * 24));
    const actionLabel = PERMIT_ACTION_STATUSES[status] ?? "";

    items.push({
      dealId: deal.id,
      name: props.dealname ?? "Untitled",
      address: props.address_line_1 ?? null,
      pbLocation: props.pb_location ?? null,
      status,
      actionLabel,
      actionKind: actionKindForStatus(status),
      daysInStatus,
      isStale: daysInStatus > STALE_THRESHOLD_DAYS,
      permitLead: props.permit_lead_name ?? null,
      pm: props.project_manager ?? null,
      amount: props.amount ? Number(props.amount) : null,
    });
  }

  items.sort((a, b) => b.daysInStatus - a.daysInStatus);
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
      "address_line_1",
      "city",
      "state",
      "zip",
      "pb_location",
      "amount",
      "permit_lead_name",
      "project_manager",
      "permitting_status",
      "dealstage",
      "calculated_system_size__kwdc_",
      "planset_drive_folder_url",
      "design_folder_url",
      "all_document_folder_url",
    ]);
  } catch {
    return null;
  }

  const props = (deal.properties ?? {}) as Record<string, string | null>;
  const ahj = await fetchAHJsForDeal(dealId);

  const permittingStatus = props.permitting_status ?? "";
  const actionLabel = PERMIT_ACTION_STATUSES[permittingStatus] ?? null;
  const resolvedKind = actionKindForStatus(permittingStatus);

  const fullAddress =
    [props.address_line_1, props.city, props.state].filter(Boolean).join(", ") || null;

  const ahjEmail = (ahj[0]?.properties as Record<string, string | null> | undefined)?.email ?? null;
  const correspondenceSearchUrl =
    ahjEmail && fullAddress ? buildGmailSearchUrl(ahjEmail, fullAddress) : null;

  const plansetFolderUrl =
    props.planset_drive_folder_url ??
    props.design_folder_url ??
    props.all_document_folder_url ??
    null;

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
      permitLead: props.permit_lead_name ?? null,
      pm: props.project_manager ?? null,
      permittingStatus,
      actionKind: resolvedKind,
      actionLabel,
      systemSizeKw: props.calculated_system_size__kwdc_
        ? Number(props.calculated_system_size__kwdc_)
        : null,
      dealStage: props.dealstage ?? null,
    },
    ahj,
    plansetFolderUrl,
    correspondenceSearchUrl,
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
    try {
      const taskSearchResp = await hubspotClient.crm.objects.tasks.searchApi.doSearch({
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
      });

      const openMatch = (taskSearchResp.results ?? []).find((t) => {
        const subject = String(
          (t.properties as Record<string, string | null>)?.hs_task_subject ?? "",
        ).toLowerCase();
        return subjectPatterns.some((p) => subject.includes(p.toLowerCase()));
      });

      if (openMatch) {
        taskId = openMatch.id;
        await hubspotClient.crm.objects.tasks.basicApi.update(openMatch.id, {
          properties: {
            hs_task_status: "COMPLETED",
            hs_task_completion_date: String(Date.now()),
            hs_task_body: noteBody,
          },
        });
        taskCompleted = true;
      }
    } catch (err) {
      // Log but don't fail — let fallback + note proceed.
      console.error("[permit-hub] task search/completion failed", err);
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
