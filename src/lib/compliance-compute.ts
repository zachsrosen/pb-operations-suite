/**
 * Shared compliance computation — used by the office performance TV dashboard
 * to compute per-location, per-category compliance metrics from live Zuper data.
 *
 * Reuses helpers from compliance-helpers.ts so both the full compliance dashboard
 * and the TV carousel use identical status lists, grace period, and scoring logic.
 */

import { getActiveCrewMembers, prisma } from "@/lib/db";
import {
  COMPLIANCE_EXCLUDED_USER_UIDS,
  COMPLIANCE_TEAM_OVERRIDES,
} from "@/lib/compliance-team-overrides";
import {
  STUCK_STATUSES,
  NEVER_STARTED_STATUSES,
  COMPLETED_STATUSES,
  GRACE_MS,
  getStatusName,
  getCompletedTimeFromHistory,
  getOnOurWayTime,
  getStartedTime,
  extractAssignedUsers,
  filterAssignedUsersByTeam,
  computeGrade,
  fetchJobsForCategory,
  extractHubspotDealIdFromJob,
  type AssignedUser,
} from "@/lib/compliance-helpers";
import { JOB_CATEGORY_UIDS } from "@/lib/zuper";
import { normalizeLocation } from "@/lib/locations";

// ========== Types ==========

export interface EmployeeComplianceFull {
  name: string;
  totalJobs: number;
  completedJobs: number;
  onTimePercent: number;    // -1 if no measurable jobs
  measurableCount: number;
  lateCount: number;
  stuckCount: number;
  neverStartedCount: number;
  avgDaysToComplete: number;
  avgDaysLate: number;
  /** % of completed jobs where the tech used the On Our Way status at all (customer notification). -1 if no completed jobs. */
  oowUsagePercent: number;
  /** % of OOW-used jobs where the OOW timestamp was before scheduledStart (punctuality). -1 if never used. */
  oowOnTimePercent: number;
  statusUsagePercent: number;
  complianceScore: number;
  grade: string;
}

export interface ComplianceSummaryFull {
  totalJobs: number;
  completedJobs: number;
  onTimePercent: number;
  stuckCount: number;
  neverStartedCount: number;
  avgDaysToComplete: number;
  avgDaysLate: number;
  /** % of completed jobs where OOW status was used (customer notification). -1 if no completed jobs. */
  oowUsagePercent: number;
  /** % of OOW-used jobs where the tech left on-time. -1 if never used. */
  oowOnTimePercent: number;
  /** Aggregate compliance score: onTime% - stuck% - neverStarted% (floor 0) */
  aggregateScore: number;
  /** Letter grade from aggregateScore */
  aggregateGrade: string;
}

export interface LocationComplianceResult {
  summary: ComplianceSummaryFull;
  byEmployee: EmployeeComplianceFull[];
  stuckJobs: { name: string; assignedUser?: string; daysSinceScheduled?: number }[];
}

// ========== Location → team filter mapping ==========

const LOCATION_TEAM_FILTERS: Record<string, string> = {
  Westminster: "westminster",
  Centennial: "centennial",
  DTC: "centennial", // DTC crew is part of Centennial team
  "Colorado Springs": "colorado springs",
  "San Luis Obispo": "san luis obispo",
  Camarillo: "san luis obispo", // Camarillo crew is part of SLO team
};

// ========== Category name → UID mapping ==========

const CATEGORY_NAME_TO_UID: Record<string, string> = {
  "Site Survey": JOB_CATEGORY_UIDS.SITE_SURVEY,
  Construction: JOB_CATEGORY_UIDS.CONSTRUCTION,
  Inspection: JOB_CATEGORY_UIDS.INSPECTION,
};

// ========== Core computation ==========

/**
 * Compute compliance metrics for a single job category at a specific location.
 * Fetches from the live Zuper API, filters by location (team), and returns
 * per-employee metrics + aggregate summary.
 *
 * @param locationDealIds — when provided, jobs whose HubSpot deal ID is in
 *   this set are attributed to this location regardless of the tech's team.
 *   This is more reliable than the HubSpotProjectCache fallback, which may
 *   be stale or empty.
 */
