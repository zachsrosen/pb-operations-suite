/**
 * Deal Activity Timeline — aggregates events from 5 sources into a single
 * paginated feed with composite cursor (ts + id) pagination.
 */
import { prisma } from "@/lib/db";
import { zuper } from "@/lib/zuper";
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

// ---------------------------------------------------------------------------
// Source fetchers → TimelineEvent[]
// ---------------------------------------------------------------------------

async function fetchNoteEvents(
  dealId: string,
  windowStart: Date | null,
  cursor: Cursor | null,
): Promise<TimelineEvent[]> {
  const where: Record<string, unknown> = { dealId };
  const andConditions: Record<string, unknown>[] = [];

  if (windowStart) {
    andConditions.push({ createdAt: { gte: windowStart } });
  }
  if (cursor) {
    andConditions.push({
      OR: [
        { createdAt: { lt: new Date(cursor.ts) } },
        { createdAt: new Date(cursor.ts), id: { lt: cursor.id } },
      ],
    });
  }
  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  const notes = await prisma.dealNote.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE,
  });

  return notes.map((n) => ({
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
  }));
}

async function fetchSyncEvents(
  dealId: string,
  windowStart: Date | null,
  cursor: Cursor | null,
): Promise<TimelineEvent[]> {
  const where: Record<string, unknown> = {
    dealId,
    status: { not: "SKIPPED" },
  };
  const andConditions: Record<string, unknown>[] = [];

  if (windowStart) {
    andConditions.push({ createdAt: { gte: windowStart } });
  }
  if (cursor) {
    andConditions.push({
      OR: [
        { createdAt: { lt: new Date(cursor.ts) } },
        { createdAt: new Date(cursor.ts), id: { lt: cursor.id } },
      ],
    });
  }
  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  const logs = await prisma.dealSyncLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE,
  });

  return logs.map((log) => {
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

  return jobs
    .map((job) => {
      const ts = job.scheduledStart?.toISOString()
        ?? job.lastSyncedAt.toISOString();
      const eventId = `zuper-${job.jobUid}`;
      return {
        id: eventId,
        type: "zuper" as const,
        timestamp: ts,
        title: `${job.jobCategory} — ${job.jobStatus}`,
        detail: job.jobTitle,
        author: null,
        metadata: {
          jobUid: job.jobUid,
          jobStatus: job.jobStatus,
          scheduledStart: job.scheduledStart?.toISOString() ?? null,
          scheduledEnd: job.scheduledEnd?.toISOString() ?? null,
          assignedUsers: job.assignedUsers,
        },
      };
    })
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
        const photos = await zuper.getJobPhotos(job.jobUid);
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
    .filter((e) => !cursor || isBeforeCursor(e.timestamp, e.id, cursor));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a paginated timeline for a deal, aggregating 5 sources.
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

  // Fan-out: all 5 sources in parallel
  const [noteEvents, syncEvents, zuperEvents, photoEvents, engagements] =
    await Promise.all([
      fetchNoteEvents(dealId, windowStart, cursor),
      fetchSyncEvents(dealId, windowStart, cursor),
      fetchZuperEvents(hubspotDealId, windowStart, cursor),
      fetchPhotoEvents(hubspotDealId, windowStart, cursor),
      getDealEngagements(hubspotDealId, options.all ?? false),
    ]);

  const engagementEvents = engagementToTimelineEvents(engagements, windowStart, cursor);

  // Merge, sort by (timestamp DESC, id DESC), paginate
  const allEvents = [
    ...noteEvents,
    ...syncEvents,
    ...zuperEvents,
    ...photoEvents,
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
