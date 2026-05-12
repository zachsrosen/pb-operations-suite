/**
 * Shared Zuper ↔ HubSpot status mapping helpers.
 *
 * Extracted from `src/app/api/zuper/status-comparison/route.ts` so the
 * admin comparison page, the 15-min drift reconcile cron, and the
 * one-off backfill script share a single source of truth.
 *
 * Kept free of HubSpot SDK / Zuper SDK imports — pure logic + types.
 */

// ============================================================================
// Types
// ============================================================================

/** Minimal HubSpot deal shape needed for drift evaluation. */
export interface DriftEvalDeal {
  dealId: string;
  dealName: string | null;
  pbLocation: string | null;
  projectNumber: string | null;
  siteSurveyStatus: string | null;
  constructionStatus: string | null; // install_status
  inspectionStatus: string | null; // final_inspection_status
  constructionCompleteDate: string | null;
  inspectionPassDate: string | null; // inspections_completion_date
  inspectionFailDate: string | null; // inspections_fail_date
}

/** Minimal Zuper job shape needed for drift evaluation. */
export interface DriftEvalJob {
  jobUid: string;
  jobTitle: string;
  /** Canonical sub-type label (site_survey | construction | solar_install | battery_install | ev_install | inspection) */
  category: string;
  /** Job's current_job_status. */
  zuperStatus: string;
  /** ZuperJobCache.completedDate as ISO string. */
  completedAt: string | null;
}

/**
 * Subset of the original ZuperJobSummary fields that `markSupersededJobs`
 * inspects. Exposing this as a structural type lets the cron + backfill
 * pass their own row shapes without coupling to the admin route's
 * internal type.
 */
export interface SupersedableJob {
  category: string;
  zuperStatus: string;
  projectNumber: string | null;
  scheduledStart?: string | null;
  createdAt?: string | null;
  isSuperseded?: boolean;
}

export type DriftType =
  | "STATUS"
  | "FAIL_DISAGREEMENT"
  | "COMPLETION_DATE"
  | "INSPECTION_PASS_DATE"
  | "INSPECTION_FAIL_DATE";

// ============================================================================
// Status mapping
// ============================================================================

/**
 * Define which Zuper statuses map to which HubSpot statuses, per category.
 * Verbatim from `src/app/api/zuper/status-comparison/route.ts`.
 */
export const STATUS_MAPPING: Record<string, Record<string, string[]>> = {
  site_survey: {
    "Scheduling On-Hold": ["Scheduling On-Hold"],
    "Ready To Schedule": ["Ready to Schedule"],
    "Awaiting Reply": ["Awaiting Reply"],
    "Scheduled": ["Scheduled"],
    "On Our Way": ["On Our Way"],
    "Started": ["Started", "In Progress"],
    "Completed": ["Completed"],
    "Needs Revisit": ["Needs Revisit"],
  },
  construction: {
    "Ready To Build": ["Ready to Build"],
    "Scheduled": ["Scheduled"],
    "On Our Way": ["On Our Way"],
    "Started": ["Started", "In Progress"],
    "Loose Ends Remaining": ["Loose Ends Remaining"],
    "Construction Complete": ["Construction Complete"],
  },
  inspection: {
    "Ready For Inspection": ["Ready For Inspection"],
    "Scheduled": ["Scheduled"],
    "On Our Way": ["On Our Way"],
    "Started": ["Started", "In Progress"],
    "Passed": ["Passed"],
    "Partial Pass": ["Partial Pass"],
    "Failed": ["Failed"],
  },
};

/** HubSpot terminal statuses — if HS shows one of these and Zuper is behind, it's not a real problem. */
export const HS_TERMINAL_STATUSES = new Set([
  "completed",
  "passed",
  "construction complete",
  "partial pass",
]);

/**
 * Post-failure statuses — if Zuper is "Failed" and HS shows one of these,
 * it means the team moved on to re-inspection. Not a real mismatch IF
 * the fail date was recorded.
 */
export const POST_FAILURE_STATUSES = new Set([
  "ready for inspection",
  "waiting on revisions",
  "scheduled",
]);

/**
 * Collapse Zuper's sub-type category labels to the three top-level mapping keys.
 * All four construction sub-types collapse to "construction".
 */
export function toMappingCategory(category: string): "site_survey" | "construction" | "inspection" {
  if (category === "site_survey") return "site_survey";
  if (category === "inspection") return "inspection";
  // construction | solar_install | battery_install | ev_install → "construction"
  return "construction";
}

