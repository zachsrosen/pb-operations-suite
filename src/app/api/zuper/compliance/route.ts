import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper, JOB_CATEGORY_UIDS, JOB_CATEGORIES } from "@/lib/zuper";
import { getActiveCrewMembers } from "@/lib/db";
import {
  COMPLIANCE_EXCLUDED_USER_UIDS,
  COMPLIANCE_TEAM_OVERRIDES,
} from "@/lib/compliance-team-overrides";

// ========== Types ==========

interface JobEntry {
  jobUid: string;
  title: string;
  status: string;
  category: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  completedTime: string | null;
  daysToComplete: number | null;
  daysLate: number | null;
  onOurWayTime: string | null;
  onOurWayOnTime: boolean | null; // null = no OOW data
}

interface CategoryBreakdown {
  [categoryName: string]: number;
}

interface UserMetrics {
  userUid: string;
  userName: string;
  teamName: string | null;
  totalJobs: number;
  completedJobs: number;
  onTimeCompletions: number;
  lateCompletions: number;
  onTimePercent: number;
  stuckJobs: number;
  neverStartedJobs: number;
  avgDaysToComplete: number;
  avgDaysLate: number;
  onOurWayOnTime: number;
  onOurWayLate: number;
  onOurWayPercent: number;
  oowUsed: number;
  startedUsed: number;
  statusUsagePercent: number;
  complianceScore: number;
  grade: string;
  adjustedScore: number;
  adjustedGrade: string;
  belowThreshold: boolean;
  byCategory: CategoryBreakdown;
  stuckJobsList: JobEntry[];
  lateJobsList: JobEntry[];
  neverStartedJobsList: JobEntry[];
  completedJobsList: JobEntry[];
}

interface ComplianceSummary {
  totalJobs: number;
  totalCompleted: number;
  overallOnTimePercent: number;
  totalStuck: number;
  totalNeverStarted: number;
  avgCompletionDays: number;
  avgDaysLate: number;
  overallOnOurWayPercent: number;
  userCount: number;
}

interface GroupComparison {
  name: string;
  totalJobs: number;
  completedJobs: number;
  onTimeCompletions: number;
  lateCompletions: number;
  onTimePercent: number;
  stuckJobs: number;
  neverStartedJobs: number;
  avgDaysToComplete: number;
  avgDaysLate: number;
  onOurWayOnTime: number;
  onOurWayLate: number;
  onOurWayPercent: number;
  oowUsed: number;
  startedUsed: number;
  statusUsagePercent: number;
  complianceScore: number;
  grade: string;
  adjustedScore: number;
  adjustedGrade: string;
  userCount: number;
}

// ========== Constants ==========

// Statuses that indicate a job is "in progress" but may be stuck
const STUCK_STATUSES = new Set(
  ["on our way", "started", "in progress"].map((s) => s.toLowerCase())
);

// Statuses that indicate a job was never started
const NEVER_STARTED_STATUSES = new Set(
  [
    "new",
    "scheduled",
    "unassigned",
    "ready to schedule",
    "ready to build",
    "ready for inspection",
  ].map((s) => s.toLowerCase())
);

// Completed-like statuses (job is done)
const COMPLETED_STATUSES = new Set(
  [
    "completed",
    "construction complete",
    "passed",
    "partial pass",
    "failed",
  ].map((s) => s.toLowerCase())
);

// Users to exclude from compliance metrics (test/demo accounts)
// Matched case-insensitively against the start of the full name
const EXCLUDED_USER_NAMES = [
  "patrick",
  "jessica",
  "matt raichart",
];

// Non-field teams to exclude from compliance metrics (backoffice, admin, etc.)
// Matched case-insensitively — team name must start with one of these prefixes.
const EXCLUDED_TEAM_PREFIXES = [
  "backoffice",
  "back office",
  "admin",
  "office",
  "sales",
];

// 1 day grace period in milliseconds
const GRACE_MS = 24 * 60 * 60 * 1000;

// Max pages to fetch per category (safety cap — 50 pages × 100 = 5000 jobs per category)
const MAX_PAGES_PER_CATEGORY = 50;

// Category UID to display name mapping
const CATEGORY_UID_TO_NAME: Record<string, string> = {};
for (const [key, uid] of Object.entries(JOB_CATEGORY_UIDS) as [string, string][]) {
  CATEGORY_UID_TO_NAME[uid] = JOB_CATEGORIES[key as keyof typeof JOB_CATEGORIES] || key;
}

// ========== Helpers ==========

