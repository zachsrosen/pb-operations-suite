import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireApiAuth } from "@/lib/api-auth";
import { tagSentryRequest } from "@/lib/sentry-request";
import { JOB_CATEGORIES, JOB_CATEGORY_UIDS, zuper } from "@/lib/zuper";
import { getActiveCrewMembers } from "@/lib/db";
import {
  COMPLIANCE_EXCLUDED_USER_UIDS,
  COMPLIANCE_TEAM_OVERRIDES,
} from "@/lib/compliance-team-overrides";
import {
  STUCK_STATUSES,
  NEVER_STARTED_STATUSES,
  COMPLETED_STATUSES,
  GRACE_MS,
  CATEGORY_UID_TO_NAME,
  getStatusName,
  getCompletedTimeFromHistory,
  getOnOurWayTime,
  getStartedTime,
  extractAssignedUsers,
  filterAssignedUsersByTeam,
  computeGrade,
  fetchJobsForCategory,
} from "@/lib/compliance-helpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ========== Types ==========

interface JobEntry {
  jobUid: string;
  title: string;
  status: string;
  category: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  completedTime: string | null;
  startedTime: string | null;
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
  unknownCompletionJobs: number;
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
  startedOnTime: number;
  startedLate: number;
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
  unknownCompletionJobsList: JobEntry[];
}

