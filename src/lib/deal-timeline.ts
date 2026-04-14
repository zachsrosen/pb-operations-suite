/**
 * Deal Activity Timeline — aggregates events from 5 sources into a single
 * paginated feed with composite cursor (ts + id) pagination.
 */
import { prisma } from "@/lib/db";
import { zuper } from "@/lib/zuper";
import { appCache } from "@/lib/cache";
import { getDealEngagements } from "@/lib/hubspot-engagements";
import type {
  TimelineEvent,
  TimelinePage,
  Engagement,
} from "@/components/deal-detail/types";

const PAGE_SIZE = 50;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

interface Cursor {
  ts: string; // ISO timestamp
  id: string;
}

/** Returns true if event is "before" the cursor (should be included in this page). */
function isBeforeCursor(
  eventTs: string,
  eventId: string,
  cursor: Cursor,
): boolean {
  const eventTime = new Date(eventTs).getTime();
  const cursorTime = new Date(cursor.ts).getTime();
  if (eventTime < cursorTime) return true;
  if (eventTime === cursorTime) return eventId < cursor.id;
  return false;
}

/** Returns true if event timestamp is within the time window. */
function isInWindow(eventTs: string, windowStart: Date | null): boolean {
  if (!windowStart) return true; // all=true
  return new Date(eventTs).getTime() >= windowStart.getTime();
}

/**
 * Build a Prisma WHERE clause for cursor pagination on DB-backed sources.
 *
 * Same-source cursor (prefix matches): push the full compound comparison
 * (timestamp, rawId) to the DB for exact boundary handling.
 *
 * Cross-source cursor (prefix doesn't match): use `createdAt <= cursor.ts`
 * to fetch the overlap band at the cursor timestamp. The caller then applies
 * `isBeforeCursor()` in-memory using the prefixed event IDs — the same
 * comparison all snapshot sources use — so equal-timestamp events from
 * different sources are ordered correctly and never skipped.
 */
// ---------------------------------------------------------------------------
// DB-backed source pagination
// ---------------------------------------------------------------------------

/**
 * Generic paginated fetch for DB-backed timeline sources.
 *
 * Cursor strategy:
 *  - Same-source cursor (prefix matches): push the full compound
 *    (timestamp, rawId) comparison to the DB. Exact and efficient.
 *  - Cross-source cursor (prefix doesn't match): split into two queries:
 *    1. Overlap band: `createdAt = cursor.ts`, no LIMIT — small cardinality,
 *       filtered in-memory via `isBeforeCursor()` using prefixed IDs.
 *    2. Older rows: `createdAt < cursor.ts`, LIMIT PAGE_SIZE.
 *    This avoids the starvation problem where many same-timestamp rows
 *    fill the LIMIT and crowd out older eligible rows.
 */
