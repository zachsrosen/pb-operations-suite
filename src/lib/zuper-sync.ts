/**
 * Zuper Job Cache Sync
 *
 * Fetches all Zuper jobs (paginated) and upserts them into the
 * ZuperJobCache table so downstream features (service priority queue,
 * customer history, enrichment) can query locally without hitting the
 * Zuper API on every request.
 */

import { zuper, type ZuperJob, type ZuperJobCategory } from "@/lib/zuper";
import { cacheZuperJob } from "@/lib/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise whatever is stored in Zuper's "HubSpot Deal ID" custom field
 * into a raw numeric deal ID. About 15% of historical rows hold the full
 * HubSpot record URL (`https://app.hubspot.com/contacts/.../record/0-3/12345`)
 * instead of just the ID, which breaks joins against HubSpot deal data.
 * Accepts either shape and returns just the numeric ID.
 */
function normalizeHubspotDealIdValue(raw: string): string | undefined {
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
function extractHubspotDealId(job: ZuperJob): string | undefined {
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
function resolveCategory(cat: ZuperJob["job_category"]): string {
  if (!cat) return "Unknown";
  if (typeof cat === "string") return cat;
  return (cat as ZuperJobCategory).category_name || "Unknown";
}

/**
 * Normalise the current_job_status field which is typically an object
 * `{ status_name }` but may occasionally be a plain string.
 */
function resolveStatus(job: ZuperJob): string {
  const s = job.current_job_status;
  if (!s) return job.status || "Unknown";
  if (typeof s === "string") return s;
  return s.status_name || "Unknown";
}

/**
 * Build the assignedUsers array expected by cacheZuperJob from Zuper's
 * polymorphic assigned_to field.
 */
function resolveAssignedUsers(
  assignedTo: ZuperJob["assigned_to"]
): { user_uid: string; user_name?: string }[] | undefined {
  if (!Array.isArray(assignedTo) || assignedTo.length === 0) return undefined;

  return assignedTo
    .map((entry) => {
      // GET format: { user: { user_uid, first_name, last_name } }
      if ("user" in entry && entry.user) {
        const u = entry.user as { user_uid?: string; first_name?: string; last_name?: string };
        return {
          user_uid: u.user_uid || "",
          user_name: [u.first_name, u.last_name].filter(Boolean).join(" ") || undefined,
        };
      }
      // POST/simple format: { user_uid, team_uid? }
      if ("user_uid" in entry) {
        return { user_uid: (entry as { user_uid: string }).user_uid };
      }
      return null;
    })
    .filter((u): u is { user_uid: string; user_name?: string } => !!u && !!u.user_uid);
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

const PAGE_SIZE = 500;

export async function syncZuperServiceJobs(): Promise<{ synced: number; errors: number }> {
  if (!zuper.isConfigured()) {
    return { synced: 0, errors: 0 };
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
          assignedUsers: resolveAssignedUsers(job.assigned_to),
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
  return { synced, errors };
}