/**
 * Resolve the category UID from a job's job_category field (string or object).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCategoryUid(job: any): string | null {
  const cat = job.job_category;
  if (!cat) return null;
  if (typeof cat === "string") return cat;
  return (cat as Record<string, unknown>)?.category_uid as string | null;
}

/**
 * Get current status name from a job.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getStatusName(job: any): string {
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
function getCompletedTimeFromHistory(job: any): Date | null {
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
function getOnOurWayTime(job: any): Date | null {
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
 * Check if "Started" status was ever used in the job_status history.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasStartedStatus(job: any): boolean {
  const statusHistory = job.job_status;
  if (!Array.isArray(statusHistory)) return false;

  for (const entry of statusHistory) {
    if (!entry) continue;
    const name = (entry.status_name || entry.name || "").toLowerCase();
    if (name === "started") return true;
  }
  return false;
}

/**
 * Check if a user name matches the exclusion list.
 */
function isExcludedUser(userName: string): boolean {
  const lower = userName.toLowerCase();
  return EXCLUDED_USER_NAMES.some((excluded) => lower.startsWith(excluded));
}

/**
 * Check if a team name is a non-field/backoffice team that should be excluded.
 */
function isExcludedTeam(teamName: string | null): boolean {
  if (!teamName) return false;
  const lower = teamName.toLowerCase();
  return EXCLUDED_TEAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Extract all team names from a job's assigned_to_team array.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTeamNames(job: any): string[] {
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
function extractAssignedUsers(
  job: Record<string, unknown>,
  options?: {
    crewTeamByUserUid?: Map<string, string>;
    directTeamByUserUid?: Map<string, string>;
    excludedUserUids?: Set<string>;
  }
): Array<{
  userUid: string;
  userName: string;
  teamNames: string[];
}> {
  const users: Array<{ userUid: string; userName: string; teamNames: string[] }> = [];

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
 * Compute a letter grade from a compliance score.
 */
function computeGrade(score: number): string {
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
async function fetchJobsForCategory(
  categoryUid: string,
  fromDate: string,
  toDate: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
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

// ========== Main Handler ==========

/**
 * GET /api/zuper/compliance?days=30&team=Denver&category=Construction
 *
 * Fetches Zuper jobs across all field categories, groups by assigned user,
 * and computes per-user compliance metrics including on-time rate, stuck jobs,
 * never-started jobs, On Our Way timing, and an overall compliance score.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    if (!zuper.isConfigured()) {
      return NextResponse.json(
        { error: "Zuper integration not configured", configured: false },
        { status: 503 }
      );
    }

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const days = Math.min(Math.max(parseInt(searchParams.get("days") || "30") || 30, 1), 365);
    const teamFilter = searchParams.get("team")?.toLowerCase().trim() || null;
    const categoryFilter = searchParams.get("category")?.toLowerCase().trim() || null;
    const minJobs = Math.max(parseInt(searchParams.get("minJobs") || "5") || 5, 0);

    // Compute date range
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - days);
    const fromDateStr = fromDate.toISOString().split("T")[0];
    const toDateStr = now.toISOString().split("T")[0];

    // Determine which categories to fetch
    const allCategoryEntries = Object.entries(JOB_CATEGORY_UIDS) as [
      keyof typeof JOB_CATEGORY_UIDS,
      string,
    ][];

    // If category filter is specified, only fetch matching categories
    const categoriesToFetch = categoryFilter
      ? allCategoryEntries.filter(([key]) => {
          const displayName = JOB_CATEGORIES[key as keyof typeof JOB_CATEGORIES] || key;
          return displayName.toLowerCase().includes(categoryFilter);
        })
      : allCategoryEntries;

    // Fetch jobs for all selected categories in parallel
    const categoryResults = await Promise.all(
      categoriesToFetch.map(async ([, uid]) => {
        const jobs = await fetchJobsForCategory(uid, fromDateStr, toDateStr);
        return { categoryUid: uid, jobs };
      })
    );

    // Flatten all jobs with category info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allJobs: Array<{ job: any; categoryUid: string; categoryName: string }> = [];
    for (const { categoryUid, jobs } of categoryResults) {
      const categoryName = CATEGORY_UID_TO_NAME[categoryUid] || categoryUid;
      for (const job of jobs) {
        allJobs.push({ job, categoryUid, categoryName });
      }
    }

    // Build crew fallback map: zuper user UID -> primary team name.
    // Used only when assignment-level team data is missing on a job.
    const crewTeamByUserUid = new Map<string, string>();
    const crewMembers = await getActiveCrewMembers();
    for (const crewMember of crewMembers) {
      const uid = crewMember.zuperUserUid?.trim();
      const teamName = crewMember.teamName?.trim();
      if (!uid || !teamName) continue;
      if (!crewTeamByUserUid.has(uid)) {
        crewTeamByUserUid.set(uid, teamName);
      }
    }
    const directTeamByUserUid = new Map<string, string>(
      Object.entries(COMPLIANCE_TEAM_OVERRIDES)
    );
    const assignmentOptions = {
      crewTeamByUserUid,
      directTeamByUserUid,
      excludedUserUids: COMPLIANCE_EXCLUDED_USER_UIDS,
    };

    // Collect unique teams and categories for filter options
    const teamsSet = new Set<string>();
    const categoriesSet = new Set<string>();

    // Group jobs by assigned user
    interface UserAccumulator {
      userUid: string;
      userName: string;
      teamNames: Set<string>;
      totalJobs: number;
      completedJobs: number;
      onTimeCompletions: number;
      lateCompletions: number;
      stuckJobs: number;
      neverStartedJobs: number;
      completionDays: number[];
      daysLatePastEnd: number[];
      onOurWayOnTime: number;
      onOurWayLate: number;
      onOurWayTotal: number;
      oowUsed: number;      // completed jobs that used OOW
      startedUsed: number;  // completed jobs that used Started
      byCategory: CategoryBreakdown;
      stuckJobsList: JobEntry[];
      lateJobsList: JobEntry[];
      neverStartedJobsList: JobEntry[];
      completedJobsList: JobEntry[];
    }

    const userMap = new Map<string, UserAccumulator>();
    let unassignedJobCount = 0;
    let filteredOutByTeam = 0;

    for (const { job, categoryName } of allJobs) {
      const statusName = getStatusName(job);
      const statusLower = statusName.toLowerCase();
      const assignedUsers = extractAssignedUsers(job, assignmentOptions);

      // Track filter options
      categoriesSet.add(categoryName);
      for (const u of assignedUsers) {
        for (const t of u.teamNames) teamsSet.add(t);
      }

      // Skip unassigned jobs
      if (assignedUsers.length === 0) {
        unassignedJobCount++;
        continue;
      }

      // Apply team filter if specified
      if (teamFilter) {
        const hasMatchingTeam = assignedUsers.some(
          (u) => u.teamNames.some((t) => t.toLowerCase().includes(teamFilter))
        );
        if (!hasMatchingTeam) {
          filteredOutByTeam++;
          continue;
        }
      }

      const scheduledStart = job.scheduled_start_time
        ? new Date(job.scheduled_start_time)
        : null;
      const scheduledEnd = job.scheduled_end_time
        ? new Date(job.scheduled_end_time)
        : null;
      // Extract completion time from job_status history array, falling back
      // to direct fields
      const completedTime = getCompletedTimeFromHistory(job);
      // Extract when "On Our Way" was triggered
      const onOurWayTime = getOnOurWayTime(job);
      // Check if "Started" was ever used
      const usedStarted = hasStartedStatus(job);

      // Attribute job to each assigned user
      for (const { userUid, userName, teamNames: jobTeams } of assignedUsers) {
        if (!userMap.has(userUid)) {
          userMap.set(userUid, {
            userUid,
            userName,
            teamNames: new Set(jobTeams),
            totalJobs: 0,
            completedJobs: 0,
            onTimeCompletions: 0,
            lateCompletions: 0,
            stuckJobs: 0,
            neverStartedJobs: 0,
            completionDays: [],
            daysLatePastEnd: [],
            onOurWayOnTime: 0,
            onOurWayLate: 0,
            onOurWayTotal: 0,
            oowUsed: 0,
            startedUsed: 0,
            byCategory: {},
            stuckJobsList: [],
            lateJobsList: [],
            neverStartedJobsList: [],
            completedJobsList: [],
          });
        }
        const acc = userMap.get(userUid)!;

        // Track all teams this user appears on
        for (const t of jobTeams) acc.teamNames.add(t);

        acc.totalJobs++;
        acc.byCategory[categoryName] = (acc.byCategory[categoryName] || 0) + 1;

        // Build a reusable job entry for detail lists
        const effectiveCompletedTime = completedTime || scheduledEnd;
        let jobDaysToComplete: number | null = null;
        let jobDaysLate: number | null = null;
        let jobOowOnTime: boolean | null = null;

        // Check if completed
        if (COMPLETED_STATUSES.has(statusLower)) {
          acc.completedJobs++;

          // On-time check: completed within scheduled_end + 1 day grace
          let isLate = false;
          if (scheduledEnd && effectiveCompletedTime) {
            const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
            if (effectiveCompletedTime <= deadline) {
              acc.onTimeCompletions++;
            } else {
              acc.lateCompletions++;
              isLate = true;
            }

            // Days past scheduled end
            if (effectiveCompletedTime > scheduledEnd) {
              const diffMs = effectiveCompletedTime.getTime() - scheduledEnd.getTime();
              jobDaysLate = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10;
              acc.daysLatePastEnd.push(jobDaysLate);
            }
          } else {
            acc.onTimeCompletions++;
          }

          // Days to complete: scheduled_start to completion
          if (scheduledStart && effectiveCompletedTime && effectiveCompletedTime > scheduledStart) {
            const diffMs = effectiveCompletedTime.getTime() - scheduledStart.getTime();
            jobDaysToComplete = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10;
            acc.completionDays.push(jobDaysToComplete);
          }

          // "On Our Way" compliance
          if (onOurWayTime && scheduledStart) {
            acc.onOurWayTotal++;
            if (scheduledEnd && onOurWayTime > scheduledEnd) {
              acc.onOurWayLate++;
              jobOowOnTime = false;
            } else {
              acc.onOurWayOnTime++;
              jobOowOnTime = true;
            }
          }

          // Track OOW and Started usage (did the user use these statuses at all?)
          if (onOurWayTime) acc.oowUsed++;
          if (usedStarted) acc.startedUsed++;

          // Build completed job entry
          const completedEntry: JobEntry = {
            jobUid: job.job_uid || "",
            title: job.job_title || "",
            status: statusName,
            category: categoryName,
            scheduledStart: job.scheduled_start_time || null,
            scheduledEnd: job.scheduled_end_time || null,
            completedTime: effectiveCompletedTime?.toISOString() || null,
            daysToComplete: jobDaysToComplete,
            daysLate: jobDaysLate,
            onOurWayTime: onOurWayTime?.toISOString() || null,
            onOurWayOnTime: jobOowOnTime,
          };

          acc.completedJobsList.push(completedEntry);
          if (isLate) {
            acc.lateJobsList.push(completedEntry);
          }
        }

        // Check for stuck jobs: in progress statuses with scheduled_end in the past
        if (STUCK_STATUSES.has(statusLower) && scheduledEnd && scheduledEnd < now) {
          acc.stuckJobs++;
          acc.stuckJobsList.push({
            jobUid: job.job_uid || "",
            title: job.job_title || "",
            status: statusName,
            category: categoryName,
            scheduledStart: job.scheduled_start_time || null,
            scheduledEnd: job.scheduled_end_time || null,
            completedTime: null,
            daysToComplete: null,
            daysLate: null,
            onOurWayTime: onOurWayTime?.toISOString() || null,
            onOurWayOnTime: null,
          });
        }

        // Check for never-started jobs: pre-start statuses with scheduled_start in the past
        if (
          NEVER_STARTED_STATUSES.has(statusLower) &&
          scheduledStart &&
          scheduledStart < now
        ) {
          acc.neverStartedJobs++;
          acc.neverStartedJobsList.push({
            jobUid: job.job_uid || "",
            title: job.job_title || "",
            status: statusName,
            category: categoryName,
            scheduledStart: job.scheduled_start_time || null,
            scheduledEnd: job.scheduled_end_time || null,
            completedTime: null,
            daysToComplete: null,
            daysLate: null,
            onOurWayTime: null,
            onOurWayOnTime: null,
          });
        }
      }
    }

    // Compute final metrics for each user
    const users: UserMetrics[] = [];

    for (const acc of Array.from(userMap.values())) {
      // Use measurable completions (on-time + late) as denominator so that
      // jobs without a completion timestamp don't drag down the rate
      const measurableCompletions = acc.onTimeCompletions + acc.lateCompletions;
      const onTimePercent =
        measurableCompletions > 0
          ? Math.round((acc.onTimeCompletions / measurableCompletions) * 100 * 10) / 10
          : 0;

      const avgDaysToComplete =
        acc.completionDays.length > 0
          ? Math.round(
              (acc.completionDays.reduce((sum: number, d: number) => sum + d, 0) /
                acc.completionDays.length) *
                10
            ) / 10
          : 0;

      // Average days late past scheduled end (only for jobs that were late)
      const avgDaysLate =
        acc.daysLatePastEnd.length > 0
          ? Math.round(
              (acc.daysLatePastEnd.reduce((sum: number, d: number) => sum + d, 0) /
                acc.daysLatePastEnd.length) *
                10
            ) / 10
          : 0;

      // On Our Way compliance percentage
      const onOurWayPercent =
        acc.onOurWayTotal > 0
          ? Math.round((acc.onOurWayOnTime / acc.onOurWayTotal) * 100 * 10) / 10
          : 0;

      // Compliance score:
      // 50% on-time rate + 30% (1 - stuckRate) * 100 + 20% (1 - neverStartedRate) * 100
      const stuckRate = acc.totalJobs > 0 ? acc.stuckJobs / acc.totalJobs : 0;
      const neverStartedRate =
        acc.totalJobs > 0 ? acc.neverStartedJobs / acc.totalJobs : 0;

      const complianceScore =
        Math.round(
          (0.5 * onTimePercent +
            0.3 * (1 - stuckRate) * 100 +
            0.2 * (1 - neverStartedRate) * 100) *
            10
        ) / 10;

      const grade = computeGrade(complianceScore);

      users.push({
        userUid: acc.userUid,
        userName: acc.userName,
        teamName: acc.teamNames.size > 0 ? Array.from(acc.teamNames).sort().join(", ") : null,
        totalJobs: acc.totalJobs,
        completedJobs: acc.completedJobs,
        onTimeCompletions: acc.onTimeCompletions,
        lateCompletions: acc.lateCompletions,
        onTimePercent,
        stuckJobs: acc.stuckJobs,
        neverStartedJobs: acc.neverStartedJobs,
        avgDaysToComplete,
        avgDaysLate,
        onOurWayOnTime: acc.onOurWayOnTime,
        onOurWayLate: acc.onOurWayLate,
        onOurWayPercent,
        oowUsed: acc.oowUsed,
        startedUsed: acc.startedUsed,
        statusUsagePercent: acc.completedJobs > 0
          ? Math.round(((acc.oowUsed + acc.startedUsed) / (acc.completedJobs * 2)) * 100 * 10) / 10
          : 0,
        complianceScore,
        grade,
        adjustedScore: 0, // computed below after global average is known
        adjustedGrade: "",
        belowThreshold: acc.totalJobs < minJobs,
        byCategory: acc.byCategory,
        stuckJobsList: acc.stuckJobsList,
        lateJobsList: acc.lateJobsList,
        neverStartedJobsList: acc.neverStartedJobsList,
        completedJobsList: acc.completedJobsList,
      });
    }

    // Compute Bayesian adjusted scores
    // adjustedScore = (userJobs * rawScore + C * globalAvg) / (userJobs + C)
    // C = 10 (confidence weight — users need ~10 jobs to mostly reflect their own score)
    const BAYESIAN_C = 10;
    const globalAvgScore = users.length > 0
      ? users.reduce((s, u) => s + u.complianceScore, 0) / users.length
      : 50;
    for (const u of users) {
      u.adjustedScore = Math.round(
        ((u.totalJobs * u.complianceScore + BAYESIAN_C * globalAvgScore) /
          (u.totalJobs + BAYESIAN_C)) * 10
      ) / 10;
      u.adjustedGrade = computeGrade(u.adjustedScore);
    }

    // Sort by adjustedScore descending (best first)
    users.sort((a, b) => b.adjustedScore - a.adjustedScore);

    // ========== Team Comparison ==========
    // Aggregate per-job by team (not per-user) to avoid inflating counts for multi-team users
    interface TeamAccumulator {
      totalJobs: number;
      completedJobs: number;
      onTimeCompletions: number;
      lateCompletions: number;
      stuckJobs: number;
      neverStartedJobs: number;
      completionDays: number[];
      daysLatePastEnd: number[];
      onOurWayOnTime: number;
      onOurWayLate: number;
      oowUsed: number;
      startedUsed: number;
      assignedUsers: Set<string>;
    }
    const teamAccMap = new Map<string, TeamAccumulator>();

    for (const { job } of allJobs) {
      const statusName = getStatusName(job);
      const statusLower = statusName.toLowerCase();
      const assignedUsers = extractAssignedUsers(job, assignmentOptions);

      if (assignedUsers.length === 0) continue;

      // Apply team filter if specified
      if (teamFilter) {
        const hasMatchingTeam = assignedUsers.some(
          (u) => u.teamNames.some((t) => t.toLowerCase().includes(teamFilter))
        );
        if (!hasMatchingTeam) continue;
      }

      // Determine which teams this job belongs to
      const jobTeams = new Set<string>();
      for (const u of assignedUsers) {
        for (const t of u.teamNames) jobTeams.add(t);
      }
      if (jobTeams.size === 0) jobTeams.add("Unassigned");

      const scheduledStart = job.scheduled_start_time ? new Date(job.scheduled_start_time) : null;
      const scheduledEnd = job.scheduled_end_time ? new Date(job.scheduled_end_time) : null;
      const completedTime = getCompletedTimeFromHistory(job);
      const onOurWayTime = getOnOurWayTime(job);
      const usedStarted = hasStartedStatus(job);
      const effectiveCompletedTime = completedTime || scheduledEnd;

      // Attribute this job once per team (not per user)
      for (const team of jobTeams) {
        if (!teamAccMap.has(team)) {
          teamAccMap.set(team, {
            totalJobs: 0, completedJobs: 0, onTimeCompletions: 0, lateCompletions: 0,
            stuckJobs: 0, neverStartedJobs: 0, completionDays: [], daysLatePastEnd: [],
            onOurWayOnTime: 0, onOurWayLate: 0, oowUsed: 0, startedUsed: 0,
            assignedUsers: new Set(),
          });
        }
        const tAcc = teamAccMap.get(team)!;
        tAcc.totalJobs++;
        for (const u of assignedUsers) tAcc.assignedUsers.add(u.userUid);

        if (COMPLETED_STATUSES.has(statusLower)) {
          tAcc.completedJobs++;
          if (scheduledEnd && effectiveCompletedTime) {
            const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
            if (effectiveCompletedTime <= deadline) {
              tAcc.onTimeCompletions++;
            } else {
              tAcc.lateCompletions++;
            }
            if (effectiveCompletedTime > scheduledEnd) {
              const diffMs = effectiveCompletedTime.getTime() - scheduledEnd.getTime();
              tAcc.daysLatePastEnd.push(Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10);
            }
          } else {
            tAcc.onTimeCompletions++;
          }
          if (scheduledStart && effectiveCompletedTime && effectiveCompletedTime > scheduledStart) {
            const diffMs = effectiveCompletedTime.getTime() - scheduledStart.getTime();
            tAcc.completionDays.push(Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10);
          }
          if (onOurWayTime && scheduledStart) {
            if (scheduledEnd && onOurWayTime > scheduledEnd) {
              tAcc.onOurWayLate++;
            } else {
              tAcc.onOurWayOnTime++;
            }
          }
          if (onOurWayTime) tAcc.oowUsed++;
          if (usedStarted) tAcc.startedUsed++;
        }
        if (STUCK_STATUSES.has(statusLower) && scheduledEnd && scheduledEnd < now) {
          tAcc.stuckJobs++;
        }
        if (NEVER_STARTED_STATUSES.has(statusLower) && scheduledStart && scheduledStart < now) {
          tAcc.neverStartedJobs++;
        }
      }
    }

    // Build team comparison from accumulators (same pattern as category comparison)
    function buildGroupFromAcc(name: string, acc: { totalJobs: number; completedJobs: number; onTimeCompletions: number; lateCompletions: number; stuckJobs: number; neverStartedJobs: number; completionDays: number[]; daysLatePastEnd: number[]; onOurWayOnTime: number; onOurWayLate: number; oowUsed: number; startedUsed: number; assignedUsers: Set<string> }): GroupComparison {
      const measurable = acc.onTimeCompletions + acc.lateCompletions;
      const onTimePercent = measurable > 0 ? Math.round((acc.onTimeCompletions / measurable) * 100 * 10) / 10 : 0;
      const avgDaysToComplete = acc.completionDays.length > 0
        ? Math.round((acc.completionDays.reduce((s, d) => s + d, 0) / acc.completionDays.length) * 10) / 10
        : 0;
      const avgDaysLate = acc.daysLatePastEnd.length > 0
        ? Math.round((acc.daysLatePastEnd.reduce((s, d) => s + d, 0) / acc.daysLatePastEnd.length) * 10) / 10
        : 0;
      const oowTotal = acc.onOurWayOnTime + acc.onOurWayLate;
      const onOurWayPercent = oowTotal > 0 ? Math.round((acc.onOurWayOnTime / oowTotal) * 100 * 10) / 10 : 0;
      const stuckRate = acc.totalJobs > 0 ? acc.stuckJobs / acc.totalJobs : 0;
      const neverStartedRate = acc.totalJobs > 0 ? acc.neverStartedJobs / acc.totalJobs : 0;
      const statusUsagePercent = acc.completedJobs > 0
        ? Math.round(((acc.oowUsed + acc.startedUsed) / (acc.completedJobs * 2)) * 100 * 10) / 10
        : 0;
      const complianceScore = Math.round(
        (0.5 * onTimePercent + 0.3 * (1 - stuckRate) * 100 + 0.2 * (1 - neverStartedRate) * 100) * 10
      ) / 10;
      return {
        name,
        totalJobs: acc.totalJobs,
        completedJobs: acc.completedJobs,
        onTimeCompletions: acc.onTimeCompletions,
        lateCompletions: acc.lateCompletions,
        onTimePercent,
        stuckJobs: acc.stuckJobs,
        neverStartedJobs: acc.neverStartedJobs,
        avgDaysToComplete,
        avgDaysLate,
        onOurWayOnTime: acc.onOurWayOnTime,
        onOurWayLate: acc.onOurWayLate,
        onOurWayPercent,
        oowUsed: acc.oowUsed,
        startedUsed: acc.startedUsed,
        statusUsagePercent,
        complianceScore,
        grade: computeGrade(complianceScore),
        adjustedScore: 0, // computed after all groups are built
        adjustedGrade: "",
        userCount: acc.assignedUsers.size,
      };
    }

    function applyBayesianToGroups(groups: GroupComparison[]): void {
      if (groups.length === 0) return;
      const groupAvg = groups.reduce((s, g) => s + g.complianceScore, 0) / groups.length;
      for (const g of groups) {
        g.adjustedScore = Math.round(
          ((g.totalJobs * g.complianceScore + BAYESIAN_C * groupAvg) /
            (g.totalJobs + BAYESIAN_C)) * 10
        ) / 10;
        g.adjustedGrade = computeGrade(g.adjustedScore);
      }
    }

    const teamComparison: GroupComparison[] = Array.from(teamAccMap.entries())
      .map(([name, acc]) => buildGroupFromAcc(name, acc));
    applyBayesianToGroups(teamComparison);
    teamComparison.sort((a, b) => b.adjustedScore - a.adjustedScore);

    // ========== Category Comparison ==========
    // Re-aggregate jobs by category (not from user data, but from raw job data for accuracy)
    interface CategoryAccumulator {
      totalJobs: number;
      completedJobs: number;
      onTimeCompletions: number;
      lateCompletions: number;
      stuckJobs: number;
      neverStartedJobs: number;
      completionDays: number[];
      daysLatePastEnd: number[];
      onOurWayOnTime: number;
      onOurWayLate: number;
      oowUsed: number;
      startedUsed: number;
      assignedUsers: Set<string>;
    }
    const catAccMap = new Map<string, CategoryAccumulator>();

    for (const { job, categoryName } of allJobs) {
      const statusName = getStatusName(job);
      const statusLower = statusName.toLowerCase();
      const assignedUsers = extractAssignedUsers(job, assignmentOptions);

      if (assignedUsers.length === 0) continue;

      // Apply team filter if specified
      if (teamFilter) {
        const hasMatchingTeam = assignedUsers.some(
          (u) => u.teamNames.some((t) => t.toLowerCase().includes(teamFilter))
        );
        if (!hasMatchingTeam) continue;
      }

      if (!catAccMap.has(categoryName)) {
        catAccMap.set(categoryName, {
          totalJobs: 0, completedJobs: 0, onTimeCompletions: 0, lateCompletions: 0,
          stuckJobs: 0, neverStartedJobs: 0, completionDays: [], daysLatePastEnd: [],
          onOurWayOnTime: 0, onOurWayLate: 0, oowUsed: 0, startedUsed: 0,
          assignedUsers: new Set(),
        });
      }
      const catAcc = catAccMap.get(categoryName)!;
      catAcc.totalJobs++;
      for (const u of assignedUsers) catAcc.assignedUsers.add(u.userUid);

      const scheduledStart = job.scheduled_start_time ? new Date(job.scheduled_start_time) : null;
      const scheduledEnd = job.scheduled_end_time ? new Date(job.scheduled_end_time) : null;
      const completedTime = getCompletedTimeFromHistory(job);
      const onOurWayTime = getOnOurWayTime(job);
      const usedStarted = hasStartedStatus(job);
      const effectiveCompletedTime = completedTime || scheduledEnd;

      if (COMPLETED_STATUSES.has(statusLower)) {
        catAcc.completedJobs++;
        if (scheduledEnd && effectiveCompletedTime) {
          const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
          if (effectiveCompletedTime <= deadline) {
            catAcc.onTimeCompletions++;
          } else {
            catAcc.lateCompletions++;
          }
          if (effectiveCompletedTime > scheduledEnd) {
            const diffMs = effectiveCompletedTime.getTime() - scheduledEnd.getTime();
            catAcc.daysLatePastEnd.push(Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10);
          }
        } else {
          catAcc.onTimeCompletions++;
        }
        if (scheduledStart && effectiveCompletedTime && effectiveCompletedTime > scheduledStart) {
          const diffMs = effectiveCompletedTime.getTime() - scheduledStart.getTime();
          catAcc.completionDays.push(Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10);
        }
        if (onOurWayTime && scheduledStart) {
          if (scheduledEnd && onOurWayTime > scheduledEnd) {
            catAcc.onOurWayLate++;
          } else {
            catAcc.onOurWayOnTime++;
          }
        }
        if (onOurWayTime) catAcc.oowUsed++;
        if (usedStarted) catAcc.startedUsed++;
      }
      if (STUCK_STATUSES.has(statusLower) && scheduledEnd && scheduledEnd < now) {
        catAcc.stuckJobs++;
      }
      if (NEVER_STARTED_STATUSES.has(statusLower) && scheduledStart && scheduledStart < now) {
        catAcc.neverStartedJobs++;
      }
    }

    const categoryComparison: GroupComparison[] = Array.from(catAccMap.entries())
      .map(([name, acc]) => buildGroupFromAcc(name, acc));
    applyBayesianToGroups(categoryComparison);
    categoryComparison.sort((a, b) => b.adjustedScore - a.adjustedScore);

    // Compute summary from unique jobs (not user-attributed rows) to avoid
    // inflation from multi-assigned jobs.
    const summaryAcc = {
      totalJobs: 0,
      totalCompleted: 0,
      totalOnTime: 0,
      totalStuck: 0,
      totalNeverStarted: 0,
      completionDays: [] as number[],
      daysLatePastEnd: [] as number[],
      totalOnOurWayOnTime: 0,
      totalOnOurWayLate: 0,
    };

    for (const { job } of allJobs) {
      const statusLower = getStatusName(job).toLowerCase();
      const assignedUsers = extractAssignedUsers(job, assignmentOptions);
      if (assignedUsers.length === 0) continue;

      if (teamFilter) {
        const hasMatchingTeam = assignedUsers.some((u) =>
          u.teamNames.some((t) => t.toLowerCase().includes(teamFilter))
        );
        if (!hasMatchingTeam) continue;
      }

      summaryAcc.totalJobs++;

      const scheduledStart = job.scheduled_start_time ? new Date(job.scheduled_start_time) : null;
      const scheduledEnd = job.scheduled_end_time ? new Date(job.scheduled_end_time) : null;
      const completedTime = getCompletedTimeFromHistory(job);
      const onOurWayTime = getOnOurWayTime(job);
      const effectiveCompletedTime = completedTime || scheduledEnd;

      if (COMPLETED_STATUSES.has(statusLower)) {
        summaryAcc.totalCompleted++;
        if (scheduledEnd && effectiveCompletedTime) {
          const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
          if (effectiveCompletedTime <= deadline) {
            summaryAcc.totalOnTime++;
          } else if (effectiveCompletedTime > scheduledEnd) {
            const diffMs = effectiveCompletedTime.getTime() - scheduledEnd.getTime();
            summaryAcc.daysLatePastEnd.push(
              Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10
            );
          }
        } else {
          summaryAcc.totalOnTime++;
        }

        if (scheduledStart && effectiveCompletedTime && effectiveCompletedTime > scheduledStart) {
          const diffMs = effectiveCompletedTime.getTime() - scheduledStart.getTime();
          summaryAcc.completionDays.push(
            Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10
          );
        }

        if (onOurWayTime && scheduledStart) {
          if (scheduledEnd && onOurWayTime > scheduledEnd) {
            summaryAcc.totalOnOurWayLate++;
          } else {
            summaryAcc.totalOnOurWayOnTime++;
          }
        }
      }

      if (STUCK_STATUSES.has(statusLower) && scheduledEnd && scheduledEnd < now) {
        summaryAcc.totalStuck++;
      }
      if (NEVER_STARTED_STATUSES.has(statusLower) && scheduledStart && scheduledStart < now) {
        summaryAcc.totalNeverStarted++;
      }
    }

    const totalOnOurWayTotal =
      summaryAcc.totalOnOurWayOnTime + summaryAcc.totalOnOurWayLate;

    const summary: ComplianceSummary = {
      totalJobs: summaryAcc.totalJobs,
      totalCompleted: summaryAcc.totalCompleted,
      overallOnTimePercent:
        summaryAcc.totalCompleted > 0
          ? Math.round((summaryAcc.totalOnTime / summaryAcc.totalCompleted) * 100 * 10) / 10
          : 0,
      totalStuck: summaryAcc.totalStuck,
      totalNeverStarted: summaryAcc.totalNeverStarted,
      avgCompletionDays:
        summaryAcc.completionDays.length > 0
          ? Math.round(
              (summaryAcc.completionDays.reduce((sum, d) => sum + d, 0) /
                summaryAcc.completionDays.length) *
                10
            ) / 10
          : 0,
      avgDaysLate:
        summaryAcc.daysLatePastEnd.length > 0
          ? Math.round(
              (summaryAcc.daysLatePastEnd.reduce((sum, d) => sum + d, 0) /
                summaryAcc.daysLatePastEnd.length) *
                10
            ) / 10
          : 0,
      overallOnOurWayPercent:
        totalOnOurWayTotal > 0
          ? Math.round((summaryAcc.totalOnOurWayOnTime / totalOnOurWayTotal) * 100 * 10) / 10
          : 0,
      userCount: users.length,
    };

    const response = {
      users,
      summary,
      teamComparison,
      categoryComparison,
      filters: {
        teams: Array.from(teamsSet).sort(),
        categories: Array.from(categoriesSet).sort(),
      },
      scoring: {
        minJobs,
        bayesianC: BAYESIAN_C,
        globalAvgScore: Math.round(globalAvgScore * 10) / 10,
      },
      dateRange: {
        from: fromDateStr,
        to: toDateStr,
        days,
      },
      lastUpdated: new Date().toISOString(),
      dataQuality: {
        totalJobsFetched: allJobs.length,
        unassignedJobs: unassignedJobCount,
        filteredOutByTeam,
        categoriesFetched: categoriesToFetch.length,
        totalCategories: allCategoryEntries.length,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[compliance] Error:", error);
    return NextResponse.json(
      { error: "Failed to compute compliance metrics" },
      { status: 500 }
    );
  }
}
