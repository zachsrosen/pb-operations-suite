/**
 * Shared compliance helpers — used by both the compliance API route
 * and the weekly digest data function.
 *
 * IMPORTANT: Keep this module in sync. Any bug fix here applies to
 * both the dashboard AND the weekly email automatically.
 */

import { zuper, JOB_CATEGORY_UIDS, JOB_CATEGORIES } from "@/lib/zuper";

// ========== Types ==========

export interface AssignedUser {
  userUid: string;
  userName: string;
  teamNames: string[];
}

// ========== Constants ==========

/** Statuses that indicate a job is "in progress" but may be stuck */
export const STUCK_STATUSES = new Set(
  ["on our way", "started", "in progress"].map((s) => s.toLowerCase())
);

/** Statuses that indicate a job was never started */
export const NEVER_STARTED_STATUSES = new Set(
  [
    "new",
    "scheduled",
    "unassigned",
    "ready to schedule",
    "ready to build",
    "ready for inspection",
  ].map((s) => s.toLowerCase())
);

/** Completed-like statuses (job is done) */
export const COMPLETED_STATUSES = new Set(
  [
    "completed",
    "construction complete",
    "passed",
    "partial pass",
    "failed",
  ].map((s) => s.toLowerCase())
);

/**
 * Users to exclude from compliance metrics (test/demo accounts).
 * Matched case-insensitively against the start of the full name.
 */
export const EXCLUDED_USER_NAMES = [
  "patrick",
  "jessica",
  "matt raichart",
];

/**
 * Non-field teams to exclude from compliance metrics (backoffice, admin, etc.).
 * Matched case-insensitively — team name must start with one of these prefixes.
 */
export const EXCLUDED_TEAM_PREFIXES = [
  "backoffice",
  "back office",
  "admin",
  "office",
  "sales",
];

/** 1 day grace period in milliseconds */
export const GRACE_MS = 24 * 60 * 60 * 1000;

/** Max pages to fetch per category (safety cap — 50 pages × 100 = 5000 jobs per category) */
export const MAX_PAGES_PER_CATEGORY = 50;

/** Category UID to display name mapping (built at module load) */
export const CATEGORY_UID_TO_NAME: Record<string, string> = {};
for (const [key, uid] of Object.entries(JOB_CATEGORY_UIDS) as [string, string][]) {
  CATEGORY_UID_TO_NAME[uid] = JOB_CATEGORIES[key as keyof typeof JOB_CATEGORIES] || key;
}

// ========== Helper Functions ==========

/**
 * Resolve the category UID from a job's job_category field (string or object).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCategoryUid(job: any): string | null {
  const cat = job.job_category;
  if (!cat) return null;
  if (typeof cat === "string") return cat;
  return (cat as Record<string, unknown>)?.category_uid as string | null;
}

/**
 * Get current status name from a job.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStatusName(job: any): string {
  return (
    job.current_job_status?.status_name ||
    job.status?.status_name ||
    job.status ||
    "Unknown"
  );
}

/**
 * Extract the completion timestamp from a job's status history.
 * Zuper jobs have a `job_status` array tracking each status transition
 * with a `created_at` timestamp. We find the most recent entry whose
 * status_name matches a completed status.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCompletedTimeFromHistory(job: any): Date | null {
  // First check direct fields (some endpoints include these)
  const direct = job.completed_time || job.completed_at;
  if (direct) return new Date(direct);

  // Walk the job_status history array
  const statusHistory = job.job_status;
  if (!Array.isArray(statusHistory)) return null;

  // Iterate in reverse to find the most recent completed status entry
  for (let i = statusHistory.length - 1; i >= 0; i--) {
    const entry = statusHistory[i];
    if (!entry) continue;
    const name = (entry.status_name || entry.name || "").toLowerCase();
    if (COMPLETED_STATUSES.has(name) && (entry.created_at || entry.updated_at)) {
      return new Date(entry.created_at || entry.updated_at);
    }
  }

  return null;
}

/**
 * Extract the timestamp when "On Our Way" was first set from the job_status history.
 * Returns null if the status was never used.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getOnOurWayTime(job: any): Date | null {
  const statusHistory = job.job_status;
  if (!Array.isArray(statusHistory)) return null;

  // Find the first "on our way" entry (chronological order)
  for (const entry of statusHistory) {
    if (!entry) continue;
    const name = (entry.status_name || entry.name || "").toLowerCase();
    if (name === "on our way" && (entry.created_at || entry.updated_at)) {
      return new Date(entry.created_at || entry.updated_at);
    }
  }

  return null;
}

/**
 * Extract the timestamp when "Started" was first set from job_status history.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStartedTime(job: any): Date | null {
  const statusHistory = job.job_status;
  if (!Array.isArray(statusHistory)) return null;

  for (const entry of statusHistory) {
    if (!entry) continue;
    const name = (entry.status_name || entry.name || "").toLowerCase();
    if (name === "started" && (entry.created_at || entry.updated_at)) {
      return new Date(entry.created_at || entry.updated_at);
    }
  }
  return null;
}

/**
 * Check if a user name matches the exclusion list.
 */
