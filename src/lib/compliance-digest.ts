/* eslint-disable @typescript-eslint/no-explicit-any */
import { getActiveCrewMembers } from "@/lib/db";
import {
  COMPLIANCE_EXCLUDED_USER_UIDS,
  COMPLIANCE_TEAM_OVERRIDES,
} from "@/lib/compliance-team-overrides";
import { JOB_CATEGORIES, JOB_CATEGORY_UIDS } from "@/lib/zuper";
import {
  type AssignedUser,
  STUCK_STATUSES,
  NEVER_STARTED_STATUSES,
  COMPLETED_STATUSES,
  GRACE_MS,
  CATEGORY_UID_TO_NAME,
  getCategoryUid,
  getStatusName,
  getCompletedTimeFromHistory,
  getOnOurWayTime,
  getStartedTime,
  isExcludedUser,
  isExcludedTeam,
  extractAssignedUsers,
  computeGrade,
  fetchJobsForCategory,
} from "@/lib/compliance-helpers";

export interface ComplianceDigest {
  period: { from: string; to: string; days: number };
  summary: {
    totalJobs: number;
    completedJobs: number;
    onTimePercent: number;
    oowUsagePercent: number;
    stuckJobs: number;
    unknownCompletionJobs: number;
  };
  priorPeriod: {
    completedJobs: number;
    onTimePercent: number;
    oowUsagePercent: number;
    stuckJobs: number;
  };
  teams: Array<{
    name: string;
    completedJobs: number;
    onTimePercent: number;
    avgDaysLate: number;
    stuckJobs: number;
    grade: string;
  }>;
  categories: Array<{
    name: string;
    completedJobs: number;
    onTimePercent: number;
    avgDaysLate: number;
    stuckJobs: number;
    grade: string;
  }>;
  notificationReliability: {
    oowBeforeStartPercent: number;
    startedOnTimePercent: number;
    lowOowUsers: Array<{ name: string; team: string; oowPercent: number }>;
  };
  callouts: {
    stuckOver3Days: Array<{ jobUid: string; title: string; team: string; daysPastEnd: number }>;
    failingUsers: Array<{ name: string; team: string; grade: string; score: number }>;
    unknownCompletionJobs: Array<{ jobUid: string; title: string; category: string }>;
  };
}

type JobWithCategory = {
  job: any;
  categoryName: string;
};

interface MetricsAccumulator {
  totalJobs: number;
  completedJobs: number;
  onTimeCompletions: number;
  lateCompletions: number;
  unknownCompletionJobs: number;
  stuckJobs: number;
  neverStartedJobs: number;
  daysLatePastEnd: number[];
  oowOnTime: number;
  oowLate: number;
  oowUsed: number;
  startedOnTime: number;
  startedLate: number;
  startedUsed: number;
}

interface UserAccumulator extends MetricsAccumulator {
  name: string;
  teamNames: Set<string>;
}

interface AggregateResult {
  summary: {
    totalJobs: number;
    completedJobs: number;
    onTimePercent: number;
    oowUsagePercent: number;
    stuckJobs: number;
    unknownCompletionJobs: number;
    oowBeforeStartPercent: number;
    startedOnTimePercent: number;
  };
  teams: Array<{
    name: string;
    completedJobs: number;
    onTimePercent: number;
    avgDaysLate: number;
    stuckJobs: number;
    grade: string;
  }>;
  categories: Array<{
    name: string;
    completedJobs: number;
    onTimePercent: number;
    avgDaysLate: number;
    stuckJobs: number;
    grade: string;
  }>;
  callouts: {
    stuckOver3Days: Array<{ jobUid: string; title: string; team: string; daysPastEnd: number }>;
    unknownCompletionJobs: Array<{ jobUid: string; title: string; category: string }>;
  };
  users: Array<{
    uid: string;
    name: string;
    team: string;
    completedJobs: number;
    oowUsed: number;
    oowPercent: number;
    score: number;
    grade: string;
    totalJobs: number;
  }>;
}

