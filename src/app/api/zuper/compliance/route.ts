import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper, JOB_CATEGORY_UIDS, JOB_CATEGORIES } from "@/lib/zuper";

// ========== Types ==========

interface StaleJobEntry {
  jobUid: string;
  title: string;
  status: string;
  scheduledEnd: string | null;
  category: string;
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
  staleJobs: number;
  neverStartedJobs: number;
  avgDaysToComplete: number;
  complianceScore: number;
  grade: string;
  byCategory: CategoryBreakdown;
  staleJobsList: StaleJobEntry[];
}

interface ComplianceSummary {
  totalJobs: number;
  totalCompleted: number;
  overallOnTimePercent: number;
  totalStale: number;
  totalNeverStarted: number;
  avgCompletionDays: number;
  userCount: number;
}

interface ComplianceResponse {
  users: UserMetrics[];
  summary: ComplianceSummary;
  filters: {
    teams: string[];
    categories: string[];
  };
  dateRange: {
    from: string;
    to: string;
    days: number;
  };
  lastUpdated: string;
}

// ========== Constants ==========

// Statuses that indicate a job is "in progress" but may be stale
const STALE_STATUSES = new Set(
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
  ].map((s) => s.toLowerCase())
);

// 1 day grace period in milliseconds
const GRACE_MS = 24 * 60 * 60 * 1000;