export function isExcludedUser(userName: string): boolean {
  const lower = userName.toLowerCase();
  return EXCLUDED_USER_NAMES.some((excluded) => lower.startsWith(excluded));
}

/**
 * Check if a team name is a non-field/backoffice team that should be excluded.
 */
export function isExcludedTeam(teamName: string | null): boolean {
  if (!teamName) return false;
  const lower = teamName.toLowerCase();
  return EXCLUDED_TEAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Extract all team names from a job's assigned_to_team array.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractTeamNames(job: any): string[] {
  const teams: string[] = [];
  if (!Array.isArray(job.assigned_to_team)) return teams;
  for (const t of job.assigned_to_team) {
    if (typeof t === "object" && t !== null) {
      const tm = t.team;
      if (typeof tm === "object" && tm !== null && tm.team_name) {
        teams.push(tm.team_name);
      }
    }
  }
  return teams;
}

/**
 * Extract assigned users from a job. Returns array of { userUid, userName, teamNames }.
 * Each user gets the team from their specific assignment entry (assigned_to[*].team),
 * NOT the job-level assigned_to_team array, to avoid attributing users to teams they
 * aren't assigned under for that job.
 *
 * Fallback order when assignment-level team is missing:
 *   1. Resolve team_uid via the job-level assigned_to_team uid→name map
 *   2. If the job has exactly one team, assume all users belong to it
 *   3. Otherwise leave teamNames empty (user will appear as "Unassigned")
 *
 * Filters out excluded test users and inactive Zuper users.
 */
export function extractAssignedUsers(
  job: Record<string, unknown>,
  options?: {
    crewTeamByUserUid?: Map<string, string>;
    directTeamByUserUid?: Map<string, string>;
    excludedUserUids?: Set<string>;
  }
): AssignedUser[] {
  const users: AssignedUser[] = [];

  if (!Array.isArray(job.assigned_to)) return users;

  // Build a team_uid → team_name lookup from the job-level assigned_to_team array.
  // Used to resolve assignment-level team_uid when team_name is absent.
  const teamUidToName = new Map<string, string>();
  if (Array.isArray(job.assigned_to_team)) {
    for (const t of job.assigned_to_team) {
      if (typeof t === "object" && t !== null) {
        const tm = t.team;
        if (typeof tm === "object" && tm !== null && tm.team_uid && tm.team_name) {
          teamUidToName.set(tm.team_uid, tm.team_name);
        }
      }
    }
  }

  // If the job has exactly one team, use it as a last-resort fallback
  const jobLevelTeams = extractTeamNames(job);
  const singleTeamFallback = jobLevelTeams.length === 1 ? jobLevelTeams[0] : null;

  for (const a of job.assigned_to) {
    if (typeof a !== "object" || a === null) continue;
    const user = a.user || a;
    if (typeof user !== "object" || user === null) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = user as Record<string, any>;
    const userUid = u.user_uid;
    if (!userUid) continue;
    const userName = `${u.first_name || ""} ${u.last_name || ""}`.trim();
    if (!userName) continue;

    // Skip inactive Zuper users
    if (u.is_active === false) continue;

    // Skip excluded test/demo users
    if (isExcludedUser(userName)) continue;

    // Explicit user-level exclusions from direct mapping file
    if (options?.excludedUserUids?.has(userUid)) continue;

    // Resolve team from the assignment entry itself (not job-level fanout)
    const assignmentTeamName: string | undefined = a.team?.team_name;
    const assignmentTeamUid: string | undefined = a.team_uid || a.team?.team_uid;

    let teamNames: string[];
    if (options?.directTeamByUserUid?.has(userUid)) {
      // Highest-priority explicit override from direct mapping file
      teamNames = [options.directTeamByUserUid.get(userUid)!];
    } else if (assignmentTeamName) {
      // Best case: assignment carries team_name directly
      teamNames = [assignmentTeamName];
    } else if (assignmentTeamUid && teamUidToName.has(assignmentTeamUid)) {
      // Has team_uid but no name — resolve from job-level lookup
      teamNames = [teamUidToName.get(assignmentTeamUid)!];
    } else if (options?.crewTeamByUserUid?.has(userUid)) {
      // Fallback to CrewMember DB mapping (zuperUserUid -> teamName)
      teamNames = [options.crewTeamByUserUid.get(userUid)!];
    } else if (singleTeamFallback) {
      // No assignment-level team data, but job has exactly one team
      teamNames = [singleTeamFallback];
    } else {
      // Multiple job-level teams or none — can't determine, leave empty
      teamNames = [];
    }

    // Exclude non-field teams from compliance metrics.
    if (teamNames.some((teamName) => isExcludedTeam(teamName))) continue;

    users.push({ userUid, userName, teamNames });
  }

  return users;
}

