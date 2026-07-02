/**
 * Zuper field-activity sync — turns per-job status-change history (which is only
 * in the job *detail* response) into per-employee `ExternalActivity` rows the
 * team-activity report can read cheaply.
 *
 * Each job's `job_status[]` timeline entry carries `done_by { email }` + a
 * timestamp — i.e. who moved the job to Scheduled/Started/Completed and when.
 * We keep only real PB employees (drop Zuper's `integration@zuper.co` system
 * actor). Idempotent on the entry's `status_history_uid`.
 *
 * The sync is bounded: it refreshes details for jobs active in a recent window,
 * capped per run, so it respects Zuper's rate limits.
 */

import { prisma } from "@/lib/db";
import { zuper } from "@/lib/zuper";

const SYSTEM_ACTORS = new Set(["integration@zuper.co"]);

interface TimelineEntry {
  status_history_uid?: string;
  status_name?: string;
  created_at?: string;
  updated_at?: string;
  status_time?: string;
  done_by?: { email?: string; first_name?: string; last_name?: string };
}

export interface ExternalActivityRow {
  source: string;
  sourceEventId: string;
  userEmail: string;
  userName: string | null;
  occurredAt: Date;
  kind: string;
  label: string | null;
  dealId: string | null;
}

/** Pull employee-attributed status changes out of one Zuper job detail. */
export function extractZuperActivity(job: {
  jobUid: string;
  jobTitle?: string | null;
  hubspotDealId?: string | null;
  job_status?: unknown;
}): ExternalActivityRow[] {
  const timeline = Array.isArray(job.job_status) ? (job.job_status as TimelineEntry[]) : [];
  const rows: ExternalActivityRow[] = [];
  for (const e of timeline) {
    const email = e.done_by?.email?.trim().toLowerCase();
    if (!email || SYSTEM_ACTORS.has(email)) continue;
    const tsRaw = e.created_at ?? e.updated_at ?? e.status_time;
    const occurredAt = tsRaw ? new Date(tsRaw) : null;
    if (!occurredAt || isNaN(+occurredAt)) continue;
    // Idempotency: prefer the status_history_uid; fall back to a composite key.
    const sourceEventId = e.status_history_uid ?? `${job.jobUid}:${e.status_name}:${occurredAt.toISOString()}`;
    const name = [e.done_by?.first_name, e.done_by?.last_name].filter(Boolean).join(" ") || null;
    rows.push({
      source: "zuper",
      sourceEventId,
      userEmail: email,
      userName: name,
      occurredAt,
      kind: `job ${e.status_name ?? "status change"}`,
      label: job.jobTitle ?? null,
      dealId: job.hubspotDealId ?? null,
    });
  }
  return rows;
}

async function upsertRows(rows: ExternalActivityRow[]): Promise<number> {
  let written = 0;
  for (const r of rows) {
    await prisma.externalActivity.upsert({
      where: { source_sourceEventId: { source: r.source, sourceEventId: r.sourceEventId } },
      create: r,
      update: { userEmail: r.userEmail, userName: r.userName, kind: r.kind, label: r.label, dealId: r.dealId },
    });
    written++;
  }
  return written;
}

const CURSOR_KEY = "zuper_field_activity_cursor"; // jobUid we stopped at last run

/**
 * Refresh a bounded batch of jobs' field activity. Walks jobs active in the
 * recent window ordered by scheduledStart, resuming from a stored cursor so
 * successive runs cover the whole window without re-fetching everything at once.
 */
export async function syncZuperFieldActivity(opts?: { cap?: number; windowDays?: number }): Promise<{
  jobsProcessed: number;
  activitiesWritten: number;
  errors: number;
  cursorReset: boolean;
}> {
  const cap = opts?.cap ?? 150;
  const windowDays = opts?.windowDays ?? 90;
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const cursorRow = await prisma.systemConfig.findUnique({ where: { key: CURSOR_KEY } }).catch(() => null);
  const cursor = cursorRow?.value ?? "";

  // Active window: recently scheduled or completed jobs (bounded set).
  const candidates = await prisma.zuperJobCache.findMany({
    where: {
      OR: [{ scheduledStart: { gte: since } }, { completedDate: { gte: since } }],
      jobUid: { gt: cursor },
    },
    select: { jobUid: true, jobTitle: true, hubspotDealId: true },
    orderBy: { jobUid: "asc" },
    take: cap,
  });

  let jobsProcessed = 0;
  let activitiesWritten = 0;
  let errors = 0;
  let lastUid = cursor;

  for (const c of candidates) {
    try {
      const res = await zuper.getJob(c.jobUid, "zuper-field-activity-sync");
      if (res.type === "success" && res.data) {
        const rows = extractZuperActivity({
          jobUid: c.jobUid,
          jobTitle: c.jobTitle,
          hubspotDealId: c.hubspotDealId,
          job_status: (res.data as { job_status?: unknown }).job_status,
        });
        activitiesWritten += await upsertRows(rows);
      }
      jobsProcessed++;
      lastUid = c.jobUid;
    } catch {
      errors++;
    }
  }

  // Advance cursor; reset to start once we've walked past the window's tail.
  const cursorReset = candidates.length < cap;
  const nextCursor = cursorReset ? "" : lastUid;
  await prisma.systemConfig.upsert({
    where: { key: CURSOR_KEY },
    create: { key: CURSOR_KEY, value: nextCursor },
    update: { value: nextCursor },
  });

  return { jobsProcessed, activitiesWritten, errors, cursorReset };
}