interface ComplianceSummary {
  totalJobs: number;
  totalCompleted: number;
  unknownCompletionJobs: number;
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
  unknownCompletionJobs: number;
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
  startedOnTime: number;
  startedLate: number;
  statusUsagePercent: number;
  complianceScore: number;
  grade: string;
  adjustedScore: number;
  adjustedGrade: string;
  userCount: number;
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
  tagSentryRequest(request);
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
      unknownCompletionJobs: number;
      stuckJobs: number;
      neverStartedJobs: number;
      completionDays: number[];
      daysLatePastEnd: number[];
      onOurWayOnTime: number;
      onOurWayLate: number;
      onOurWayTotal: number;
      oowUsed: number;      // completed jobs that used OOW
      startedUsed: number;  // completed jobs that used Started
      startedOnTime: number;
      startedLate: number;
      byCategory: CategoryBreakdown;
      stuckJobsList: JobEntry[];
      lateJobsList: JobEntry[];
      neverStartedJobsList: JobEntry[];
      completedJobsList: JobEntry[];
      unknownCompletionJobsList: JobEntry[];
    }

    const userMap = new Map<string, UserAccumulator>();
    let unassignedJobCount = 0;
    let filteredOutByTeam = 0;

    for (const { job, categoryName } of allJobs) {
      const statusName = getStatusName(job);
      const statusLower = statusName.toLowerCase();
      const assignedUsers = extractAssignedUsers(job, assignmentOptions);
      const filteredAssignedUsers = filterAssignedUsersByTeam(assignedUsers, teamFilter);

      // Track filter options
      categoriesSet.add(categoryName);
      for (const u of filteredAssignedUsers) {
        for (const t of u.teamNames) teamsSet.add(t);
      }

      // Skip unassigned jobs
      if (filteredAssignedUsers.length === 0) {
        if (teamFilter && assignedUsers.length > 0) {
          filteredOutByTeam++;
        } else {
          unassignedJobCount++;
        }
        continue;
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
      // Extract when "Started" was triggered
      const startedTime = getStartedTime(job);
      const usedStarted = startedTime !== null;

      // Attribute job to each assigned user
      for (const { userUid, userName, teamNames: jobTeams } of filteredAssignedUsers) {
        if (!userMap.has(userUid)) {
          userMap.set(userUid, {
            userUid,
            userName,
            teamNames: new Set(jobTeams),
            totalJobs: 0,
            completedJobs: 0,
            onTimeCompletions: 0,
            lateCompletions: 0,
            unknownCompletionJobs: 0,
            stuckJobs: 0,
            neverStartedJobs: 0,
            completionDays: [],
            daysLatePastEnd: [],
            onOurWayOnTime: 0,
            onOurWayLate: 0,
            onOurWayTotal: 0,
            oowUsed: 0,
            startedUsed: 0,
            startedOnTime: 0,
            startedLate: 0,
            byCategory: {},
            stuckJobsList: [],
            lateJobsList: [],
            neverStartedJobsList: [],
            completedJobsList: [],
            unknownCompletionJobsList: [],
          });
        }
        const acc = userMap.get(userUid)!;

        // Track all teams this user appears on
        for (const t of jobTeams) acc.teamNames.add(t);

        acc.totalJobs++;
        acc.byCategory[categoryName] = (acc.byCategory[categoryName] || 0) + 1;

        // Build reusable detail fields once
        const baseJobEntry = {
          jobUid: job.job_uid || "",
          title: job.job_title || "",
          status: statusName,
          category: categoryName,
          scheduledStart: job.scheduled_start_time || null,
          scheduledEnd: job.scheduled_end_time || null,
          startedTime: startedTime?.toISOString() || null,
        };

        let jobDaysToComplete: number | null = null;
        let jobDaysLate: number | null = null;
        let jobOowOnTime: boolean | null = null;

        // Check if completed
        if (COMPLETED_STATUSES.has(statusLower)) {
          acc.completedJobs++;

          // On-time check: completed within scheduled_end + 1 day grace
          let isLate = false;
          if (scheduledEnd && completedTime) {
            const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
            if (completedTime <= deadline) {
              acc.onTimeCompletions++;
            } else {
              acc.lateCompletions++;
              isLate = true;
            }

            // Days past scheduled end
            if (completedTime > scheduledEnd) {
              const diffMs = completedTime.getTime() - scheduledEnd.getTime();
              jobDaysLate = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10;
              acc.daysLatePastEnd.push(jobDaysLate);
            }
          } else if (!completedTime) {
            acc.unknownCompletionJobs++;
            const unknownEntry: JobEntry = {
              ...baseJobEntry,
              completedTime: null,
              daysToComplete: null,
              daysLate: null,
              onOurWayTime: onOurWayTime?.toISOString() || null,
              onOurWayOnTime: null,
            };
            acc.unknownCompletionJobsList.push(unknownEntry);
          } else {
            acc.onTimeCompletions++;
          }

          // Days to complete: scheduled_start to completion
          if (scheduledStart && completedTime && completedTime > scheduledStart) {
            const diffMs = completedTime.getTime() - scheduledStart.getTime();
            jobDaysToComplete = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10;
            acc.completionDays.push(jobDaysToComplete);
          }

          // "On Our Way" compliance
          if (onOurWayTime && scheduledStart) {
            acc.onOurWayTotal++;
            if (onOurWayTime > scheduledStart) {
              acc.onOurWayLate++;
              jobOowOnTime = false;
            } else {
              acc.onOurWayOnTime++;
              jobOowOnTime = true;
            }
          }

          if (startedTime && scheduledStart && scheduledEnd) {
            if (startedTime <= scheduledEnd) {
              acc.startedOnTime++;
            } else {
              acc.startedLate++;
            }
          }

          // Track OOW and Started usage (did the user use these statuses at all?)
          if (onOurWayTime) acc.oowUsed++;
          if (usedStarted) acc.startedUsed++;

          // Build completed job entry
          const completedEntry: JobEntry = {
            ...baseJobEntry,
            completedTime: completedTime?.toISOString() || null,
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
            ...baseJobEntry,
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
            ...baseJobEntry,
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

      // Compliance score: onTime% − stuck% − neverStarted% (floor 0)
      const stuckRate = acc.totalJobs > 0 ? acc.stuckJobs / acc.totalJobs : 0;
      const neverStartedRate =
        acc.totalJobs > 0 ? acc.neverStartedJobs / acc.totalJobs : 0;

      const complianceScore = Math.max(
        0,
        Math.round(
          (onTimePercent - stuckRate * 100 - neverStartedRate * 100) * 10
        ) / 10
      );

      const grade = computeGrade(complianceScore);

      users.push({
        userUid: acc.userUid,
        userName: acc.userName,
        teamName: acc.teamNames.size > 0 ? Array.from(acc.teamNames).sort().join(", ") : null,
        totalJobs: acc.totalJobs,
        completedJobs: acc.completedJobs,
        onTimeCompletions: acc.onTimeCompletions,
        lateCompletions: acc.lateCompletions,
        unknownCompletionJobs: acc.unknownCompletionJobs,
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
        startedOnTime: acc.startedOnTime,
        startedLate: acc.startedLate,
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
        unknownCompletionJobsList: acc.unknownCompletionJobsList,
      });
    }

    // No Bayesian adjustment — raw scores used directly.
    // adjustedScore = complianceScore (kept for API compat)
    const BAYESIAN_C = 0;
    for (const u of users) {
      u.adjustedScore = u.complianceScore;
      u.adjustedGrade = u.grade;
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
      unknownCompletionJobs: number;
      stuckJobs: number;
      neverStartedJobs: number;
      completionDays: number[];
      daysLatePastEnd: number[];
      onOurWayOnTime: number;
      onOurWayLate: number;
      oowUsed: number;
      startedUsed: number;
      startedOnTime: number;
      startedLate: number;
      assignedUsers: Set<string>;
    }
    const teamAccMap = new Map<string, TeamAccumulator>();

    for (const { job } of allJobs) {
      const statusName = getStatusName(job);
      const statusLower = statusName.toLowerCase();
      const assignedUsers = extractAssignedUsers(job, assignmentOptions);
      const filteredAssignedUsers = filterAssignedUsersByTeam(assignedUsers, teamFilter);

      if (filteredAssignedUsers.length === 0) continue;

      // Determine which teams this job belongs to
      const jobTeams = new Set<string>();
      for (const u of filteredAssignedUsers) {
        for (const t of u.teamNames) jobTeams.add(t);
      }
      if (jobTeams.size === 0) jobTeams.add("Unassigned");

      const scheduledStart = job.scheduled_start_time ? new Date(job.scheduled_start_time) : null;
      const scheduledEnd = job.scheduled_end_time ? new Date(job.scheduled_end_time) : null;
      const completedTime = getCompletedTimeFromHistory(job);
      const onOurWayTime = getOnOurWayTime(job);
      const startedTime = getStartedTime(job);
      const usedStarted = startedTime !== null;

      // Attribute this job once per team (not per user)
      for (const team of jobTeams) {
        if (!teamAccMap.has(team)) {
          teamAccMap.set(team, {
            totalJobs: 0, completedJobs: 0, onTimeCompletions: 0, lateCompletions: 0,
            unknownCompletionJobs: 0,
            stuckJobs: 0, neverStartedJobs: 0, completionDays: [], daysLatePastEnd: [],
            onOurWayOnTime: 0, onOurWayLate: 0, oowUsed: 0, startedUsed: 0,
            startedOnTime: 0, startedLate: 0,
            assignedUsers: new Set(),
          });
        }
        const tAcc = teamAccMap.get(team)!;
        tAcc.totalJobs++;
        // Count only users who are actually mapped to this team for userCount.
        // Previous behavior added all assigned users for every team on the job,
        // inflating counts when multi-team jobs were present.
        for (const u of filteredAssignedUsers) {
          const belongsToTeam =
            team === "Unassigned"
              ? u.teamNames.length === 0
              : u.teamNames.includes(team);
          if (belongsToTeam) tAcc.assignedUsers.add(u.userUid);
        }

        if (COMPLETED_STATUSES.has(statusLower)) {
          tAcc.completedJobs++;
          if (scheduledEnd && completedTime) {
            const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
            if (completedTime <= deadline) {
              tAcc.onTimeCompletions++;
            } else {
              tAcc.lateCompletions++;
            }
            if (completedTime > scheduledEnd) {
              const diffMs = completedTime.getTime() - scheduledEnd.getTime();
              tAcc.daysLatePastEnd.push(Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10);
            }
          } else if (!completedTime) {
            tAcc.unknownCompletionJobs++;
          } else {
            tAcc.onTimeCompletions++;
          }
          if (scheduledStart && completedTime && completedTime > scheduledStart) {
            const diffMs = completedTime.getTime() - scheduledStart.getTime();
            tAcc.completionDays.push(Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10);
          }
          if (onOurWayTime && scheduledStart) {
            if (onOurWayTime > scheduledStart) {
              tAcc.onOurWayLate++;
            } else {
              tAcc.onOurWayOnTime++;
            }
          }
          if (startedTime && scheduledStart && scheduledEnd) {
            if (startedTime <= scheduledEnd) {
              tAcc.startedOnTime++;
            } else {
              tAcc.startedLate++;
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
    function buildGroupFromAcc(name: string, acc: { totalJobs: number; completedJobs: number; onTimeCompletions: number; lateCompletions: number; unknownCompletionJobs: number; stuckJobs: number; neverStartedJobs: number; completionDays: number[]; daysLatePastEnd: number[]; onOurWayOnTime: number; onOurWayLate: number; oowUsed: number; startedUsed: number; startedOnTime: number; startedLate: number; assignedUsers: Set<string> }): GroupComparison {
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
      // Score = onTime% − stuck% − neverStarted% (floor 0)
      const complianceScore = Math.max(
        0,
        Math.round(
          (onTimePercent - stuckRate * 100 - neverStartedRate * 100) * 10
        ) / 10
      );
      return {
        name,
        totalJobs: acc.totalJobs,
        completedJobs: acc.completedJobs,
        onTimeCompletions: acc.onTimeCompletions,
        lateCompletions: acc.lateCompletions,
        unknownCompletionJobs: acc.unknownCompletionJobs,
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
        startedOnTime: acc.startedOnTime,
        startedLate: acc.startedLate,
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
      // No Bayesian adjustment — use raw scores directly
      for (const g of groups) {
        g.adjustedScore = g.complianceScore;
        g.adjustedGrade = g.grade;
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
      unknownCompletionJobs: number;
      stuckJobs: number;
      neverStartedJobs: number;
      completionDays: number[];
      daysLatePastEnd: number[];
      onOurWayOnTime: number;
      onOurWayLate: number;
      oowUsed: number;
      startedUsed: number;
      startedOnTime: number;
      startedLate: number;
      assignedUsers: Set<string>;
    }
    const catAccMap = new Map<string, CategoryAccumulator>();

    for (const { job, categoryName } of allJobs) {
      const statusName = getStatusName(job);
      const statusLower = statusName.toLowerCase();
      const assignedUsers = extractAssignedUsers(job, assignmentOptions);
      const filteredAssignedUsers = filterAssignedUsersByTeam(assignedUsers, teamFilter);

      if (filteredAssignedUsers.length === 0) continue;

      if (!catAccMap.has(categoryName)) {
        catAccMap.set(categoryName, {
          totalJobs: 0, completedJobs: 0, onTimeCompletions: 0, lateCompletions: 0,
          unknownCompletionJobs: 0,
          stuckJobs: 0, neverStartedJobs: 0, completionDays: [], daysLatePastEnd: [],
          onOurWayOnTime: 0, onOurWayLate: 0, oowUsed: 0, startedUsed: 0,
          startedOnTime: 0, startedLate: 0,
          assignedUsers: new Set(),
        });
      }
      const catAcc = catAccMap.get(categoryName)!;
      catAcc.totalJobs++;
      for (const u of filteredAssignedUsers) catAcc.assignedUsers.add(u.userUid);

      const scheduledStart = job.scheduled_start_time ? new Date(job.scheduled_start_time) : null;
      const scheduledEnd = job.scheduled_end_time ? new Date(job.scheduled_end_time) : null;
      const completedTime = getCompletedTimeFromHistory(job);
      const onOurWayTime = getOnOurWayTime(job);
      const startedTime = getStartedTime(job);
      const usedStarted = startedTime !== null;

      if (COMPLETED_STATUSES.has(statusLower)) {
        catAcc.completedJobs++;
        if (scheduledEnd && completedTime) {
          const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
          if (completedTime <= deadline) {
            catAcc.onTimeCompletions++;
          } else {
            catAcc.lateCompletions++;
          }
          if (completedTime > scheduledEnd) {
            const diffMs = completedTime.getTime() - scheduledEnd.getTime();
            catAcc.daysLatePastEnd.push(Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10);
          }
        } else if (!completedTime) {
          catAcc.unknownCompletionJobs++;
        } else {
          catAcc.onTimeCompletions++;
        }
        if (scheduledStart && completedTime && completedTime > scheduledStart) {
          const diffMs = completedTime.getTime() - scheduledStart.getTime();
          catAcc.completionDays.push(Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10);
        }
        if (onOurWayTime && scheduledStart) {
          if (onOurWayTime > scheduledStart) {
            catAcc.onOurWayLate++;
          } else {
            catAcc.onOurWayOnTime++;
          }
        }
        if (startedTime && scheduledStart && scheduledEnd) {
          if (startedTime <= scheduledEnd) {
            catAcc.startedOnTime++;
          } else {
            catAcc.startedLate++;
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

    // ========== Crew Composition Comparison ==========
    // Group jobs by their full set of assigned users (2+ person crews only).
    // Solo jobs are already covered by the per-user table.
    const crewCompAccMap = new Map<string, TeamAccumulator>();

    for (const { job } of allJobs) {
      const statusName = getStatusName(job);
      const statusLower = statusName.toLowerCase();
      const assignedUsers = extractAssignedUsers(job, assignmentOptions);
      const filteredAssignedUsers = filterAssignedUsersByTeam(assignedUsers, teamFilter);

      // Only multi-person crews
      if (filteredAssignedUsers.length < 2) continue;

      // Create crew composition key from sorted user names
      const crewKey = filteredAssignedUsers
        .map((u) => u.userName)
        .sort()
        .join(" + ");

      if (!crewCompAccMap.has(crewKey)) {
        crewCompAccMap.set(crewKey, {
          totalJobs: 0, completedJobs: 0, onTimeCompletions: 0, lateCompletions: 0,
          unknownCompletionJobs: 0,
          stuckJobs: 0, neverStartedJobs: 0, completionDays: [], daysLatePastEnd: [],
          onOurWayOnTime: 0, onOurWayLate: 0, oowUsed: 0, startedUsed: 0,
          startedOnTime: 0, startedLate: 0,
          assignedUsers: new Set(),
        });
      }
      const crewAcc = crewCompAccMap.get(crewKey)!;
      crewAcc.totalJobs++;
      for (const u of filteredAssignedUsers) crewAcc.assignedUsers.add(u.userUid);

      const scheduledStart = job.scheduled_start_time ? new Date(job.scheduled_start_time) : null;
      const scheduledEnd = job.scheduled_end_time ? new Date(job.scheduled_end_time) : null;
      const completedTime = getCompletedTimeFromHistory(job);
      const onOurWayTime = getOnOurWayTime(job);
      const startedTime = getStartedTime(job);
      const usedStarted = startedTime !== null;

      if (COMPLETED_STATUSES.has(statusLower)) {
        crewAcc.completedJobs++;
        if (scheduledEnd && completedTime) {
          const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
          if (completedTime <= deadline) {
            crewAcc.onTimeCompletions++;
          } else {
            crewAcc.lateCompletions++;
          }
          if (completedTime > scheduledEnd) {
            const diffMs = completedTime.getTime() - scheduledEnd.getTime();
            crewAcc.daysLatePastEnd.push(Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10);
          }
        } else if (!completedTime) {
          crewAcc.unknownCompletionJobs++;
        } else {
          crewAcc.onTimeCompletions++;
        }
        if (scheduledStart && completedTime && completedTime > scheduledStart) {
          const diffMs = completedTime.getTime() - scheduledStart.getTime();
          crewAcc.completionDays.push(Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10);
        }
        if (onOurWayTime && scheduledStart) {
          if (onOurWayTime > scheduledStart) {
            crewAcc.onOurWayLate++;
          } else {
            crewAcc.onOurWayOnTime++;
          }
        }
        if (startedTime && scheduledStart && scheduledEnd) {
          if (startedTime <= scheduledEnd) {
            crewAcc.startedOnTime++;
          } else {
            crewAcc.startedLate++;
          }
        }
        if (onOurWayTime) crewAcc.oowUsed++;
        if (usedStarted) crewAcc.startedUsed++;
      }
      if (STUCK_STATUSES.has(statusLower) && scheduledEnd && scheduledEnd < now) {
        crewAcc.stuckJobs++;
      }
      if (NEVER_STARTED_STATUSES.has(statusLower) && scheduledStart && scheduledStart < now) {
        crewAcc.neverStartedJobs++;
      }
    }

    const crewComposition: GroupComparison[] = Array.from(crewCompAccMap.entries())
      .map(([name, acc]) => buildGroupFromAcc(name, acc));
    applyBayesianToGroups(crewComposition);
    crewComposition.sort((a, b) => b.adjustedScore - a.adjustedScore);

    // Compute summary from unique jobs (not user-attributed rows) to avoid
    // inflation from multi-assigned jobs.
    const summaryAcc = {
      totalJobs: 0,
      totalCompleted: 0,
      totalOnTime: 0,
      totalLate: 0,
      unknownCompletionJobs: 0,
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
      const filteredAssignedUsers = filterAssignedUsersByTeam(assignedUsers, teamFilter);
      if (filteredAssignedUsers.length === 0) continue;

      summaryAcc.totalJobs++;

      const scheduledStart = job.scheduled_start_time ? new Date(job.scheduled_start_time) : null;
      const scheduledEnd = job.scheduled_end_time ? new Date(job.scheduled_end_time) : null;
      const completedTime = getCompletedTimeFromHistory(job);
      const onOurWayTime = getOnOurWayTime(job);

      if (COMPLETED_STATUSES.has(statusLower)) {
        summaryAcc.totalCompleted++;
        if (scheduledEnd && completedTime) {
          const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
          if (completedTime <= deadline) {
            summaryAcc.totalOnTime++;
          } else if (completedTime > scheduledEnd) {
            summaryAcc.totalLate++;
            const diffMs = completedTime.getTime() - scheduledEnd.getTime();
            summaryAcc.daysLatePastEnd.push(
              Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10
            );
          }
        } else if (!completedTime) {
          summaryAcc.unknownCompletionJobs++;
        } else {
          summaryAcc.totalOnTime++;
        }

        if (scheduledStart && completedTime && completedTime > scheduledStart) {
          const diffMs = completedTime.getTime() - scheduledStart.getTime();
          summaryAcc.completionDays.push(
            Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10
          );
        }

        if (onOurWayTime && scheduledStart) {
          if (onOurWayTime > scheduledStart) {
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
    const measurableCompletions = summaryAcc.totalOnTime + summaryAcc.totalLate;

    const summary: ComplianceSummary = {
      totalJobs: summaryAcc.totalJobs,
      totalCompleted: summaryAcc.totalCompleted,
      unknownCompletionJobs: summaryAcc.unknownCompletionJobs,
      overallOnTimePercent:
        measurableCompletions > 0
          ? Math.round((summaryAcc.totalOnTime / measurableCompletions) * 100 * 10) / 10
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
      crewComposition,
      filters: {
        teams: Array.from(teamsSet).sort(),
        categories: Array.from(categoriesSet).sort(),
      },
      scoring: {
        minJobs,
        bayesianC: BAYESIAN_C,
        formula: "onTime% - stuck% - neverStarted%",
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
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "Failed to compute compliance metrics" },
      { status: 500 }
    );
  }
}
