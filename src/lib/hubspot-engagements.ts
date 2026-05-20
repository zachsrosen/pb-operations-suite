/**
 * HubSpot engagement fetch and deal note creation.
 *
 * Separated from hubspot.ts (2800+ lines) to keep files focused.
 * Uses rate-limit retry wrapper consistent with searchWithRetry() in hubspot.ts.
 *
 * Core primitive: getObjectEngagements() fetches emails/calls/notes/meetings/tasks
 * for any HubSpot object type (deals, tickets, contacts) and optionally expands
 * to associated contacts. Used by deal timeline, ticket timeline, and property
 * timeline features.
 */
import * as Sentry from "@sentry/nextjs";
import { hubspotClient } from "@/lib/hubspot";
import {
  AssociationSpecAssociationCategoryEnum,
} from "@hubspot/api-client/lib/codegen/crm/objects/notes/models/AssociationSpec";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import type { Engagement } from "@/components/deal-detail/types";

// ---------------------------------------------------------------------------
// Rate-limit retry (mirrors searchWithRetry pattern from hubspot.ts)
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
        console.warn(`[hubspot-engagements] ${label} rate limited (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`[hubspot-engagements] ${label} max retries exceeded`);
}

// ---------------------------------------------------------------------------
// Engagement types and property maps
// ---------------------------------------------------------------------------

const EMAIL_PROPERTIES = [
  "hs_email_subject", "hs_email_text", "hs_email_from_email",
  "hs_email_to_email", "hs_timestamp", "hs_email_direction",
  "hs_email_cc_email", "hs_email_bcc_email", "hs_email_status",
];

const CALL_PROPERTIES = [
  "hs_call_body", "hs_call_duration", "hs_call_disposition",
  "hs_timestamp", "hs_call_from_number", "hs_call_to_number",
  "hs_call_recording_url", "hs_call_title",
];

const NOTE_PROPERTIES = [
  "hs_note_body", "hs_timestamp", "hs_created_by",
];

const MEETING_PROPERTIES = [
  "hs_meeting_title", "hs_meeting_body", "hs_meeting_start_time",
  "hs_meeting_end_time", "hs_timestamp", "hs_attendee_owner_ids",
  "hs_meeting_location", "hs_meeting_outcome",
];

const TASK_PROPERTIES = [
  "hs_task_subject", "hs_task_body", "hs_task_status",
  "hs_timestamp", "hs_task_priority", "hs_task_type",
];

// ---------------------------------------------------------------------------
// Fetch associations + batch-read
// ---------------------------------------------------------------------------

async function fetchAssociatedObjects<T>(
  fromId: string,
  toObjectType: string,
  properties: string[],
  mapper: (obj: Record<string, string | null>, id: string) => T,
  fromObjectType: string = "deals",
): Promise<T[]> {
  try {
    // Step 1: Get association IDs (with rate-limit retry)
    const assocResponse = await withHubSpotRetry(
      `associations:${fromObjectType}->${toObjectType}`,
      () => hubspotClient.crm.associations.batchApi.read(
        fromObjectType,
        toObjectType,
        { inputs: [{ id: fromId }] },
      ),
    );
    const ids = (assocResponse.results?.[0]?.to ?? []).map((a) => a.id);
    if (ids.length === 0) return [];

    // Step 2: Batch-read objects (with rate-limit retry)
    const batchResponse = await withHubSpotRetry(
      `batch-read:${toObjectType}`,
      () => hubspotClient.crm.objects.batchApi.read(
        toObjectType,
        { inputs: ids.map((id) => ({ id })), properties, propertiesWithHistory: [] },
      ),
    );

    return batchResponse.results.map((obj) =>
      mapper(obj.properties as Record<string, string | null>, obj.id),
    );
  } catch (err) {
    console.warn(`[hubspot-engagements] Failed to fetch ${toObjectType} for ${fromObjectType} ${fromId}:`, err);

    // Classify the error:
    //   4xx (except 429) → config/permissions issue (revoked scope, wrong ID,
    //     deleted object). Silent [] is wrong — it masks production bugs like
    //     the 2026-04-16 missing-email-scope incident. Send to Sentry.
    //   429 / 5xx / network → transient. Keep existing silent fallback so we
    //     don't spam Sentry when HubSpot has a rough minute.
    const status = (err as { code?: number; statusCode?: number })?.code
      ?? (err as { code?: number; statusCode?: number })?.statusCode;
    const isAlertableClientError =
      typeof status === "number" && status >= 400 && status < 500 && status !== 429;
    if (isAlertableClientError) {
      Sentry.captureException(err, {
        tags: {
          module: "hubspot-engagements",
          status,
          fromObjectType,
          toObjectType,
        },
      });
    }

    return [];
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapEmail(p: Record<string, string | null>, id: string): Engagement {
  return {
    id: `email-${id}`,
    type: "email",
    timestamp: p.hs_timestamp ?? new Date(0).toISOString(),
    subject: p.hs_email_subject ?? null,
    body: p.hs_email_text ?? null,
    from: p.hs_email_from_email ?? null,
    to: p.hs_email_to_email ? p.hs_email_to_email.split(";").map((s) => s.trim()) : null,
    duration: null,
    disposition: null,
    attendees: null,
    createdBy: null,
    direction: p.hs_email_direction ?? null,
    cc: p.hs_email_cc_email ? p.hs_email_cc_email.split(";").map((s) => s.trim()) : null,
    bcc: p.hs_email_bcc_email ? p.hs_email_bcc_email.split(";").map((s) => s.trim()) : null,
    emailStatus: p.hs_email_status ?? null,
    recordingUrl: null,
    priority: null,
    taskType: null,
    meetingEndTime: null,
    meetingLocation: null,
    meetingOutcome: null,
  };
}

function mapCall(p: Record<string, string | null>, id: string): Engagement {
  return {
    id: `call-${id}`,
    type: "call",
    timestamp: p.hs_timestamp ?? new Date(0).toISOString(),
    subject: p.hs_call_title ?? null,
    body: p.hs_call_body ?? null,
    from: p.hs_call_from_number ?? null,
    to: p.hs_call_to_number ? [p.hs_call_to_number] : null,
    duration: p.hs_call_duration ? parseInt(p.hs_call_duration, 10) : null,
    disposition: p.hs_call_disposition ?? null,
    attendees: null,
    createdBy: null,
    direction: null,
    cc: null,
    bcc: null,
    emailStatus: null,
    recordingUrl: p.hs_call_recording_url ?? null,
    priority: null,
    taskType: null,
    meetingEndTime: null,
    meetingLocation: null,
    meetingOutcome: null,
  };
}

function mapNote(p: Record<string, string | null>, id: string): Engagement {
  return {
    id: `hsnote-${id}`,
    type: "note",
    timestamp: p.hs_timestamp ?? new Date(0).toISOString(),
    subject: null,
    body: p.hs_note_body ?? null,
    from: null,
    to: null,
    duration: null,
    disposition: null,
    attendees: null,
    createdBy: p.hs_created_by ?? null,
    direction: null,
    cc: null,
    bcc: null,
    emailStatus: null,
    recordingUrl: null,
    priority: null,
    taskType: null,
    meetingEndTime: null,
    meetingLocation: null,
    meetingOutcome: null,
  };
}

function mapMeeting(p: Record<string, string | null>, id: string): Engagement {
  const startMs = p.hs_meeting_start_time ? new Date(p.hs_meeting_start_time).getTime() : 0;
  const endMs = p.hs_meeting_end_time ? new Date(p.hs_meeting_end_time).getTime() : 0;
  const dur = startMs && endMs && endMs > startMs ? endMs - startMs : null;
  return {
    id: `meeting-${id}`,
    type: "meeting",
    timestamp: p.hs_meeting_start_time ?? p.hs_timestamp ?? new Date(0).toISOString(),
    subject: p.hs_meeting_title ?? null,
    body: p.hs_meeting_body ?? null,
    from: null,
    to: null,
    duration: dur,
    disposition: null,
    attendees: p.hs_attendee_owner_ids
      ? p.hs_attendee_owner_ids.split(";").map((s) => s.trim())
      : null,
    createdBy: null,
    direction: null,
    cc: null,
    bcc: null,
    emailStatus: null,
    recordingUrl: null,
    priority: null,
    taskType: null,
    meetingEndTime: p.hs_meeting_end_time ?? null,
    meetingLocation: p.hs_meeting_location ?? null,
    meetingOutcome: p.hs_meeting_outcome ?? null,
  };
}

function mapTask(p: Record<string, string | null>, id: string): Engagement {
  return {
    id: `task-${id}`,
    type: "task",
    timestamp: p.hs_timestamp ?? new Date(0).toISOString(),
    subject: p.hs_task_subject ?? null,
    body: p.hs_task_body ?? null,
    from: null,
    to: null,
    duration: null,
    disposition: p.hs_task_status ?? null,
    attendees: null,
    createdBy: null,
    direction: null,
    cc: null,
    bcc: null,
    emailStatus: null,
    recordingUrl: null,
    priority: p.hs_task_priority ?? null,
    taskType: p.hs_task_type ?? null,
    meetingEndTime: null,
    meetingLocation: null,
    meetingOutcome: null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch associated object IDs without materializing the target objects.
 * Used to walk object → contacts so we can expand the engagement fetch.
 */
export async function fetchAssociatedIds(
  fromId: string,
  toObjectType: string,
  fromObjectType: string = "deals",
): Promise<string[]> {
  try {
    const res = await withHubSpotRetry(
      `associations:${fromObjectType}->${toObjectType}`,
      () => hubspotClient.crm.associations.batchApi.read(
        fromObjectType,
        toObjectType,
        { inputs: [{ id: fromId }] },
      ),
    );
    return (res.results?.[0]?.to ?? []).map((a) => a.id);
  } catch (err) {
    console.warn(`[hubspot-engagements] Failed to fetch ${toObjectType} IDs for ${fromObjectType} ${fromId}:`, err);
    return [];
  }
}

/**
 * Generic engagement fetcher for any HubSpot object type.
 *
 * Phase 1: fetch emails, calls, notes, meetings, tasks directly associated
 * with the object (parallel).
 *
 * Phase 2 (if expandContacts): also pull emails/calls/meetings from each
 * associated contact and dedupe by engagement ID. Notes and tasks stay
 * object-direct — contact notes often reference unrelated records for the
 * same customer and shouldn't leak into an object-scoped timeline.
 *
 * HubSpot's Gmail extension commonly only associates emails to contacts
 * (not deals or tickets), so the object-only view under-reports
 * communications without contact expansion.
 */
export async function getObjectEngagements(
  objectId: string,
  objectType: string,
  options?: { expandContacts?: boolean },
): Promise<Engagement[]> {
  const expand = options?.expandContacts !== false;

  const [emails, calls, notes, meetings, tasks, contactIds] = await Promise.all([
    fetchAssociatedObjects(objectId, "emails", EMAIL_PROPERTIES, mapEmail, objectType),
    fetchAssociatedObjects(objectId, "calls", CALL_PROPERTIES, mapCall, objectType),
    fetchAssociatedObjects(objectId, "notes", NOTE_PROPERTIES, mapNote, objectType),
    fetchAssociatedObjects(objectId, "meetings", MEETING_PROPERTIES, mapMeeting, objectType),
    fetchAssociatedObjects(objectId, "tasks", TASK_PROPERTIES, mapTask, objectType),
    expand ? fetchAssociatedIds(objectId, "contacts", objectType) : Promise.resolve([]),
  ]);

  const contactEngagements = expand
    ? (
        await Promise.all(
          contactIds.flatMap((contactId) => [
            fetchAssociatedObjects(contactId, "emails", EMAIL_PROPERTIES, mapEmail, "contacts"),
            fetchAssociatedObjects(contactId, "calls", CALL_PROPERTIES, mapCall, "contacts"),
            fetchAssociatedObjects(contactId, "meetings", MEETING_PROPERTIES, mapMeeting, "contacts"),
          ]),
        )
      ).flat()
    : [];

  const merged = [
    ...emails, ...calls, ...notes, ...meetings, ...tasks,
    ...contactEngagements,
  ];
  const seen = new Set<string>();
  const deduped: Engagement[] = [];
  for (const eng of merged) {
    if (seen.has(eng.id)) continue;
    seen.add(eng.id);
    deduped.push(eng);
  }

  return deduped.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

/**
 * Fetch all HubSpot engagements for a deal. Cached wrapper around
 * getObjectEngagements("deals", ...) with contact expansion.
 */
export async function getDealEngagements(
  hubspotDealId: string,
  all = false,
): Promise<Engagement[]> {
  const cacheKey = all
    ? CACHE_KEYS.DEAL_ENGAGEMENTS_ALL(hubspotDealId)
    : CACHE_KEYS.DEAL_ENGAGEMENTS_RECENT(hubspotDealId);

  const result = await appCache.getOrFetch(cacheKey, () =>
    getObjectEngagements(hubspotDealId, "deals", { expandContacts: true }),
  );

  return result.data;
}

/**
 * Fetch HubSpot tasks only for a deal. Tasks are operational todos, not
 * communications, so they surface in the Activity feed (not Communications).
 * Cached 5 minutes under deal-tasks:{hubspotDealId}:{mode}.
 */
export async function getDealTasks(
  hubspotDealId: string,
  all = false,
): Promise<Engagement[]> {
  const cacheKey = all
    ? CACHE_KEYS.DEAL_TASKS_ALL(hubspotDealId)
    : CACHE_KEYS.DEAL_TASKS_RECENT(hubspotDealId);

  const result = await appCache.getOrFetch(cacheKey, async () =>
    fetchAssociatedObjects(hubspotDealId, "tasks", TASK_PROPERTIES, mapTask),
  );

  return result.data;
}

/**
 * Fetch the most recent engagement (email / call / note / meeting) for a
 * contact. Used by the Customer History slide-over to show a "last
 * communication" preview. Returns null if the contact has no engagements.
 *
 * Not cached at the module level — the caller (resolveContactDetail) already
 * sits behind the customer-detail 5-min cache, so caching here would be
 * redundant.
 */
export async function getContactLatestEngagement(
  contactId: string,
): Promise<Engagement | null> {
  const [emails, calls, notes, meetings] = await Promise.all([
    fetchAssociatedObjects(contactId, "emails", EMAIL_PROPERTIES, mapEmail, "contacts"),
    fetchAssociatedObjects(contactId, "calls", CALL_PROPERTIES, mapCall, "contacts"),
    fetchAssociatedObjects(contactId, "notes", NOTE_PROPERTIES, mapNote, "contacts"),
    fetchAssociatedObjects(contactId, "meetings", MEETING_PROPERTIES, mapMeeting, "contacts"),
  ]);

  const all = [...emails, ...calls, ...notes, ...meetings];
  if (all.length === 0) return null;

  all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return all[0];
}

/**
 * Create a note on a HubSpot deal timeline.
 * Unlike `createDealTimelineNote()` in idr-meeting.ts, this does NOT add @mentions.
 *
 * @param hubspotDealId - The HubSpot deal ID (numeric string)
 * @param noteBody - The note content (plain text or HTML)
 */
export async function createDealNote(
  hubspotDealId: string,
  noteBody: string,
): Promise<void> {
  await hubspotClient.crm.objects.notes.basicApi.create({
    properties: {
      hs_note_body: noteBody,
      hs_timestamp: new Date().toISOString(),
    },
    associations: [
      {
        to: { id: hubspotDealId },
        types: [
          {
            associationCategory: AssociationSpecAssociationCategoryEnum.HubspotDefined,
            associationTypeId: 214, // note-to-deal
          },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Owner ID → Name resolution
// ---------------------------------------------------------------------------

/**
 * Fetch all HubSpot owners and build an id→name map. Cached in appCache.
 * Also indexes by email so note createdBy (which is an email) resolves.
 */
export async function getOwnerIdToNameMap(): Promise<Map<string, string>> {
  const cacheKey = "hubspot-owner-map";
  const cached = appCache.get<Map<string, string>>(cacheKey);
  if (cached.data && !cached.stale) return cached.data;

  const map = new Map<string, string>();
  try {
    const res = await withHubSpotRetry("owners:getPage", () =>
      hubspotClient.crm.owners.ownersApi.getPage(undefined, undefined, 500, false),
    );
    for (const owner of res.results ?? []) {
      const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.email || owner.id;
      map.set(owner.id, name);
      if (owner.email) map.set(owner.email, name);
    }
    // Also fetch archived owners for historical resolution
    const archived = await withHubSpotRetry("owners:getPage:archived", () =>
      hubspotClient.crm.owners.ownersApi.getPage(undefined, undefined, 500, true),
    );
    for (const owner of archived.results ?? []) {
      const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.email || owner.id;
      if (!map.has(owner.id)) map.set(owner.id, name);
      if (owner.email && !map.has(owner.email)) map.set(owner.email, name);
    }
  } catch (err) {
    console.warn("[hubspot-engagements] Failed to fetch owners:", err);
  }
  appCache.set(cacheKey, map);
  return map;
}

/**
 * Resolve owner IDs / emails to human names in-place.
 * - note.createdBy (owner email or ID) → resolved name
 * - meeting.attendees (owner IDs) → resolved names
 */
export function resolveEngagementOwners(
  engagements: Engagement[],
  ownerMap: Map<string, string>,
): void {
  for (const eng of engagements) {
    if (eng.type === "note" && eng.createdBy) {
      const resolved = ownerMap.get(eng.createdBy);
      if (resolved) eng.createdBy = resolved;
    }
    if (eng.type === "meeting" && eng.attendees) {
      eng.attendees = eng.attendees.map((id) => ownerMap.get(id) ?? id);
    }
  }
}