async function fetchDbEvents<T extends { createdAt: Date; id: string }>(opts: {
  baseWhere: Record<string, unknown>;
  windowStart: Date | null;
  cursor: Cursor | null;
  prefix: string;
  findMany: (args: { where: Record<string, unknown>; orderBy: ({ createdAt: "desc" } | { id: "desc" })[]; take?: number }) => Promise<T[]>;
  toEvent: (row: T) => TimelineEvent;
}): Promise<TimelineEvent[]> {
  const { baseWhere, windowStart, cursor, prefix, findMany, toEvent } = opts;
  const isSameSource = cursor?.id.startsWith(`${prefix}-`);

  // --- Same-source cursor: single efficient query ---
  if (!cursor || isSameSource) {
    const andConditions: Record<string, unknown>[] = [];
    if (windowStart) andConditions.push({ createdAt: { gte: windowStart } });
    if (cursor && isSameSource) {
      const rawId = cursor.id.slice(prefix.length + 1);
      andConditions.push({
        OR: [
          { createdAt: { lt: new Date(cursor.ts) } },
          { createdAt: new Date(cursor.ts), id: { lt: rawId } },
        ],
      });
    }
    const where = andConditions.length > 0
      ? { ...baseWhere, AND: andConditions }
      : { ...baseWhere };

    const rows = await findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE,
    });
    return rows.map(toEvent);
  }

  // --- Cross-source cursor: split into overlap band + older rows ---
  const cursorTime = new Date(cursor.ts);
  const windowCondition = windowStart ? [{ createdAt: { gte: windowStart } }] : [];

  // 1. Overlap band at cursor timestamp (no LIMIT — bounded by cardinality)
  const overlapRows = await findMany({
    where: { ...baseWhere, AND: [...windowCondition, { createdAt: cursorTime }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const overlapEvents = overlapRows
    .map(toEvent)
    .filter((e) => isBeforeCursor(e.timestamp, e.id, cursor));

  // 2. Older rows strictly before cursor timestamp
  const olderRows = await findMany({
    where: { ...baseWhere, AND: [...windowCondition, { createdAt: { lt: cursorTime } }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE,
  });
  const olderEvents = olderRows.map(toEvent);

  return [...overlapEvents, ...olderEvents];
}

// ---------------------------------------------------------------------------
// Zuper status history parser (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse Zuper job_status array from rawData into timeline events.
 * Exported for testing.
 */
export function parseZuperStatusHistory(
  jobUid: string,
  jobCategory: string,
  rawData: unknown,
): TimelineEvent[] {
  if (!rawData || typeof rawData !== "object") return [];
  const data = rawData as Record<string, unknown>;
  if (!Array.isArray(data.job_status)) return [];

  const events: TimelineEvent[] = [];
  for (const entry of data.job_status) {
    const rec = entry as Record<string, unknown>;
    const statusName = String(rec?.status_name ?? "Unknown");
    const ts = rec?.created_at as string | undefined;
    if (!ts) continue;
    // Stable ID: derived from payload data, not array index.
    const tsSlug = ts.replace(/[^0-9]/g, "").slice(0, 14);
    events.push({
      id: `zstatus-${jobUid}-${tsSlug}-${statusName}`,
      type: "zuper_status",
      timestamp: ts,
      title: `${jobCategory} — ${statusName}`,
      detail: null,
      author: null,
      metadata: { jobUid, statusName },
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Generic DB-backed source fetcher
// ---------------------------------------------------------------------------

/**
 * Generic helper for DB-backed timeline sources. Handles window filtering,
 * cursor pagination via buildCursorWhere, and cross-source cursor filtering.
 */
async function fetchDbEvents<T extends { createdAt: Date; id: string }>(opts: {
  baseWhere: Record<string, unknown>;
  windowStart: Date | null;
  cursor: Cursor | null;
  prefix: string;
  findMany: (args: { where: Record<string, unknown>; orderBy: { createdAt: "desc" }[]; take: number }) => Promise<T[]>;
  toEvent: (row: T) => TimelineEvent;
}): Promise<TimelineEvent[]> {
  const { baseWhere, windowStart, cursor, prefix, findMany, toEvent } = opts;

  const where: Record<string, unknown> = { ...baseWhere };
  const andConditions: Record<string, unknown>[] = [];

  if (windowStart) {
    andConditions.push({ createdAt: { gte: windowStart } });
  }
  if (cursor) {
    andConditions.push(buildCursorWhere(cursor.id, cursor.ts, prefix));
  }
  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  const rows = await findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: PAGE_SIZE,
  });

  const events = rows.map(toEvent);

  // For cross-source cursors the DB fetched the overlap band (<=).
  // Apply the unified isBeforeCursor filter using prefixed IDs.
  if (cursor && !cursor.id.startsWith(`${prefix}-`)) {
    return events.filter((e) => isBeforeCursor(e.timestamp, e.id, cursor));
  }
  return events;
}

// ---------------------------------------------------------------------------
// Source fetchers → TimelineEvent[]
// ---------------------------------------------------------------------------

async function fetchNoteEvents(
  dealId: string,
  windowStart: Date | null,
  cursor: Cursor | null,
): Promise<TimelineEvent[]> {
  return fetchDbEvents({
    baseWhere: { dealId },
    windowStart,
    cursor,
    prefix: "note",
    findMany: (args) => prisma.dealNote.findMany(args),
    toEvent: (n) => ({
      id: `note-${n.id}`,
      type: "note" as const,
      timestamp: n.createdAt.toISOString(),
      title: `Note by ${n.authorName}`,
      detail: n.content,
      author: n.authorName,
      metadata: {
        authorEmail: n.authorEmail,
        hubspotSyncStatus: n.hubspotSyncStatus,
        zuperSyncStatus: n.zuperSyncStatus,
      },
    }),
  });
}

async function fetchSyncEvents(
  dealId: string,
  windowStart: Date | null,
  cursor: Cursor | null,
): Promise<TimelineEvent[]> {
  return fetchDbEvents({
    baseWhere: { dealId, status: { not: "SKIPPED" } },
    windowStart,
    cursor,
    prefix: "sync",
    findMany: (args) => prisma.dealSyncLog.findMany(args),
    toEvent: (log) => {
      const changes = log.changesDetected as Record<string, [unknown, unknown]> | null;
      const fieldCount = changes ? Object.keys(changes).length : 0;
      const sourceLabel = log.source.replace(/^(batch|single):/, "");
      return {
        id: `sync-${log.id}`,
        type: "sync" as const,
        timestamp: log.createdAt.toISOString(),
        title: fieldCount > 0
          ? `${fieldCount} field${fieldCount === 1 ? "" : "s"} updated via ${sourceLabel}`
          : `Sync (${log.syncType.toLowerCase()}) — no changes`,
        detail: null,
        author: null,
        metadata: { changes, syncType: log.syncType, source: log.source },
      };
    },
  });
}

const BOM_STATUS_LABEL: Record<string, string> = {
  RUNNING: "started",
  SUCCEEDED: "completed",
  FAILED: "failed",
  PARTIAL: "partially completed",
};

async function fetchBomEvents(
  hubspotDealId: string,
  windowStart: Date | null,
  cursor: Cursor | null,
): Promise<TimelineEvent[]> {
  return fetchDbEvents({
    baseWhere: { dealId: hubspotDealId },
    windowStart,
    cursor,
    prefix: "bom",
    findMany: (args) => prisma.bomPipelineRun.findMany(args),
    toEvent: (run) => ({
      id: `bom-${run.id}`,
      type: "bom" as const,
      timestamp: run.createdAt.toISOString(),
      title: `BOM ${BOM_STATUS_LABEL[run.status] ?? run.status} — ${run.trigger.replace(/_/g, " ").toLowerCase()}`,
      detail: run.status === "FAILED" ? (run.errorMessage ?? run.failedStep ?? null) : null,
      author: null,
      metadata: {
        trigger: run.trigger,
        status: run.status,
        failedStep: run.failedStep,
        durationMs: run.durationMs,
        snapshotVersion: run.snapshotVersion,
      },
    }),
  });
}

const SCHEDULE_TYPE_LABEL: Record<string, string> = {
  survey: "Survey",
  construction: "Install",
  inspection: "Inspection",
};

async function fetchScheduleEvents(
  hubspotDealId: string,
  windowStart: Date | null,
  cursor: Cursor | null,
): Promise<TimelineEvent[]> {
  return fetchDbEvents({
    baseWhere: { projectId: hubspotDealId },
    windowStart,
    cursor,
    prefix: "sched",
    findMany: (args) => prisma.scheduleRecord.findMany(args),
    toEvent: (rec) => ({
      id: `sched-${rec.id}`,
      type: "schedule" as const,
      timestamp: rec.createdAt.toISOString(),
      title: `${SCHEDULE_TYPE_LABEL[rec.scheduleType] ?? rec.scheduleType} ${rec.status} — ${rec.scheduledDate}`,
      detail: rec.assignedUser ? `Assigned to ${rec.assignedUser}` : null,
      author: rec.scheduledBy ?? null,
      metadata: {
        scheduleType: rec.scheduleType,
        scheduledDate: rec.scheduledDate,
        status: rec.status,
        assignedUser: rec.assignedUser,
        zuperSynced: rec.zuperSynced,
      },
    }),
  });
}

async function fetchZuperEvents(
  hubspotDealId: string,
  windowStart: Date | null,
  cursor: Cursor | null,
): Promise<TimelineEvent[]> {
  const jobs = await prisma.zuperJobCache.findMany({
    where: { hubspotDealId },
  });

  const events = jobs.flatMap((job) =>
    parseZuperStatusHistory(job.jobUid, job.jobCategory, job.rawData),
  );

  return events
    .filter((e) => isInWindow(e.timestamp, windowStart))
    .filter((e) => !cursor || isBeforeCursor(e.timestamp, e.id, cursor));
}

async function fetchPhotoEvents(
  hubspotDealId: string,
  windowStart: Date | null,
  cursor: Cursor | null,
): Promise<TimelineEvent[]> {
  if (!zuper.isConfigured()) return [];

  const jobs = await prisma.zuperJobCache.findMany({
    where: { hubspotDealId },
    select: { jobUid: true, jobCategory: true, lastSyncedAt: true },
  });
  if (jobs.length === 0) return [];

  const photoArrays = await Promise.all(
    jobs.map(async (job) => {
      try {
        // Cache photos per deal+job for 5 minutes to avoid hammering Zuper
        // on every SSE-driven refetch and pagination request
        const cacheKey = `deal-photos:${hubspotDealId}:${job.jobUid}`;
        const cached = await appCache.getOrFetch(cacheKey, () =>
          zuper.getJobPhotos(job.jobUid),
        );
        const photos = cached.data;
        return photos.map((p) => {
          const ts = p.created_at ?? job.lastSyncedAt.toISOString();
          return {
            id: `photo-${p.attachment_uid}`,
            type: "photo" as const,
            timestamp: ts,
            title: `Photo from ${job.jobCategory}`,
            detail: p.file_name ?? null,
            author: null,
            metadata: {
              url: `/api/zuper/photos/${encodeURIComponent(job.jobUid)}/${encodeURIComponent(p.attachment_uid)}`,
              fileName: p.file_name,
              jobCategory: job.jobCategory,
            },
          };
        });
      } catch {
        return [];
      }
    }),
  );

  return photoArrays
    .flat()
    .filter((e) => isInWindow(e.timestamp, windowStart))
    .filter((e) => !cursor || isBeforeCursor(e.timestamp, e.id, cursor));
}

function engagementToTimelineEvents(
  engagements: Engagement[],
  windowStart: Date | null,
  cursor: Cursor | null,
): TimelineEvent[] {
  return engagements
    // Skip app-authored HubSpot notes — already represented by internal DealNote records
    .filter((eng) => !(eng.type === "note" && eng.body?.startsWith("<!-- pb-ops-note -->")))
    .map((eng): TimelineEvent => {
      const typeLabel = eng.type === "email" ? "Email"
        : eng.type === "call" ? "Call"
        : eng.type === "meeting" ? "Meeting"
        : "HubSpot Note";
      const titleParts: string[] = [typeLabel];
      if (eng.type === "email" && eng.subject) titleParts.push(`— ${eng.subject}`);
      if (eng.type === "call" && eng.disposition) titleParts.push(`— ${eng.disposition}`);
      if (eng.type === "meeting" && eng.subject) titleParts.push(`— ${eng.subject}`);

      return {
        id: eng.id,
        type: eng.type === "note" ? "hubspot_note" : eng.type,
        timestamp: eng.timestamp,
        title: titleParts.join(" "),
        detail: eng.body,
        author: eng.from ?? eng.createdBy ?? null,
        metadata: {
          to: eng.to,
          duration: eng.duration,
          attendees: eng.attendees,
        },
      };
    })
    .filter((e) => isInWindow(e.timestamp, windowStart))
    .filter((e) => !cursor || isBeforeCursor(e.timestamp, e.id, cursor))
    .filter((eng) => !(eng.type === "hubspot_note" && eng.detail?.startsWith("<!-- pb-ops-note -->")));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a paginated timeline for a deal, aggregating 7 sources.
 *
 * @param dealId      Internal Deal cuid
 * @param hubspotDealId HubSpot deal ID (numeric string)
 * @param options     Pagination and window options
 */
export async function getDealTimeline(
  dealId: string,
  hubspotDealId: string,
  options: { all?: boolean; cursorTs?: string; cursorId?: string } = {},
): Promise<TimelinePage> {
  const windowStart = options.all
    ? null
    : new Date(Date.now() - NINETY_DAYS_MS);

  const cursor: Cursor | null =
    options.cursorTs && options.cursorId
      ? { ts: options.cursorTs, id: options.cursorId }
      : null;

  // Fan-out: all 7 sources in parallel
  const [noteEvents, syncEvents, zuperEvents, photoEvents, bomEvents, scheduleEvents, engagements] =
    await Promise.all([
      fetchNoteEvents(dealId, windowStart, cursor),
      fetchSyncEvents(dealId, windowStart, cursor),
      fetchZuperEvents(hubspotDealId, windowStart, cursor),
      fetchPhotoEvents(hubspotDealId, windowStart, cursor),
      fetchBomEvents(hubspotDealId, windowStart, cursor),
      fetchScheduleEvents(hubspotDealId, windowStart, cursor),
      getDealEngagements(hubspotDealId, options.all ?? false),
    ]);

  const engagementEvents = engagementToTimelineEvents(engagements, windowStart, cursor);

  // Merge, sort by (timestamp DESC, id DESC), paginate
  const allEvents = [
    ...noteEvents,
    ...syncEvents,
    ...zuperEvents,
    ...photoEvents,
    ...bomEvents,
    ...scheduleEvents,
    ...engagementEvents,
  ].sort((a, b) => {
    const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    if (timeDiff !== 0) return timeDiff;
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });

  const page = allEvents.slice(0, PAGE_SIZE);
  const nextCursor: TimelinePage["nextCursor"] =
    page.length === PAGE_SIZE
      ? { ts: page[PAGE_SIZE - 1].timestamp, id: page[PAGE_SIZE - 1].id }
      : null;

  return { events: page, nextCursor };
}