function getCategoryUid(job: any): string | null {
  const cat = job.job_category;
  if (!cat) return null;
  if (typeof cat === "string") return cat;
  return (cat as Record<string, unknown>)?.category_uid as string | null;
}

function getStatusName(job: any): string {
  return (
    job.current_job_status?.status_name ||
    job.status?.status_name ||
    job.status ||
    "Unknown"
  );
}

function getCompletedTimeFromHistory(job: any): Date | null {
  const direct = job.completed_time || job.completed_at;
  if (direct) return new Date(direct);

  const statusHistory = job.job_status;
  if (!Array.isArray(statusHistory)) return null;

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

function getOnOurWayTime(job: any): Date | null {
  const statusHistory = job.job_status;
  if (!Array.isArray(statusHistory)) return null;

  for (const entry of statusHistory) {
    if (!entry) continue;
    const name = (entry.status_name || entry.name || "").toLowerCase();
    if (name === "on our way" && (entry.created_at || entry.updated_at)) {
      return new Date(entry.created_at || entry.updated_at);
    }
  }

  return null;
}

function getStartedTime(job: any): Date | null {
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

function isExcludedUser(userName: string): boolean {
  const lower = userName.toLowerCase();
  return EXCLUDED_USER_NAMES.some((excluded) => lower.startsWith(excluded));
}

function isExcludedTeam(teamName: string | null): boolean {
  if (!teamName) return false;
  const lower = teamName.toLowerCase();
  return EXCLUDED_TEAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

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

function extractAssignedUsers(
  job: Record<string, unknown>,
  options?: {
    crewTeamByUserUid?: Map<string, string>;
    directTeamByUserUid?: Map<string, string>;
    excludedUserUids?: Set<string>;
  }
): AssignedUser[] {
  const users: AssignedUser[] = [];
  if (!Array.isArray(job.assigned_to)) return users;

  const teamUidToName = new Map<string, string>();
  if (Array.isArray(job.assigned_to_team)) {
    for (const t of job.assigned_to_team) {
      if (typeof t === "object" && t !== null) {
        const tm = (t as any).team;
        if (typeof tm === "object" && tm !== null && tm.team_uid && tm.team_name) {
          teamUidToName.set(tm.team_uid, tm.team_name);
        }
      }
    }
  }

  const jobLevelTeams = extractTeamNames(job);
  const singleTeamFallback = jobLevelTeams.length === 1 ? jobLevelTeams[0] : null;

  for (const a of job.assigned_to) {
    if (typeof a !== "object" || a === null) continue;
    const user = (a as any).user || a;
    if (typeof user !== "object" || user === null) continue;

    const u = user as Record<string, any>;
    const userUid = u.user_uid;
    if (!userUid) continue;

    const userName = `${u.first_name || ""} ${u.last_name || ""}`.trim();
    if (!userName || u.is_active === false) continue;
    if (isExcludedUser(userName)) continue;
    if (options?.excludedUserUids?.has(userUid)) continue;

    const assignmentTeamName: string | undefined = (a as any).team?.team_name;
    const assignmentTeamUid: string | undefined = (a as any).team_uid || (a as any).team?.team_uid;

    let teamNames: string[];
    if (options?.directTeamByUserUid?.has(userUid)) {
      teamNames = [options.directTeamByUserUid.get(userUid)!];
    } else if (assignmentTeamName) {
      teamNames = [assignmentTeamName];
    } else if (assignmentTeamUid && teamUidToName.has(assignmentTeamUid)) {
      teamNames = [teamUidToName.get(assignmentTeamUid)!];
    } else if (options?.crewTeamByUserUid?.has(userUid)) {
      teamNames = [options.crewTeamByUserUid.get(userUid)!];
    } else if (singleTeamFallback) {
      teamNames = [singleTeamFallback];
    } else {
      teamNames = [];
    }

    if (teamNames.some((teamName) => isExcludedTeam(teamName))) continue;

    users.push({ userUid, userName, teamNames });
  }

  return users;
}

function computeGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

function newAccumulator(): MetricsAccumulator {
  return {
    totalJobs: 0,
    completedJobs: 0,
    onTimeCompletions: 0,
    lateCompletions: 0,
    unknownCompletionJobs: 0,
    stuckJobs: 0,
    neverStartedJobs: 0,
    daysLatePastEnd: [],
    oowOnTime: 0,
    oowLate: 0,
    oowUsed: 0,
    startedOnTime: 0,
    startedLate: 0,
    startedUsed: 0,
  };
}

function applyJobOutcome(
  acc: MetricsAccumulator,
  args: {
    statusLower: string;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    completedTime: Date | null;
    onOurWayTime: Date | null;
    startedTime: Date | null;
    now: Date;
  }
): void {
  const {
    statusLower,
    scheduledStart,
    scheduledEnd,
    completedTime,
    onOurWayTime,
    startedTime,
    now,
  } = args;

  if (COMPLETED_STATUSES.has(statusLower)) {
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
        const daysLate = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10;
        acc.daysLatePastEnd.push(daysLate);
      }
    } else if (!completedTime) {
      acc.unknownCompletionJobs++;
    } else {
      acc.onTimeCompletions++;
    }

    if (onOurWayTime && scheduledStart) {
      if (onOurWayTime > scheduledStart) {
        acc.oowLate++;
      } else {
        acc.oowOnTime++;
      }
      acc.oowUsed++;
    }

    if (startedTime) {
      acc.startedUsed++;
      if (scheduledStart && scheduledEnd) {
        if (startedTime <= scheduledEnd) {
          acc.startedOnTime++;
        } else {
          acc.startedLate++;
        }
      }
    }
  }

  if (STUCK_STATUSES.has(statusLower) && scheduledEnd && scheduledEnd < now) {
    acc.stuckJobs++;
  }

  if (NEVER_STARTED_STATUSES.has(statusLower) && scheduledStart && scheduledStart < now) {
    acc.neverStartedJobs++;
  }
}

function summarizeAccumulator(acc: MetricsAccumulator): {
  onTimePercent: number;
  avgDaysLate: number;
  score: number;
  grade: string;
  oowUsagePercent: number;
  oowBeforeStartPercent: number;
  startedOnTimePercent: number;
} {
  const measurable = acc.onTimeCompletions + acc.lateCompletions;
  const onTimePercent =
    measurable > 0 ? Math.round((acc.onTimeCompletions / measurable) * 100 * 10) / 10 : 0;

  const avgDaysLate =
    acc.daysLatePastEnd.length > 0
      ? Math.round((acc.daysLatePastEnd.reduce((s, d) => s + d, 0) / acc.daysLatePastEnd.length) * 10) /
        10
      : 0;

  const stuckRate = acc.totalJobs > 0 ? acc.stuckJobs / acc.totalJobs : 0;
  const neverStartedRate = acc.totalJobs > 0 ? acc.neverStartedJobs / acc.totalJobs : 0;
  const score =
    Math.round((0.5 * onTimePercent + 0.3 * (1 - stuckRate) * 100 + 0.2 * (1 - neverStartedRate) * 100) * 10) /
    10;

  const oowTotal = acc.oowOnTime + acc.oowLate;
  const oowUsagePercent =
    acc.completedJobs > 0 ? Math.round((acc.oowUsed / acc.completedJobs) * 100 * 10) / 10 : 0;
  const oowBeforeStartPercent =
    oowTotal > 0 ? Math.round((acc.oowOnTime / oowTotal) * 100 * 10) / 10 : 0;

  const startedTotal = acc.startedOnTime + acc.startedLate;
  const startedOnTimePercent =
    startedTotal > 0 ? Math.round((acc.startedOnTime / startedTotal) * 100 * 10) / 10 : 0;

  return {
    onTimePercent,
    avgDaysLate,
    score,
    grade: computeGrade(score),
    oowUsagePercent,
    oowBeforeStartPercent,
    startedOnTimePercent,
  };
}

async function fetchJobsForCategory(
  categoryUid: string,
  fromDate: string,
  toDate: string
): Promise<any[]> {
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

  return allJobs;
}

async function fetchAllJobs(fromDate: string, toDate: string): Promise<JobWithCategory[]> {
  const categoryMap: Record<string, string> = {};
  for (const [key, uid] of Object.entries(JOB_CATEGORY_UIDS) as [string, string][]) {
    categoryMap[uid] = JOB_CATEGORIES[key as keyof typeof JOB_CATEGORIES] || key;
  }

  const allCategoryEntries = Object.entries(JOB_CATEGORY_UIDS) as [
    keyof typeof JOB_CATEGORY_UIDS,
    string,
  ][];

  const categoryResults = await Promise.all(
    allCategoryEntries.map(async ([, uid]) => {
      const jobs = await fetchJobsForCategory(uid, fromDate, toDate);
      return { categoryUid: uid, jobs };
    })
  );

  const allJobs: JobWithCategory[] = [];
  for (const { categoryUid, jobs } of categoryResults) {
    const categoryName = categoryMap[categoryUid] || categoryUid;
    for (const job of jobs) {
      allJobs.push({ job, categoryName });
    }
  }

  return allJobs;
}

async function analyzeJobs(allJobs: JobWithCategory[]): Promise<AggregateResult> {
  const crew = await getActiveCrewMembers();
  const crewTeamByUserUid = new Map<string, string>();
  for (const member of crew) {
    const uid = member.zuperUserUid?.trim();
    const teamName = member.teamName?.trim();
    if (!uid || !teamName) continue;
    if (!crewTeamByUserUid.has(uid)) crewTeamByUserUid.set(uid, teamName);
  }

  const directTeamByUserUid = new Map<string, string>(
    Object.entries(COMPLIANCE_TEAM_OVERRIDES)
  );

  const assignmentOptions = {
    crewTeamByUserUid,
    directTeamByUserUid,
    excludedUserUids: COMPLIANCE_EXCLUDED_USER_UIDS,
  };

  const now = new Date();
  const summaryAcc = newAccumulator();
  const teamMap = new Map<string, MetricsAccumulator>();
  const categoryMap = new Map<string, MetricsAccumulator>();
  const userMap = new Map<string, UserAccumulator>();

  const stuckOver3Days: Array<{ jobUid: string; title: string; team: string; daysPastEnd: number }> = [];
  const unknownCompletionJobs: Array<{ jobUid: string; title: string; category: string }> = [];
  const seenUnknown = new Set<string>();

  for (const { job, categoryName } of allJobs) {
    const statusName = getStatusName(job);
    const statusLower = statusName.toLowerCase();
    const assignedUsers = extractAssignedUsers(job, assignmentOptions);
    if (assignedUsers.length === 0) continue;

    const scheduledStart = job.scheduled_start_time ? new Date(job.scheduled_start_time) : null;
    const scheduledEnd = job.scheduled_end_time ? new Date(job.scheduled_end_time) : null;
    const completedTime = getCompletedTimeFromHistory(job);
    const onOurWayTime = getOnOurWayTime(job);
    const startedTime = getStartedTime(job);

    summaryAcc.totalJobs++;
    applyJobOutcome(summaryAcc, {
      statusLower,
      scheduledStart,
      scheduledEnd,
      completedTime,
      onOurWayTime,
      startedTime,
      now,
    });

    if (COMPLETED_STATUSES.has(statusLower) && !completedTime) {
      const uid = String(job.job_uid || "");
      if (uid && !seenUnknown.has(uid)) {
        seenUnknown.add(uid);
        unknownCompletionJobs.push({
          jobUid: uid,
          title: String(job.job_title || ""),
          category: categoryName,
        });
      }
    }

    if (STUCK_STATUSES.has(statusLower) && scheduledEnd && scheduledEnd < now) {
      const ms = now.getTime() - scheduledEnd.getTime();
      const daysPastEnd = Math.round((ms / (1000 * 60 * 60 * 24)) * 10) / 10;
      if (daysPastEnd > 3) {
        const teams = new Set<string>();
        for (const u of assignedUsers) for (const t of u.teamNames) teams.add(t);
        stuckOver3Days.push({
          jobUid: String(job.job_uid || ""),
          title: String(job.job_title || ""),
          team: teams.size > 0 ? Array.from(teams).sort().join(", ") : "Unassigned",
          daysPastEnd,
        });
      }
    }

    if (!categoryMap.has(categoryName)) categoryMap.set(categoryName, newAccumulator());
    const catAcc = categoryMap.get(categoryName)!;
    catAcc.totalJobs++;
    applyJobOutcome(catAcc, {
      statusLower,
      scheduledStart,
      scheduledEnd,
      completedTime,
      onOurWayTime,
      startedTime,
      now,
    });

    const teams = new Set<string>();
    for (const u of assignedUsers) {
      for (const t of u.teamNames) teams.add(t);
    }
    if (teams.size === 0) teams.add("Unassigned");

    for (const teamName of teams) {
      if (!teamMap.has(teamName)) teamMap.set(teamName, newAccumulator());
      const tAcc = teamMap.get(teamName)!;
      tAcc.totalJobs++;
      applyJobOutcome(tAcc, {
        statusLower,
        scheduledStart,
        scheduledEnd,
        completedTime,
        onOurWayTime,
        startedTime,
        now,
      });
    }

    for (const assignedUser of assignedUsers) {
      if (!userMap.has(assignedUser.userUid)) {
        userMap.set(assignedUser.userUid, {
          ...newAccumulator(),
          name: assignedUser.userName,
          teamNames: new Set(assignedUser.teamNames),
        });
      }
      const uAcc = userMap.get(assignedUser.userUid)!;
      for (const t of assignedUser.teamNames) uAcc.teamNames.add(t);
      uAcc.totalJobs++;
      applyJobOutcome(uAcc, {
        statusLower,
        scheduledStart,
        scheduledEnd,
        completedTime,
        onOurWayTime,
        startedTime,
        now,
      });
    }
  }

  const summaryStats = summarizeAccumulator(summaryAcc);

  const teams = Array.from(teamMap.entries())
    .map(([name, acc]) => {
      const stats = summarizeAccumulator(acc);
      return {
        name,
        completedJobs: acc.completedJobs,
        onTimePercent: stats.onTimePercent,
        avgDaysLate: stats.avgDaysLate,
        stuckJobs: acc.stuckJobs,
        grade: stats.grade,
        score: stats.score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...rest }) => rest);

  const categories = Array.from(categoryMap.entries())
    .map(([name, acc]) => {
      const stats = summarizeAccumulator(acc);
      return {
        name,
        completedJobs: acc.completedJobs,
        onTimePercent: stats.onTimePercent,
        avgDaysLate: stats.avgDaysLate,
        stuckJobs: acc.stuckJobs,
        grade: stats.grade,
        score: stats.score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...rest }) => rest);

  const users = Array.from(userMap.entries())
    .map(([uid, acc]) => {
      const stats = summarizeAccumulator(acc);
      return {
        uid,
        name: acc.name,
        team: acc.teamNames.size > 0 ? Array.from(acc.teamNames).sort().join(", ") : "Unassigned",
        completedJobs: acc.completedJobs,
        oowUsed: acc.oowUsed,
        oowPercent: stats.oowUsagePercent,
        score: stats.score,
        grade: stats.grade,
        totalJobs: acc.totalJobs,
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    summary: {
      totalJobs: summaryAcc.totalJobs,
      completedJobs: summaryAcc.completedJobs,
      onTimePercent: summaryStats.onTimePercent,
      oowUsagePercent: summaryStats.oowUsagePercent,
      stuckJobs: summaryAcc.stuckJobs,
      unknownCompletionJobs: summaryAcc.unknownCompletionJobs,
      oowBeforeStartPercent: summaryStats.oowBeforeStartPercent,
      startedOnTimePercent: summaryStats.startedOnTimePercent,
    },
    teams,
    categories,
    users,
    callouts: {
      stuckOver3Days: stuckOver3Days
        .sort((a, b) => b.daysPastEnd - a.daysPastEnd)
        .slice(0, 12),
      unknownCompletionJobs: unknownCompletionJobs.slice(0, 20),
    },
  };
}

function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

function buildPeriod(days: number, endDate: Date): { from: string; to: string; fromDate: Date; toDate: Date } {
  const toDate = new Date(endDate);
  const fromDate = new Date(endDate);
  // Inclusive window: 7 days means today + previous 6 days.
  fromDate.setDate(fromDate.getDate() - Math.max(0, days - 1));
  return {
    from: toDateString(fromDate),
    to: toDateString(toDate),
    fromDate,
    toDate,
  };
}

export async function getComplianceDigest(days: number): Promise<ComplianceDigest> {
  if (!zuper.isConfigured()) {
    throw new Error("Zuper integration not configured");
  }

  const now = new Date();
  const safeDays = Math.max(1, Math.min(days, 90));

  const currentPeriod = buildPeriod(safeDays, now);
  const priorEnd = new Date(currentPeriod.fromDate);
  priorEnd.setDate(priorEnd.getDate() - 1);
  const priorPeriod = buildPeriod(safeDays, priorEnd);

  const [currentJobs, priorJobs] = await Promise.all([
    fetchAllJobs(currentPeriod.from, currentPeriod.to),
    fetchAllJobs(priorPeriod.from, priorPeriod.to),
  ]);

  const [current, prior] = await Promise.all([
    analyzeJobs(currentJobs),
    analyzeJobs(priorJobs),
  ]);

  const lowOowUsers = current.users
    .filter((u) => u.completedJobs >= 3)
    .filter((u) => u.oowPercent < 50)
    .sort((a, b) => a.oowPercent - b.oowPercent)
    .slice(0, 10)
    .map((u) => ({
      name: u.name,
      team: u.team,
      oowPercent: u.oowPercent,
    }));

  const failingUsers = current.users
    .filter((u) => u.totalJobs >= 3)
    .filter((u) => u.grade === "D" || u.grade === "F")
    .sort((a, b) => a.score - b.score)
    .slice(0, 10)
    .map((u) => ({
      name: u.name,
      team: u.team,
      grade: u.grade,
      score: u.score,
    }));

  return {
    period: {
      from: currentPeriod.from,
      to: currentPeriod.to,
      days: safeDays,
    },
    summary: {
      totalJobs: current.summary.totalJobs,
      completedJobs: current.summary.completedJobs,
      onTimePercent: current.summary.onTimePercent,
      oowUsagePercent: current.summary.oowUsagePercent,
      stuckJobs: current.summary.stuckJobs,
      unknownCompletionJobs: current.summary.unknownCompletionJobs,
    },
    priorPeriod: {
      completedJobs: prior.summary.completedJobs,
      onTimePercent: prior.summary.onTimePercent,
      oowUsagePercent: prior.summary.oowUsagePercent,
      stuckJobs: prior.summary.stuckJobs,
    },
    teams: current.teams,
    categories: current.categories,
    notificationReliability: {
      oowBeforeStartPercent: current.summary.oowBeforeStartPercent,
      startedOnTimePercent: current.summary.startedOnTimePercent,
      lowOowUsers,
    },
    callouts: {
      stuckOver3Days: current.callouts.stuckOver3Days,
      failingUsers,
      unknownCompletionJobs: current.callouts.unknownCompletionJobs,
    },
  };
}