/** Check if Zuper status and HubSpot status are in sync for the given category. */
export function isStatusMismatch(
  zuperStatus: string,
  hubspotStatus: string | null,
  category: string,
): boolean {
  if (!hubspotStatus) return true;

  const categoryMap = STATUS_MAPPING[category];
  if (!categoryMap) return zuperStatus.toLowerCase() !== hubspotStatus.toLowerCase();

  const expectedHubspotStatuses = categoryMap[zuperStatus];
  if (!expectedHubspotStatuses) {
    return zuperStatus.toLowerCase() !== hubspotStatus.toLowerCase();
  }

  return !expectedHubspotStatuses.some(
    (s) => s.toLowerCase() === hubspotStatus.toLowerCase(),
  );
}

/**
 * Check if HubSpot is legitimately ahead of Zuper. Two cases:
 *  1. HS terminal, Zuper isn't yet — team finished and forgot to update Zuper.
 *  2. Zuper failed, HS moved to a post-failure status AND fail dates align — re-inspection in progress.
 *
 * `deal` and `job` are accepted as optional shaped inputs so the admin route can
 * pass its richer types without forcing the cron to fabricate them.
 */
export function checkHubspotAhead(
  zuperStatus: string,
  hubspotStatus: string | null,
  deal?: { inspectionFailDate: string | null },
  job?: { failedAt?: string | null },
): boolean {
  if (!hubspotStatus) return false;
  const hsLower = hubspotStatus.toLowerCase();
  const zLower = zuperStatus.toLowerCase();

  // Case 1: HS is terminal, Zuper isn't
  if (HS_TERMINAL_STATUSES.has(hsLower) && !HS_TERMINAL_STATUSES.has(zLower)) return true;

  // Case 2: Zuper failed, HS moved to post-failure status, AND fail date was recorded correctly
  if (zLower === "failed" && POST_FAILURE_STATUSES.has(hsLower) && deal?.inspectionFailDate) {
    // If we have the Zuper fail date, verify it matches HubSpot's fail date (±1 day tolerance)
    if (job?.failedAt) {
      const match = compareDates(job.failedAt, deal.inspectionFailDate);
      return match === true; // only mark as HS-ahead if fail dates align
    }
    // No Zuper fail date available — trust HubSpot's fail date existence
    return true;
  }

  return false;
}

// ============================================================================
// Date helpers
// ============================================================================

/**
 * HubSpot date-only properties use the portal timezone (America/Denver for PB).
 * Zuper returns UTC timestamps. Convert to Mountain Time before extracting the date
 * to avoid false 1-day mismatches at the day boundary.
 */
const PORTAL_TZ = "America/Denver";

/**
 * Convert a Zuper UTC timestamp to a YYYY-MM-DD date in the portal timezone.
 * Zuper stores full ISO timestamps (e.g. "2026-01-14T18:00:00.000Z").
 */
