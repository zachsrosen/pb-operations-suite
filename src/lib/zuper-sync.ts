/**
 * Zuper Job Cache Sync
 *
 * Fetches all Zuper jobs (paginated) and upserts them into the
 * ZuperJobCache table so downstream features (service priority queue,
 * customer history, enrichment) can query locally without hitting the
 * Zuper API on every request.
 */

import { zuper, type ZuperJob, type ZuperJobCategory } from "@/lib/zuper";
import { cacheZuperJob, prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Helpers (exported so the webhook handler can reuse them for single-job upserts)
// ---------------------------------------------------------------------------

/**
 * Normalise whatever is stored in Zuper's "HubSpot Deal ID" custom field
 * into a raw numeric deal ID. About 15% of historical rows hold the full
 * HubSpot record URL (`https://app.hubspot.com/contacts/.../record/0-3/12345`)
 * instead of just the ID, which breaks joins against HubSpot deal data.
 * Accepts either shape and returns just the numeric ID.
 */
export function normalizeHubspotDealIdValue(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Already a raw numeric ID — use as-is.
  if (/^\d+$/.test(trimmed)) return trimmed;

  // Full HubSpot record URL — pull the numeric ID out of `/record/<type>/<id>`.
  const urlMatch = trimmed.match(/\/record\/[^/]+\/(\d+)/);
  if (urlMatch) return urlMatch[1];

  // Anything else with a trailing numeric segment — last resort.
  const tailMatch = trimmed.match(/(\d{5,})(?!.*\d)/);
  if (tailMatch) return tailMatch[1];

  return undefined;
}

/**
 * Extract the HubSpot deal ID from a Zuper job's custom fields or tags.
 *
 * Custom fields come back from Zuper GET as an array of objects:
 *   [{ label: "HubSpot Deal ID", value: "12345" }, ...]
 *
 * Tags may contain patterns like "hs:12345" or "deal:12345".
 */
export function extractHubspotDealId(job: ZuperJob): string | undefined {
  // 1. Check custom_fields array
  if (Array.isArray(job.custom_fields)) {
    for (const field of job.custom_fields) {
      const label = (field.label ?? field.field_label ?? "").toLowerCase();
      if (label.includes("hubspot") || label.includes("deal_id") || label.includes("deal id")) {
        const val = field.value ?? field.field_value;
        if (val !== undefined && val !== null) {
          const normalized = normalizeHubspotDealIdValue(String(val));
          if (normalized) return normalized;
        }
      }
    }
  }

  // 2. Check tags for patterns like "hs:12345" or "deal:12345"
  if (Array.isArray(job.job_tags)) {
    for (const tag of job.job_tags) {
      const match = String(tag).match(/^(?:hs|deal)[:\-](\d+)$/i);
      if (match) return match[1];
    }
  }

  return undefined;
}

/**
 * Normalise the job_category field which may be a UID string or a
 * `{ category_name }` object from Zuper GET responses.
 */
export function resolveCategory(cat: ZuperJob["job_category"]): string {
  if (!cat) return "Unknown";
  if (typeof cat === "string") return cat;
  return (cat as ZuperJobCategory).category_name || "Unknown";
}

/**
 * Normalise the current_job_status field which is typically an object
 * `{ status_name }` but may occasionally be a plain string.
 */
export function resolveStatus(job: ZuperJob): string {
  const s = job.current_job_status;
  if (!s) return job.status || "Unknown";
  if (typeof s === "string") return s;
  return s.status_name || "Unknown";
}

/**
 * Build the assignedUsers array expected by cacheZuperJob from Zuper's
 * polymorphic assigned_to field.
 *
 * @param userNameCache — optional UID→name map pre-loaded from Zuper /users
 *   API so POST-format entries (which lack first/last name) still get a
 *   human-readable name. Without this, downstream extractAssignedUsers()
 *   would either drop them or show a UID stub.
 */
export function resolveAssignedUsers(
  assignedTo: ZuperJob["assigned_to"],
  userNameCache?: Map<string, string>
): { user_uid: string; user_name?: string }[] | undefined {
  if (!Array.isArray(assignedTo) || assignedTo.length === 0) return undefined;

  return assignedTo
    .flatMap((entry) => {
      // GET format: { user: { user_uid, first_name, last_name } }
      if ("user" in entry && entry.user) {
        const u = entry.user as { user_uid?: string; first_name?: string; last_name?: string };
        const uid = u.user_uid || "";
        if (!uid) return [];
        return [{
          user_uid: uid,
          user_name: [u.first_name, u.last_name].filter(Boolean).join(" ") || userNameCache?.get(uid),
        }];
      }
      // POST/simple format: { user_uid, team_uid? }
      if ("user_uid" in entry) {
        const uid = (entry as { user_uid: string }).user_uid;
        if (!uid) return [];
        return [{ user_uid: uid, user_name: userNameCache?.get(uid) }];
      }
      return [];
    });
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

const PAGE_SIZE = 500;

export async function syncZuperServiceJobs(): Promise<{ synced: number; errors: number }> {
  if (!zuper.isConfigured()) {
    return { synced: 0, errors: 0 };
  }

  // Pre-load Zuper user names so POST-format assigned_to entries get human names
  let userNameCache: Map<string, string> | undefined;
  try {
    const usersResult = await zuper.getUsers();
    if (usersResult.type === "success" && usersResult.data) {
      userNameCache = new Map();
      for (const u of usersResult.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const user = u as any;
        const uid = user.user_uid;
        const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
        if (uid && name) userNameCache.set(uid, name);
      }
    }
  } catch {
    // Non-fatal — sync continues without name enrichment
  }

  let synced = 0;
  let errors = 0;
  let page = 1;
  let total = Infinity; // will be set from first response

  while ((synced + errors) < total) {
    const result = await zuper.searchJobs({ page, limit: PAGE_SIZE });

    if (result.type !== "success" || !result.data) {
      console.error("[ZuperSync] Failed to fetch page", page, result.error || result.message);
      break;
    }

    const { jobs, total: reportedTotal } = result.data;
    total = reportedTotal;

    if (!jobs || jobs.length === 0) break;

    for (const job of jobs) {
      try {
        const jobUid = job.job_uid;
        if (!jobUid) {
          errors++;
          continue;
        }

        const status = resolveStatus(job);

        // Determine completedDate: if the status looks completed, use
        // completed_time / completed_at or scheduled_end_time as fallback.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jobAny = job as any;
        let completedDate: Date | undefined;
        const statusUpper = status.toUpperCase();
        const isTerminal = statusUpper.includes("COMPLETED") ||
          statusUpper.includes("COMPLETE") ||
          statusUpper === "PASSED" ||
          statusUpper === "PARTIAL PASS" ||
          statusUpper === "FAILED";
        if (isTerminal) {
          const rawCompleted =
            jobAny.completed_time ??
            jobAny.completed_at ??
            job.scheduled_end_time;
          if (rawCompleted) {
            const d = new Date(rawCompleted as string);
            if (!isNaN(d.getTime())) completedDate = d;
          }
        }

        await cacheZuperJob({
          jobUid,
          jobTitle: job.job_title || "Untitled Job",
          jobCategory: resolveCategory(job.job_category),
          jobStatus: status,
          jobPriority: job.job_priority,
          scheduledStart: job.scheduled_start_time ? new Date(job.scheduled_start_time) : undefined,
          scheduledEnd: job.scheduled_end_time ? new Date(job.scheduled_end_time) : undefined,
          completedDate,
          assignedUsers: resolveAssignedUsers(job.assigned_to, userNameCache),
          customerAddress: job.customer_address ?? jobAny.job_location,
          hubspotDealId: extractHubspotDealId(job),
          projectName: job.job_title,
          jobTags: job.job_tags,
          jobNotes: job.job_notes,
          rawData: job,
        });

        synced++;
      } catch (err) {
        console.warn("[ZuperSync] Failed to cache job", job.job_uid, err);
        errors++;
      }
    }

    // Safety: stop if the page returned fewer than expected
    if (jobs.length === 0) break;

    page++;
  }

  console.log(`[ZuperSync] Complete — synced: ${synced}, errors: ${errors}, total reported: ${total === Infinity ? "unknown" : total}`);

  // -------------------------------------------------------------------------
  // Second pass: backfill assignedUsers from individual job GETs.
  //
  // The Zuper list API (/jobs) omits assigned_to, so newly synced jobs get
  // JSON-null for assignedUsers. Fetch the detail endpoint for jobs scheduled
  // in the next 30 days that are still missing crew data. Typically <50 jobs.
  // -------------------------------------------------------------------------
  if (prisma) {
    try {
      const cutoff = new Date(Date.now() + 30 * 86_400_000);
      const missingCrew = await prisma.$queryRaw<{ jobUid: string }[]>`
        SELECT "jobUid" FROM "ZuperJobCache"
        WHERE "scheduledStart" >= NOW() - INTERVAL '7 days'
          AND "scheduledStart" < ${cutoff}
          AND "assignedUsers" = 'null'::jsonb
          AND "jobStatus" NOT IN ('CANCELLED')
      `;

      let backfilled = 0;
      for (const { jobUid } of missingCrew) {
        try {
          const detail = await zuper.getJob(jobUid);
          if (detail.type !== "success" || !detail.data) continue;
          const job = detail.data;
          const users = resolveAssignedUsers(job.assigned_to, userNameCache);
          if (!users || users.length === 0) continue;

          await prisma.zuperJobCache.update({
            where: { jobUid },
            data: { assignedUsers: JSON.parse(JSON.stringify(users)) },
          });
          backfilled++;
        } catch {
          // Non-fatal — skip this job
        }
      }

      if (missingCrew.length > 0) {
        console.log(`[ZuperSync] Backfilled assignedUsers: ${backfilled}/${missingCrew.length} jobs`);
      }
    } catch (err) {
      console.warn("[ZuperSync] assignedUsers backfill failed:", err);
    }
  }

  return { synced, errors };
}

// ---------------------------------------------------------------------------
// Targeted recent-job sync (for cron backfill)
// ---------------------------------------------------------------------------

/**
 * Sync only Zuper jobs modified within a lookback window. This is much
 * cheaper than the full `syncZuperServiceJobs()` sweep and is suitable for
 * a cron that runs every 15–30 minutes to pick up jobs created or modified
 * directly in Zuper (which the existing sync-cache cron also covers, but
 * this version respects a time-budget and lookback window).
 *
 * Uses Zuper's `from_date`/`to_date` query parameters. These filter on
 * the job's scheduled date range, not modification time, so we use a
 * generous lookback to catch recently created jobs that might be scheduled
 * in the future.
 *
 * The function also does a second pass fetching individual job details for
 * jobs missing assigned crew data (Zuper's list endpoint omits assigned_to).
 */
export async function syncRecentZuperJobs(opts: {
  lookbackDays?: number;
  timeBudgetMs?: number;
}): Promise<{ synced: number; errors: number; pages: number; timedOut: boolean }> {
  const lookbackDays = opts.lookbackDays ?? 7;
  const timeBudgetMs = opts.timeBudgetMs ?? 100_000;
  const startTime = Date.now();

  if (!zuper.isConfigured()) {
    return { synced: 0, errors: 0, pages: 0, timedOut: false };
  }

  // Pre-load user names
  let userNameCache: Map<string, string> | undefined;
  try {
    const usersResult = await zuper.getUsers();
    if (usersResult.type === "success" && usersResult.data) {
      userNameCache = new Map();
      for (const u of usersResult.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const user = u as any;
        const uid = user.user_uid;
        const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
        if (uid && name) userNameCache.set(uid, name);
      }
    }
  } catch {
    // Non-fatal
  }

  // Compute date window: [now - lookbackDays, now + 90 days]
  // We look forward 90 days because newly created jobs may be scheduled
  // weeks ahead but we still want to capture them immediately.
  const fromDate = new Date(Date.now() - lookbackDays * 86_400_000);
  const toDate = new Date(Date.now() + 90 * 86_400_000);
  const fromStr = fromDate.toISOString().split("T")[0]; // YYYY-MM-DD
  const toStr = toDate.toISOString().split("T")[0];

  let synced = 0;
  let errors = 0;
  let page = 1;
  let timedOut = false;

  // Paginate through results
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - startTime > timeBudgetMs) {
      timedOut = true;
      break;
    }

    const result = await zuper.searchJobs({
      from_date: fromStr,
      to_date: toStr,
      page,
      limit: PAGE_SIZE,
    });

    if (result.type !== "success" || !result.data) {
      console.error("[ZuperBackfill] Failed to fetch page", page, result.error);
      break;
    }

    const { jobs } = result.data;
    if (!jobs || jobs.length === 0) break;

    for (const job of jobs) {
      if (Date.now() - startTime > timeBudgetMs) {
        timedOut = true;
        break;
      }

      try {
        const jobUid = job.job_uid;
        if (!jobUid) {
          errors++;
          continue;
        }

        const status = resolveStatus(job);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jobAny = job as any;
        let completedDate: Date | undefined;
        const statusUpper = status.toUpperCase();
        const isTerminal = statusUpper.includes("COMPLETED") ||
          statusUpper.includes("COMPLETE") ||
          statusUpper === "PASSED" ||
          statusUpper === "PARTIAL PASS" ||
          statusUpper === "FAILED";
        if (isTerminal) {
          const rawCompleted =
            jobAny.completed_time ??
            jobAny.completed_at ??
            job.scheduled_end_time;
          if (rawCompleted) {
            const d = new Date(rawCompleted as string);
            if (!isNaN(d.getTime())) completedDate = d;
          }
        }

        await cacheZuperJob({
          jobUid,
          jobTitle: job.job_title || "Untitled Job",
          jobCategory: resolveCategory(job.job_category),
          jobStatus: status,
          jobPriority: job.job_priority,
          scheduledStart: job.scheduled_start_time ? new Date(job.scheduled_start_time) : undefined,
          scheduledEnd: job.scheduled_end_time ? new Date(job.scheduled_end_time) : undefined,
          completedDate,
          assignedUsers: resolveAssignedUsers(job.assigned_to, userNameCache),
          customerAddress: job.customer_address ?? jobAny.job_location,
          hubspotDealId: extractHubspotDealId(job),
          projectName: job.job_title,
          jobTags: job.job_tags,
          jobNotes: job.job_notes,
          rawData: job,
        });

        synced++;
      } catch (err) {
        console.warn("[ZuperBackfill] Failed to cache job", job.job_uid, err);
        errors++;
      }
    }

    if (timedOut || jobs.length < PAGE_SIZE) break;
    page++;
  }

  // Second pass: backfill assignedUsers from individual job GETs (same as full sync)
  if (prisma && !timedOut) {
    try {
      const cutoff = new Date(Date.now() + 30 * 86_400_000);
      const missingCrew = await prisma.$queryRaw<{ jobUid: string }[]>`
        SELECT "jobUid" FROM "ZuperJobCache"
        WHERE "scheduledStart" >= NOW() - INTERVAL '7 days'
          AND "scheduledStart" < ${cutoff}
          AND "assignedUsers" = 'null'::jsonb
          AND "jobStatus" NOT IN ('CANCELLED')
        LIMIT 50
      `;

      let backfilled = 0;
      for (const { jobUid } of missingCrew) {
        if (Date.now() - startTime > timeBudgetMs) break;
        try {
          const detail = await zuper.getJob(jobUid);
          if (detail.type !== "success" || !detail.data) continue;
          const job = detail.data;
          const users = resolveAssignedUsers(job.assigned_to, userNameCache);
          if (!users || users.length === 0) continue;

          await prisma.zuperJobCache.update({
            where: { jobUid },
            data: { assignedUsers: JSON.parse(JSON.stringify(users)) },
          });
          backfilled++;
        } catch {
          // Non-fatal
        }
      }

      if (missingCrew.length > 0) {
        console.log(`[ZuperBackfill] Backfilled assignedUsers: ${backfilled}/${missingCrew.length} jobs`);
      }
    } catch (err) {
      console.warn("[ZuperBackfill] assignedUsers backfill failed:", err);
    }
  }

  console.log(`[ZuperBackfill] Complete — synced: ${synced}, errors: ${errors}, pages: ${page}, timedOut: ${timedOut}`);
  return { synced, errors, pages: page, timedOut };
}

