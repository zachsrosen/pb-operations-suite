/**
 * HubSpot tasks for the current user — "My Tasks" page.
 *
 * Resolves a PB user's email → HubSpot owner ID, then fetches their open
 * tasks with associated deal/ticket/contact context and queue metadata.
 */

import * as Sentry from "@sentry/nextjs";
import { hubspotClient } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/objects/tasks/models/Filter";
import { appCache } from "@/lib/cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "NOT_STARTED" | "IN_PROGRESS" | "WAITING" | "COMPLETED" | "DEFERRED";
export type TaskPriority = "HIGH" | "MEDIUM" | "LOW";
export type TaskType = "CALL" | "EMAIL" | "TODO";

export interface HubSpotTask {
  id: string;
  subject: string | null;
  body: string | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  type: TaskType | null;
  dueAt: string | null; // ISO
  queueIds: string[];
  ownerId: string;
  hubspotUrl: string;
}

export interface TaskAssociations {
  deal?: { id: string; name: string };
  ticket?: { id: string; subject: string };
  contact?: { id: string; name: string };
}

export interface EnrichedTask extends HubSpotTask {
  associations: TaskAssociations;
}

export interface TaskQueue {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Rate-limit retry (mirrors pattern from hubspot-engagements.ts)
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;

async function withHubSpotRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") || error.message.includes("rate") || error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;