export function zuperDateToLocal(dateStr: string): string {
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PORTAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Extract a YYYY-MM-DD from a HubSpot date property.
 * HubSpot date-only properties are stored as midnight UTC (e.g. "2026-01-14"
 * or "2026-01-14T00:00:00.000Z"). Converting to Mountain would shift them
 * back a day, so we just take the first 10 characters.
 */
export function hubspotDateToLocal(dateStr: string): string {
  // If it's already YYYY-MM-DD, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // If it's a full ISO timestamp at midnight UTC, extract the date portion
  return dateStr.slice(0, 10);
}

/**
 * Compare a Zuper date (UTC timestamp) with a HubSpot date (date-only property).
 * Returns true if they are the same day (±1 day tolerance), false if different,
 * null if either is missing.
 */
export function compareDates(zuperDate: string | null, hubspotDate: string | null): boolean | null {
  if (!zuperDate || !hubspotDate) return null;
  try {
    const d1 = zuperDateToLocal(zuperDate);
    const d2 = hubspotDateToLocal(hubspotDate);
    if (d1 === d2) return true;
    // Allow 1-day tolerance — timezone handling differences between
    // Zuper, Zapier, and HubSpot cause unavoidable ±1 day drift
    const ms = Math.abs(new Date(d1).getTime() - new Date(d2).getTime());
    const days = Math.round(ms / (1000 * 60 * 60 * 24));
    return days <= 1;
  } catch {
    return null;
  }
}

/** Calculate absolute difference in days between a Zuper date and HubSpot date. */
export function dateDiffDays(zuperDate: string | null, hubspotDate: string | null): number | null {
  if (!zuperDate || !hubspotDate) return null;
  try {
    const d1 = zuperDateToLocal(zuperDate);
    const d2 = hubspotDateToLocal(hubspotDate);
    const ms = Math.abs(new Date(d1).getTime() - new Date(d2).getTime());
    return Math.round(ms / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

// ============================================================================
// markSupersededJobs
// ============================================================================

/**
 * Mark superseded inspection jobs: when multiple non-cancelled inspection jobs
 * exist for the same deal, the older ones are marked superseded. HubSpot only
 * tracks the latest inspection's status, so comparing older jobs creates false
 * mismatches. Only applies to inspection — construction/survey re-dos are rare
 * and worth flagging as true duplicates.
 *
 * Mutates `isSuperseded` in place. Genericized over any row shape that has the
 * fields it reads (see `SupersedableJob`).
 */
export function markSupersededJobs<T extends SupersedableJob>(jobs: T[]): void {
  const CANCELLED = new Set(["cancelled", "canceled"]);

  // Group inspection jobs by projectNumber (works even without deal link).
  // Both the original inspection and re-inspection share the same Zuper project
  // and have the same PROJ-XXXX in their title.
  const groups = new Map<string, T[]>();
  for (const job of jobs) {
    if (job.category !== "inspection") continue;
    if (CANCELLED.has(job.zuperStatus.toLowerCase())) continue;
    if (!job.projectNumber) continue;
    const key = job.projectNumber; // e.g. "PROJ-7159"
    const arr = groups.get(key) || [];
    arr.push(job);
    groups.set(key, arr);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Sort by scheduled start descending (newest first), fallback to createdAt
    group.sort((a, b) => {
      const dateA = a.scheduledStart || a.createdAt || "";
      const dateB = b.scheduledStart || b.createdAt || "";
      return dateB.localeCompare(dateA);
    });
    // Mark all but the newest as superseded
    for (let i = 1; i < group.length; i++) {
      group[i].isSuperseded = true;
    }
  }
}

// ============================================================================
// evaluateJobDrift — core decision function
// ============================================================================

const CONSTRUCTION_SUB_TYPES = new Set([
  "construction",
  "solar_install",
  "battery_install",
  "ev_install",
]);

/**
 * Pure decision function: given a Zuper job and its HubSpot deal, return the
 * set of drift types that fire. Empty array → fully in sync.
 *
 * Single source of truth shared by the reconcile cron and the backfill
 * script. Tested directly in `src/__tests__/zuper-status-mapping.test.ts`.
 */
export function evaluateJobDrift(job: DriftEvalJob, deal: DriftEvalDeal): DriftType[] {
  const out: DriftType[] = [];
  const mappingCategory = toMappingCategory(job.category);

  // Pick the right HubSpot status for this category.
  const hubspotStatus = (() => {
    switch (mappingCategory) {
      case "site_survey":
        return deal.siteSurveyStatus;
      case "construction":
        return deal.constructionStatus;
      case "inspection":
        return deal.inspectionStatus;
    }
  })();

  // FAIL_DISAGREEMENT — inspection only, hard-disagree case.
  // Evaluated first so STATUS logic can treat it as "always drift".
  let failDisagreement = false;
  if (mappingCategory === "inspection") {
    const z = job.zuperStatus.toLowerCase();
    const h = (hubspotStatus ?? "").toLowerCase();
    if ((z === "failed" && h === "passed") || (z === "passed" && h === "failed")) {
      failDisagreement = true;
      out.push("FAIL_DISAGREEMENT");
    }
  }

  // STATUS — Zuper↔HubSpot status mapping, considering legit HS-ahead cases.
  // Fail/pass disagreement is never "HS legitimately ahead" — that's actively
  // contradictory data, so force STATUS to fire in that case.
  const statusMismatched = isStatusMismatch(job.zuperStatus, hubspotStatus, mappingCategory);
  const hubspotAhead = checkHubspotAhead(job.zuperStatus, hubspotStatus, {
    inspectionFailDate: deal.inspectionFailDate,
  });
  if (statusMismatched && (failDisagreement || !hubspotAhead)) {
    out.push("STATUS");
  }

  // COMPLETION_DATE — construction sub-types only.
  if (
    CONSTRUCTION_SUB_TYPES.has(job.category) &&
    job.completedAt &&
    deal.constructionCompleteDate
  ) {
    if (compareDates(job.completedAt, deal.constructionCompleteDate) === false) {
      out.push("COMPLETION_DATE");
    }
  }

  // INSPECTION_PASS_DATE — inspection Passed only.
  if (mappingCategory === "inspection" && job.zuperStatus.toLowerCase() === "passed") {
    if (job.completedAt && deal.inspectionPassDate) {
      if (compareDates(job.completedAt, deal.inspectionPassDate) === false) {
        out.push("INSPECTION_PASS_DATE");
      }
    }
  }

  // INSPECTION_FAIL_DATE — inspection Failed only.
  if (mappingCategory === "inspection" && job.zuperStatus.toLowerCase() === "failed") {
    if (job.completedAt && deal.inspectionFailDate) {
      if (compareDates(job.completedAt, deal.inspectionFailDate) === false) {
        out.push("INSPECTION_FAIL_DATE");
      }
    }
  }

  return out;
}