// ---------------------------------------------------------------------------
// Single-job cache upsert (for webhook path)
// ---------------------------------------------------------------------------

/**
 * Fetch a single Zuper job by UID and upsert it into ZuperJobCache.
 * Designed for the webhook handler — fetches the full job detail (which
 * includes assigned_to) and uses cacheZuperJob's upsert to safely
 * create-or-update.
 *
 * Returns the cached record, or null if the fetch fails or Zuper is not
 * configured.
 */
export async function fetchAndCacheZuperJob(jobUid: string): Promise<{
  cached: boolean;
  hubspotDealId?: string;
  error?: string;
}> {
  if (!zuper.isConfigured()) {
    return { cached: false, error: "Zuper not configured" };
  }

  try {
    const result = await zuper.getJob(jobUid);
    if (result.type !== "success" || !result.data) {
      return { cached: false, error: result.error || "Job not found" };
    }

    const job = result.data;
    const status = resolveStatus(job);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jobAny = job as any;

    let completedDate: Date | undefined;
    const statusUpper = status.toUpperCase();
    const isTerminal = statusUpper.includes("COMPLETED") ||
      statusUpper.includes("COMPLETE") ||
      statusUpper === "PASSED" ||
      statusUpper === "PARTIAL PASS" ||
      statusUpper === "FAILED";
    if (isTerminal) {
      const rawCompleted =
        jobAny.completed_time ??
        jobAny.completed_at ??
        job.scheduled_end_time;
      if (rawCompleted) {
        const d = new Date(rawCompleted as string);
        if (!isNaN(d.getTime())) completedDate = d;
      }
    }

    const hubspotDealId = extractHubspotDealId(job);

    await cacheZuperJob({
      jobUid: job.job_uid || jobUid,
      jobTitle: job.job_title || "Untitled Job",
      jobCategory: resolveCategory(job.job_category),
      jobStatus: status,
      jobPriority: job.job_priority,
      scheduledStart: job.scheduled_start_time ? new Date(job.scheduled_start_time) : undefined,
      scheduledEnd: job.scheduled_end_time ? new Date(job.scheduled_end_time) : undefined,
      completedDate,
      assignedUsers: resolveAssignedUsers(job.assigned_to),
      customerAddress: job.customer_address ?? jobAny.job_location,
      hubspotDealId,
      projectName: job.job_title,
      jobTags: job.job_tags,
      jobNotes: job.job_notes,
      rawData: job,
    });

    return { cached: true, hubspotDealId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ZuperSync] fetchAndCacheZuperJob failed for", jobUid, msg);
    return { cached: false, error: msg };
  }
}