/**
 * Filter assigned users to only those belonging to a specific team.
 */
export function filterAssignedUsersByTeam(
  assignedUsers: AssignedUser[],
  teamFilter: string | null
): AssignedUser[] {
  if (!teamFilter) return assignedUsers;
  return assignedUsers.filter((u) =>
    u.teamNames.some((t) => t.toLowerCase().includes(teamFilter))
  );
}

/**
 * Compute a letter grade from a compliance score.
 */
export function computeGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

/**
 * Fetch all jobs for a single category with pagination.
 * Client-side filters by category UID since Zuper search is unreliable.
 */
export async function fetchJobsForCategory(
  categoryUid: string,
  fromDate: string,
  toDate: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const fromBoundary = new Date(`${fromDate}T00:00:00.000Z`);
  const toBoundary = new Date(`${toDate}T23:59:59.999Z`);

  // Use schedule timestamps first so the compliance date window tracks the
  // planned work window, with fallback to completion/created timestamps.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getJobAnchorTime = (job: any): Date | null => {
    const candidates = [
      job.scheduled_start_time,
      job.scheduled_end_time,
      job.completed_time,
      job.completed_at,
    ];
    for (const value of candidates) {
      if (!value) continue;
      const dt = new Date(value);
      if (!Number.isNaN(dt.getTime())) return dt;
    }

    const completedFromHistory = getCompletedTimeFromHistory(job);
    if (completedFromHistory) return completedFromHistory;

    const fallbackCandidates = [job.created_at, job.updated_at];
    for (const value of fallbackCandidates) {
      if (!value) continue;
      const dt = new Date(value);
      if (!Number.isNaN(dt.getTime())) return dt;
    }

    return null;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allJobs: any[] = [];
  let page = 1;
  const limit = 100;
  let hasMore = true;
  let totalRecords = Infinity;

  while (hasMore && page <= MAX_PAGES_PER_CATEGORY) {
    const result = await zuper.searchJobs({
      category: categoryUid,
      from_date: fromDate,
      to_date: toDate,
      page,
      limit,
    });

    if (result.type === "error" || !result.data?.jobs?.length) {
      break;
    }

    if (result.data.total && result.data.total < Infinity) {
      totalRecords = result.data.total;
    }

    for (const job of result.data.jobs) {
      // Client-side filter: enforce category UID match
      const jobCatUid = getCategoryUid(job);
      if (jobCatUid && jobCatUid !== categoryUid) continue;

      // Client-side filter: enforce date window in case Zuper ignores
      // from_date/to_date for a subset of records.
      const anchor = getJobAnchorTime(job);
      if (anchor && (anchor < fromBoundary || anchor > toBoundary)) continue;
      allJobs.push(job);
    }

    const fetchedSoFar = page * limit;
    if (result.data.jobs.length < limit || fetchedSoFar >= totalRecords) {
      hasMore = false;
    } else {
      page++;
    }
  }

  if (page > MAX_PAGES_PER_CATEGORY) {
    console.warn(
      `[compliance] Hit max page cap (${MAX_PAGES_PER_CATEGORY}) for category ${categoryUid}, fetched ${allJobs.length} jobs`
    );
  }

  return allJobs;
}