export async function computeLocationCompliance(
  categoryName: string,
  location: string,
  days: number = 30,
  locationDealIds?: Set<string>
): Promise<LocationComplianceResult | null> {
  const categoryUid = CATEGORY_NAME_TO_UID[categoryName];
  if (!categoryUid) return null;

  const teamFilter = LOCATION_TEAM_FILTERS[location] || location.toLowerCase();

  // Date range
  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - days);
  const fromDateStr = fromDate.toISOString().split("T")[0];
  const toDateStr = now.toISOString().split("T")[0];

  // Fetch jobs from live Zuper API
  const jobs = await fetchJobsForCategory(categoryUid, fromDateStr, toDateStr);
  if (jobs.length === 0) return null;

  // Build deal ID → location lookup.
  // When the caller provides locationDealIds (from HubSpot), use that directly —
  // it's always fresh. Fall back to HubSpotProjectCache for callers that don't
  // pass deal IDs (e.g. the standalone compliance dashboard).
  const dealLocationMap = new Map<string, string>();

  if (locationDealIds && locationDealIds.size > 0) {
    // Caller provided deal IDs for this location — mark them all
    for (const dealId of locationDealIds) {
      dealLocationMap.set(dealId, location);
    }
  }

  // Always supplement with the project cache (covers deals the caller may
  // not have, e.g. if a Zuper job links to a deal outside the main query).
  const projectCacheRows = await prisma.hubSpotProjectCache.findMany({
    select: { dealId: true, pbLocation: true },
  });
  for (const row of projectCacheRows) {
    if (row.pbLocation && !dealLocationMap.has(row.dealId)) {
      dealLocationMap.set(row.dealId, row.pbLocation);
    }
  }

  // Build crew fallback map
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

  // Per-user accumulators
  interface UserAcc {
    userName: string;
    totalJobs: number;
    completedJobs: number;
    onTimeCompletions: number;
    lateCompletions: number;
    stuckJobs: number;
    neverStartedJobs: number;
    completionDays: number[];
    daysLatePastEnd: number[];
    oowOnTime: number;
    oowLate: number;
    oowUsed: number;
    startedUsed: number;
  }

  const userMap = new Map<string, UserAcc>();
  const stuckJobsList: LocationComplianceResult["stuckJobs"] = [];

  // Aggregate accumulators (job-level, not per-user)
  const aggAcc = {
    totalJobs: 0,
    completedJobs: 0,
    onTimeCompletions: 0,
    lateCompletions: 0,
    stuckJobs: 0,
    neverStartedJobs: 0,
    completionDays: [] as number[],
    daysLatePastEnd: [] as number[],
    oowOnTime: 0,
    oowLate: 0,
    oowUsed: 0,
  };

  for (const job of jobs) {
    const statusName = getStatusName(job);
    const statusLower = statusName.toLowerCase();
    const assignedUsers = extractAssignedUsers(job, assignmentOptions);

    // Attribute job by HubSpot deal location when possible, fall back to team.
    let filteredUsers: AssignedUser[];
    const dealId = extractHubspotDealIdFromJob(job as Record<string, unknown>);
    const dealPbLocation = dealId ? dealLocationMap.get(dealId) : undefined;
    const normalizedDealLocation = dealPbLocation
      ? normalizeLocation(dealPbLocation)
      : null;

    if (normalizedDealLocation) {
      // Deal has a known location — attribute to that location
      if (normalizedDealLocation !== location) continue; // wrong location, skip
      // All assigned users count toward this location regardless of team
      filteredUsers = assignedUsers;
    } else {
      // No deal link or unknown location — fall back to team-based filtering
      filteredUsers = filterAssignedUsersByTeam(assignedUsers, teamFilter);
      if (filteredUsers.length === 0) continue;
    }

    const scheduledStart = job.scheduled_start_time
      ? new Date(job.scheduled_start_time)
      : null;
    const scheduledEnd = job.scheduled_end_time
      ? new Date(job.scheduled_end_time)
      : null;
    const completedTime = getCompletedTimeFromHistory(job);
    const onOurWayTime = getOnOurWayTime(job);
    const startedTime = getStartedTime(job);
    const usedStarted = startedTime !== null;

    // Aggregate (job-level)
    aggAcc.totalJobs++;

    const isCompleted = COMPLETED_STATUSES.has(statusLower);
    const isStuck = STUCK_STATUSES.has(statusLower) && scheduledEnd && scheduledEnd < now;
    const isNeverStarted =
      NEVER_STARTED_STATUSES.has(statusLower) && scheduledStart && scheduledStart < now;

    if (isCompleted) {
      aggAcc.completedJobs++;
      if (scheduledEnd && completedTime) {
        const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
        if (completedTime <= deadline) {
          aggAcc.onTimeCompletions++;
        } else {
          aggAcc.lateCompletions++;
        }
        if (completedTime > scheduledEnd) {
          const diffMs = completedTime.getTime() - scheduledEnd.getTime();
          aggAcc.daysLatePastEnd.push(
            Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10
          );
        }
      } else if (completedTime) {
        // No scheduledEnd but completed → count as on-time
        aggAcc.onTimeCompletions++;
      }
      if (scheduledStart && completedTime && completedTime > scheduledStart) {
        const diffMs = completedTime.getTime() - scheduledStart.getTime();
        aggAcc.completionDays.push(
          Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10
        );
      }
      if (onOurWayTime && scheduledStart) {
        if (onOurWayTime > scheduledStart) {
          aggAcc.oowLate++;
        } else {
          aggAcc.oowOnTime++;
        }
      }
      if (onOurWayTime) aggAcc.oowUsed++;
    }
    if (isStuck) aggAcc.stuckJobs++;
    if (isNeverStarted) aggAcc.neverStartedJobs++;

    // Per-user attribution
    for (const { userUid, userName } of filteredUsers) {
      if (!userMap.has(userUid)) {
        userMap.set(userUid, {
          userName,
          totalJobs: 0,
          completedJobs: 0,
          onTimeCompletions: 0,
          lateCompletions: 0,
          stuckJobs: 0,
          neverStartedJobs: 0,
          completionDays: [],
          daysLatePastEnd: [],
          oowOnTime: 0,
          oowLate: 0,
          oowUsed: 0,
          startedUsed: 0,
        });
      }
      const acc = userMap.get(userUid)!;
      acc.totalJobs++;

      if (isCompleted) {
        acc.completedJobs++;
        if (scheduledEnd && completedTime) {
          const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
          if (completedTime <= deadline) {
            acc.onTimeCompletions++;
          } else {
            acc.lateCompletions++;
          }
          if (completedTime > scheduledEnd) {
            const diffMs = completedTime.getTime() - scheduledEnd.getTime();
            acc.daysLatePastEnd.push(
              Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10
            );
          }
        } else if (completedTime) {
          acc.onTimeCompletions++;
        }
        if (scheduledStart && completedTime && completedTime > scheduledStart) {
          const diffMs = completedTime.getTime() - scheduledStart.getTime();
          acc.completionDays.push(
            Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10
          );
        }
        if (onOurWayTime && scheduledStart) {
          if (onOurWayTime > scheduledStart) {
            acc.oowLate++;
          } else {
            acc.oowOnTime++;
          }
        }
        if (onOurWayTime) acc.oowUsed++;
        if (usedStarted) acc.startedUsed++;
      }
      if (isStuck) acc.stuckJobs++;
      if (isNeverStarted) acc.neverStartedJobs++;
    }

    // Track stuck job details
    if (isStuck) {
      const primaryUser = filteredUsers[0]?.userName;
      const daysSinceScheduled = scheduledEnd
        ? Math.floor((now.getTime() - scheduledEnd.getTime()) / (24 * 60 * 60 * 1000))
        : undefined;
      stuckJobsList.push({
        name: job.job_title || "Unknown",
        assignedUser: primaryUser,
        daysSinceScheduled,
      });
    }
  }

  if (aggAcc.totalJobs === 0) return null;

  // Build per-employee results
  const byEmployee: EmployeeComplianceFull[] = [];

  for (const acc of userMap.values()) {
    const measurable = acc.onTimeCompletions + acc.lateCompletions;
    const onTimePercent =
      measurable > 0
        ? Math.round((acc.onTimeCompletions / measurable) * 100)
        : -1;
    const avgDaysToComplete =
      acc.completionDays.length > 0
        ? Math.round(
            (acc.completionDays.reduce((s, d) => s + d, 0) / acc.completionDays.length) * 10
          ) / 10
        : 0;
    const avgDaysLate =
      acc.daysLatePastEnd.length > 0
        ? Math.round(
            (acc.daysLatePastEnd.reduce((s, d) => s + d, 0) / acc.daysLatePastEnd.length) * 10
          ) / 10
        : 0;

    const oowTotal = acc.oowOnTime + acc.oowLate;
    const oowOnTimePercent =
      oowTotal > 0 ? Math.round((acc.oowOnTime / oowTotal) * 100) : -1;
    const oowUsagePercent =
      acc.completedJobs > 0
        ? Math.round((acc.oowUsed / acc.completedJobs) * 100)
        : -1;

    const statusUsagePercent =
      acc.completedJobs > 0
        ? Math.round(((acc.oowUsed + acc.startedUsed) / (acc.completedJobs * 2)) * 100)
        : 0;

    // Compliance score: on-time% baseline minus penalties for stuck/never-started.
    // Score = onTime% − (stuckRate × 100) − (neverStartedRate × 100)
    // Floor at 0 so scores can't go negative.
    const stuckRate = acc.totalJobs > 0 ? acc.stuckJobs / acc.totalJobs : 0;
    const neverStartedRate = acc.totalJobs > 0 ? acc.neverStartedJobs / acc.totalJobs : 0;
    const rawOnTime = onTimePercent >= 0 ? onTimePercent : 0;
    const complianceScore = Math.max(
      0,
      Math.round(
        (rawOnTime - stuckRate * 100 - neverStartedRate * 100) * 10
      ) / 10
    );

    byEmployee.push({
      name: acc.userName,
      totalJobs: acc.totalJobs,
      completedJobs: acc.completedJobs,
      onTimePercent,
      measurableCount: measurable,
      lateCount: acc.lateCompletions,
      stuckCount: acc.stuckJobs,
      neverStartedCount: acc.neverStartedJobs,
      avgDaysToComplete,
      avgDaysLate,
      oowUsagePercent,
      oowOnTimePercent,
      statusUsagePercent,
      complianceScore,
      grade: computeGrade(complianceScore),
    });
  }

  // Sort: worst score first (so the TV highlights problems)
  byEmployee.sort((a, b) => a.complianceScore - b.complianceScore);

  // Aggregate summary
  const aggMeasurable = aggAcc.onTimeCompletions + aggAcc.lateCompletions;
  const oowTotal = aggAcc.oowOnTime + aggAcc.oowLate;

  // Aggregate compliance score — same penalty formula as per-employee
  const aggOnTimePercent = aggMeasurable > 0
    ? Math.round((aggAcc.onTimeCompletions / aggMeasurable) * 100)
    : -1;
  const aggStuckRate = aggAcc.totalJobs > 0 ? aggAcc.stuckJobs / aggAcc.totalJobs : 0;
  const aggNeverStartedRate = aggAcc.totalJobs > 0 ? aggAcc.neverStartedJobs / aggAcc.totalJobs : 0;
  const aggRawOnTime = aggOnTimePercent >= 0 ? aggOnTimePercent : 0;
  const aggregateScore = Math.max(
    0,
    Math.round((aggRawOnTime - aggStuckRate * 100 - aggNeverStartedRate * 100) * 10) / 10
  );

  const summary: ComplianceSummaryFull = {
    totalJobs: aggAcc.totalJobs,
    completedJobs: aggAcc.completedJobs,
    onTimePercent: aggOnTimePercent,
    stuckCount: aggAcc.stuckJobs,
    neverStartedCount: aggAcc.neverStartedJobs,
    avgDaysToComplete:
      aggAcc.completionDays.length > 0
        ? Math.round(
            (aggAcc.completionDays.reduce((s, d) => s + d, 0) /
              aggAcc.completionDays.length) *
              10
          ) / 10
        : 0,
    avgDaysLate:
      aggAcc.daysLatePastEnd.length > 0
        ? Math.round(
            (aggAcc.daysLatePastEnd.reduce((s, d) => s + d, 0) /
              aggAcc.daysLatePastEnd.length) *
              10
          ) / 10
        : 0,
    oowUsagePercent:
      aggAcc.completedJobs > 0
        ? Math.round((aggAcc.oowUsed / aggAcc.completedJobs) * 100)
        : -1,
    oowOnTimePercent:
      oowTotal > 0
        ? Math.round((aggAcc.oowOnTime / oowTotal) * 100)
        : -1,
    aggregateScore,
    aggregateGrade: computeGrade(aggregateScore),
  };

  return { summary, byEmployee, stuckJobs: stuckJobsList };
}