      if ((isRateLimit || statusCode === 429) && attempt < MAX_RETRIES - 1) {
        const base = Math.pow(2, attempt) * 1100;
        const jitter = Math.random() * 400;
        const delay = Math.round(base + jitter);
        console.warn(`[hubspot-tasks] ${label} rate limited (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`[hubspot-tasks] ${label} max retries exceeded`);
}

// ---------------------------------------------------------------------------
// Owner resolution by email
// ---------------------------------------------------------------------------

const OWNER_MAP_CACHE_KEY = "hubspot:owner-email-to-id-map";

/**
 * Fetch ALL HubSpot owners and build an email→id map.
 *
 * Chose this over the ownersApi.getPage(email, ...) filter form because
 * the filter form returned zero results for known owners in our tenant
 * (possibly an SDK arg-order quirk, possibly a portal config issue).
 * Listing all owners is a single request for tenants with fewer than 500
 * owners, which matches our scale.
 */
async function getOwnerEmailMap(): Promise<Map<string, string>> {
  const cached = appCache.get<Record<string, string>>(OWNER_MAP_CACHE_KEY);
  if (cached.hit && cached.data) {
    return new Map(Object.entries(cached.data));
  }

  const map = new Map<string, string>();
  let after: string | undefined = undefined;
  const MAX_PAGES = 10;

  try {
    for (let i = 0; i < MAX_PAGES; i++) {
      const page: { results?: Array<{ id?: string; email?: string }>; paging?: { next?: { after?: string } } } =
        await withHubSpotRetry(
          "owners.list",
          () => hubspotClient.crm.owners.ownersApi.getPage(undefined, after, 500, false),
        );
      for (const o of page.results ?? []) {
        const email = o.email?.trim().toLowerCase();
        if (email && o.id) map.set(email, o.id);
      }
      after = page.paging?.next?.after;
      if (!after) break;
    }
    appCache.set(OWNER_MAP_CACHE_KEY, Object.fromEntries(map));
  } catch (err) {
    Sentry.captureException(err, { tags: { module: "hubspot-tasks", op: "getOwnerEmailMap" } });
  }
  return map;
}

export async function resolveOwnerIdByEmail(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const map = await getOwnerEmailMap();
  return map.get(normalized) ?? null;
}

// ---------------------------------------------------------------------------
// Task fetch
// ---------------------------------------------------------------------------

const TASK_PROPERTIES = [
  "hs_task_subject",
  "hs_task_body",
  "hs_task_status",
  "hs_task_priority",
  "hs_task_type",
  "hs_timestamp",
  "hs_queue_membership_ids",
  "hubspot_owner_id",
];

const OPEN_STATUSES: TaskStatus[] = ["NOT_STARTED", "IN_PROGRESS", "WAITING"];

const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? "";

function buildHubspotTaskUrl(taskId: string): string {
  if (!HUBSPOT_PORTAL_ID) return `https://app.hubspot.com/contacts/0/tasks/${taskId}`;
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/tasks/${taskId}`;
}

function mapRawTask(raw: { id: string; properties: Record<string, string | null> }): HubSpotTask {
  const p = raw.properties;
  const queueRaw = p.hs_queue_membership_ids ?? "";
  const queueIds = queueRaw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    id: raw.id,
    subject: p.hs_task_subject ?? null,
    body: p.hs_task_body ?? null,
    status: (p.hs_task_status as TaskStatus) ?? "NOT_STARTED",
    priority: (p.hs_task_priority as TaskPriority) ?? null,
    type: (p.hs_task_type as TaskType) ?? null,
    dueAt: p.hs_timestamp ?? null,
    queueIds,
    ownerId: p.hubspot_owner_id ?? "",
    hubspotUrl: buildHubspotTaskUrl(raw.id),
  };
}

export async function fetchOpenTasksByOwner(ownerId: string): Promise<HubSpotTask[]> {
  const tasks: HubSpotTask[] = [];
  let after: string | undefined = undefined;
  const MAX_PAGES = 10; // 10 * 100 = 1000 tasks max

  for (let page = 0; page < MAX_PAGES; page++) {
    const resp: { results: Array<{ id: string; properties: Record<string, string | null> }>; paging?: { next?: { after?: string } } } = await withHubSpotRetry(
      "tasks.search",
      () => hubspotClient.crm.objects.tasks.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              { propertyName: "hubspot_owner_id", operator: FilterOperatorEnum.Eq, value: ownerId },
              { propertyName: "hs_task_status", operator: FilterOperatorEnum.In, values: OPEN_STATUSES },
            ],
          },
        ],
        properties: TASK_PROPERTIES,
        sorts: ["hs_timestamp"],
        limit: 100,
        after,
      } as never),
    );

    for (const raw of resp.results ?? []) {
      tasks.push(mapRawTask(raw));
    }

    after = resp.paging?.next?.after;
    if (!after) break;
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

const QUEUES_CACHE_KEY = "hubspot:task-queues";

interface HubSpotQueueRaw {
  objectId?: number | string;
  queueId?: number | string;
  id?: number | string;
  name?: string;
  label?: string;
}

export async function fetchQueues(): Promise<TaskQueue[]> {
  const cached = appCache.get<TaskQueue[]>(QUEUES_CACHE_KEY);
  if (cached.hit && cached.data) return cached.data;

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return [];

  try {
    const resp = await withHubSpotRetry("queues.list", async () => {
      const r = await fetch("https://api.hubapi.com/crm/v3/objects/tasks/queues", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const err = new Error(`queues fetch ${r.status}`);
        (err as unknown as { code: number }).code = r.status;
        throw err;
      }
      return r.json() as Promise<{ results?: HubSpotQueueRaw[] }>;
    });

    const queues: TaskQueue[] = (resp.results ?? []).map((q) => ({
      id: String(q.objectId ?? q.queueId ?? q.id ?? ""),
      name: q.name ?? q.label ?? "Untitled queue",
    })).filter((q) => q.id);

    appCache.set(QUEUES_CACHE_KEY, queues);
    return queues;
  } catch (err) {
    Sentry.captureException(err, { tags: { module: "hubspot-tasks", op: "fetchQueues" } });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Associations
// ---------------------------------------------------------------------------

async function fetchAssocMap(
  taskIds: string[],
  toType: "deals" | "tickets" | "contacts",
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (taskIds.length === 0) return out;

  try {
    const resp = await withHubSpotRetry(
      `associations:tasks->${toType}`,
      () => hubspotClient.crm.associations.batchApi.read("tasks", toType, {
        inputs: taskIds.map((id) => ({ id })),
      }),
    );
    for (const r of resp.results ?? []) {
      const assoc = r as unknown as { from?: { id?: string }; _from?: { id?: string }; to?: Array<{ id?: string }> };
      const fromId = assoc.from?.id ?? assoc._from?.id;
      const firstTo = assoc.to?.[0]?.id;
      if (fromId && firstTo) out.set(fromId, firstTo);
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { module: "hubspot-tasks", op: `associations:${toType}` },
    });
  }
  return out;
}

async function batchReadNames(
  ids: string[],
  objectType: "deals" | "tickets" | "contacts",
  properties: string[],
): Promise<Map<string, Record<string, string | null>>> {
  const out = new Map<string, Record<string, string | null>>();
  if (ids.length === 0) return out;

  try {
    const resp = await withHubSpotRetry(
      `batch-read:${objectType}`,
      () => hubspotClient.crm.objects.batchApi.read(objectType, {
        inputs: ids.map((id) => ({ id })),
        properties,
        propertiesWithHistory: [],
      }),
    );
    for (const r of resp.results ?? []) {
      out.set(r.id, r.properties as Record<string, string | null>);
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { module: "hubspot-tasks", op: `batch-read:${objectType}` },
    });
  }
  return out;
}

export async function enrichWithAssociations(tasks: HubSpotTask[]): Promise<EnrichedTask[]> {
  const taskIds = tasks.map((t) => t.id);

  const [dealMap, ticketMap, contactMap] = await Promise.all([
    fetchAssocMap(taskIds, "deals"),
    fetchAssocMap(taskIds, "tickets"),
    fetchAssocMap(taskIds, "contacts"),
  ]);

  const dealIds = [...new Set(dealMap.values())];
  const ticketIds = [...new Set(ticketMap.values())];
  const contactIds = [...new Set(contactMap.values())];

  const [deals, tickets, contacts] = await Promise.all([
    batchReadNames(dealIds, "deals", ["dealname"]),
    batchReadNames(ticketIds, "tickets", ["subject"]),
    batchReadNames(contactIds, "contacts", ["firstname", "lastname"]),
  ]);

  return tasks.map<EnrichedTask>((task) => {
    const associations: TaskAssociations = {};

    const dealId = dealMap.get(task.id);
    if (dealId) {
      const dealProps = deals.get(dealId);
      associations.deal = { id: dealId, name: dealProps?.dealname || `Deal ${dealId}` };
    }

    const ticketId = ticketMap.get(task.id);
    if (ticketId) {
      const ticketProps = tickets.get(ticketId);
      associations.ticket = { id: ticketId, subject: ticketProps?.subject || `Ticket ${ticketId}` };
    }

    const contactId = contactMap.get(task.id);
    if (contactId) {
      const contactProps = contacts.get(contactId);
      const name = [contactProps?.firstname, contactProps?.lastname].filter(Boolean).join(" ").trim();
      associations.contact = { id: contactId, name: name || `Contact ${contactId}` };
    }

    return { ...task, associations };
  });
}