// Max pages to fetch per category (safety cap)
const MAX_PAGES_PER_CATEGORY = 20;

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
 * Get current status name from a job, lowercased.
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
 * Extract assigned users from a job. Returns array of { userUid, userName, teamName }.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAssignedUsers(job: any): Array<{
  userUid: string;
  userName: string;
  teamName: string | null;
}> {
  const users: Array<{ userUid: string; userName: string; teamName: string | null }> = [];

  // Extract team name
  let teamName: string | null = null;
  if (Array.isArray(job.assigned_to_team)) {
    for (const t of job.assigned_to_team) {
      if (typeof t === "object" && t !== null) {
        const tm = t.team;
        if (typeof tm === "object" && tm !== null) {
          teamName = tm.team_name || null;
          break;
        }
      }
    }
  }

  if (!Array.isArray(job.assigned_to)) return users;

  for (const a of job.assigned_to) {
    if (typeof a !== "object" || a === null) continue;
    const user = a.user || a;
    if (typeof user !== "object" || user === null) continue;
    const u = user as Record<string, string>;
    const userUid = u.user_uid;
    if (!userUid) continue;
    const userName = `${u.first_name || ""} ${u.last_name || ""}`.trim();
    if (!userName) continue;
    users.push({ userUid, userName, teamName });
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
 * and computes per-user compliance metrics including on-time rate, stale jobs,
 * never-started jobs, and an overall compliance score.
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

    // Collect unique teams and categories for filter options
    const teamsSet = new Set<string>();
    const categoriesSet = new Set<string>();

    // Group jobs by assigned user
    interface UserAccumulator {
      userUid: string;
      userName: string;
      teamName: string | null;
      totalJobs: number;
      completedJobs: number;
      onTimeCompletions: number;
      lateCompletions: number;
      staleJobs: number;
      neverStartedJobs: number;
      completionDays: number[]; // individual days-to-complete for averaging
      byCategory: CategoryBreakdown;
      staleJobsList: StaleJobEntry[];
    }

    const userMap = new Map<string, UserAccumulator>();

    for (const { job, categoryName } of allJobs) {
      const statusName = getStatusName(job);
      const statusLower = statusName.toLowerCase();
      const assignedUsers = extractAssignedUsers(job);

      // Track filter options
      categoriesSet.add(categoryName);
      for (const u of assignedUsers) {
        if (u.teamName) teamsSet.add(u.teamName);
      }

      // Skip unassigned jobs
      if (assignedUsers.length === 0) continue;

      // Apply team filter if specified
      if (teamFilter) {
        const hasMatchingTeam = assignedUsers.some(
          (u) => u.teamName && u.teamName.toLowerCase().includes(teamFilter)
        );
        if (!hasMatchingTeam) continue;
      }

      const scheduledStart = job.scheduled_start_time
        ? new Date(job.scheduled_start_time)
        : null;
      const scheduledEnd = job.scheduled_end_time
        ? new Date(job.scheduled_end_time)
        : null;
      // Extract completion time from job_status history array, falling back
      // to direct fields, then scheduled_end_time as last resort
      const completedTime = getCompletedTimeFromHistory(job);

      // Attribute job to each assigned user
      for (const { userUid, userName, teamName } of assignedUsers) {
        if (!userMap.has(userUid)) {
          userMap.set(userUid, {
            userUid,
            userName,
            teamName,
            totalJobs: 0,
            completedJobs: 0,
            onTimeCompletions: 0,
            lateCompletions: 0,
            staleJobs: 0,
            neverStartedJobs: 0,
            completionDays: [],
            byCategory: {},
            staleJobsList: [],
          });
        }
        const acc = userMap.get(userUid)!;

        // Update team name if we have one and the accumulator doesn't
        if (!acc.teamName && teamName) acc.teamName = teamName;

        acc.totalJobs++;
        acc.byCategory[categoryName] = (acc.byCategory[categoryName] || 0) + 1;

        // Check if completed — count the job even if we don't have an exact
        // completion timestamp (Zuper list API often omits it)
        if (COMPLETED_STATUSES.has(statusLower)) {
          acc.completedJobs++;

          // Use completedTime if available, otherwise fall back to
          // scheduled_end_time as the best proxy for when work finished
          const effectiveCompletedTime = completedTime || scheduledEnd;

          // On-time check: completed within scheduled_end + 1 day grace
          if (scheduledEnd && effectiveCompletedTime) {
            const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
            if (effectiveCompletedTime <= deadline) {
              acc.onTimeCompletions++;
            } else {
              acc.lateCompletions++;
            }
          } else {
            // No scheduled end time, count as on-time (cannot measure)
            acc.onTimeCompletions++;
          }

          // Avg days to complete: scheduled_start to completed/scheduled_end
          if (scheduledStart && effectiveCompletedTime && effectiveCompletedTime > scheduledStart) {
            const diffMs = effectiveCompletedTime.getTime() - scheduledStart.getTime();
            const diffDays = diffMs / (1000 * 60 * 60 * 24);
            acc.completionDays.push(diffDays);
          }
        }

        // Check for stale jobs: in progress statuses with scheduled_end in the past
        if (STALE_STATUSES.has(statusLower) && scheduledEnd && scheduledEnd < now) {
          acc.staleJobs++;
          acc.staleJobsList.push({
            jobUid: job.job_uid || "",
            title: job.job_title || "",
            status: statusName,
            scheduledEnd: job.scheduled_end_time || null,
            category: categoryName,
          });
        }

        // Check for never-started jobs: pre-start statuses with scheduled_start in the past
        if (
          NEVER_STARTED_STATUSES.has(statusLower) &&
          scheduledStart &&
          scheduledStart < now
        ) {
          acc.neverStartedJobs++;
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

      // Compliance score:
      // 50% on-time rate + 30% (1 - staleRate) * 100 + 20% (1 - neverStartedRate) * 100
      const staleRate = acc.totalJobs > 0 ? acc.staleJobs / acc.totalJobs : 0;
      const neverStartedRate =
        acc.totalJobs > 0 ? acc.neverStartedJobs / acc.totalJobs : 0;

      const complianceScore =
        Math.round(
          (0.5 * onTimePercent +
            0.3 * (1 - staleRate) * 100 +
            0.2 * (1 - neverStartedRate) * 100) *
            10
        ) / 10;

      const grade = computeGrade(complianceScore);

      users.push({
        userUid: acc.userUid,
        userName: acc.userName,
        teamName: acc.teamName,
        totalJobs: acc.totalJobs,
        completedJobs: acc.completedJobs,
        onTimeCompletions: acc.onTimeCompletions,
        lateCompletions: acc.lateCompletions,
        onTimePercent,
        staleJobs: acc.staleJobs,
        neverStartedJobs: acc.neverStartedJobs,
        avgDaysToComplete,
        complianceScore,
        grade,
        byCategory: acc.byCategory,
        staleJobsList: acc.staleJobsList,
      });
    }

    // Sort by complianceScore ascending (worst first)
    users.sort((a, b) => a.complianceScore - b.complianceScore);

    // Compute summary
    const totalJobs = users.reduce((sum, u) => sum + u.totalJobs, 0);
    const totalCompleted = users.reduce((sum, u) => sum + u.completedJobs, 0);
    const totalOnTime = users.reduce((sum, u) => sum + u.onTimeCompletions, 0);
    const totalStale = users.reduce((sum, u) => sum + u.staleJobs, 0);
    const totalNeverStarted = users.reduce((sum, u) => sum + u.neverStartedJobs, 0);

    const allCompletionDays = users.flatMap((u) => {
      // Reconstruct individual completion days from the user's average and count
      // Since we only stored the average, use it directly weighted by completed count
      if (u.avgDaysToComplete > 0 && u.completedJobs > 0) {
        return Array(u.completedJobs).fill(u.avgDaysToComplete);
      }
      return [];
    });

    const overallOnTimePercent =
      totalCompleted > 0
        ? Math.round((totalOnTime / totalCompleted) * 100 * 10) / 10
        : 0;

    const avgCompletionDays =
      allCompletionDays.length > 0
        ? Math.round(
            (allCompletionDays.reduce((sum, d) => sum + d, 0) /
              allCompletionDays.length) *
              10
          ) / 10
        : 0;

    const summary: ComplianceSummary = {
      totalJobs,
      totalCompleted,
      overallOnTimePercent,
      totalStale,
      totalNeverStarted,
      avgCompletionDays,
      userCount: users.length,
    };

    const response: ComplianceResponse = {
      users,
      summary,
      filters: {
        teams: Array.from(teamsSet).sort(),
        categories: Array.from(categoriesSet).sort(),
      },
      dateRange: {
        from: fromDateStr,
        to: toDateStr,
        days,
      },
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[compliance] Error:", error);
    return NextResponse.json(
      { error: "Failed to compute compliance metrics", details: String(error) },
      { status: 500 }
    );
  }
}
