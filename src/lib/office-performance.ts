import { prisma } from "@/lib/db";
import { fetchAllProjects } from "@/lib/hubspot";
import { normalizeLocation } from "@/lib/locations";
import type {
  OfficePerformanceData,
  PipelineData,
  SurveyData,
  InstallData,
  InspectionData,
  PersonStat,
  InspectionPersonStat,
  EnrichedPersonStat,
  OfficeMetricName,
  DealRow,
  SectionCompliance,
  ComplianceJob,
  EmployeeCompliance,
} from "@/lib/office-performance-types";

// ---------- Name Matching ----------

export function nameMatchesLoosely(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().trim().replace(/[^a-z ]/g, "");
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  // startsWith is for abbreviations like "Mike S" → "Mike Smith", NOT for
  // single first names matching full names. Only allow when both have spaces
  // (multi-part names) to avoid "Mike" matching "Mike Smith".
  const bothMultiPart = na.includes(" ") && nb.includes(" ");
  if (bothMultiPart && (na.startsWith(nb) || nb.startsWith(na))) return true;
  const partsA = a.trim().split(/\s+/);
  const partsB = b.trim().split(/\s+/);
  const firstA = partsA[0]?.toLowerCase();
  const firstB = partsB[0]?.toLowerCase();
  if (firstA !== firstB || !firstA || firstA.length <= 2) return false;
  const lastA = partsA[partsA.length - 1]?.toLowerCase();
  const lastB = partsB[partsB.length - 1]?.toLowerCase();
  if (lastA && lastB && lastA[0] === lastB[0]) return true;
  // When one side is a single name (no surname), do NOT assume a match.
  // First-name-only comparisons are too ambiguous ("Mike" would match
  // both "Mike Smith" and "Mike Rodriguez"). Require at least a
  // last-initial match above for multi-part vs single-part names.
  return false;
}

// ---------- Goals ----------

const DEFAULT_GOALS: Record<OfficeMetricName, number> = {
  projects_completed: 15,
  surveys_completed: 25,
  installs_completed: 12,
  inspections_completed: 10,
};

type OfficeGoalRow = {
  metric: string;
  target: number;
};

type OfficeGoalDelegate = {
  findMany(args: {
    where: {
      location: string;
      month: number;
      year: number;
    };
  }): Promise<OfficeGoalRow[]>;
};

function getOfficeGoalDelegate(): OfficeGoalDelegate | null {
  if (!prisma) return null;
  const client = prisma as typeof prisma & { officeGoal?: OfficeGoalDelegate };
  return client.officeGoal ?? null;
}

export async function getGoalsForLocation(
  location: string,
  month: number,
  year: number
): Promise<Record<OfficeMetricName, number>> {
  const goals = { ...DEFAULT_GOALS };
  const officeGoal = getOfficeGoalDelegate();
  if (!officeGoal) return goals;

  try {
    const rows = await officeGoal.findMany({
      where: { location, month, year },
    });

    for (const row of rows) {
      if (row.metric in goals) {
        goals[row.metric as OfficeMetricName] = row.target;
      }
    }

    // Fallback: if no goals for this month, try prior month
    if (rows.length === 0) {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const fallback = await officeGoal.findMany({
        where: { location, month: prevMonth, year: prevYear },
      });
      for (const row of fallback) {
        if (row.metric in goals) {
          goals[row.metric as OfficeMetricName] = row.target;
        }
      }
    }
  } catch (error) {
    console.warn(
      `[office-performance] Failed to load OfficeGoal rows for ${location}; using defaults.`,
      error
    );
  }

  return goals;
}

// ---------- Stage Normalization ----------

const STAGE_MAP: Record<string, string> = {
  "site survey": "Survey",
  "survey": "Survey",
  "design": "Design",
  "design approval": "Design",
  "permitting": "Permit",
  "permit": "Permit",
  "ready to build": "RTB",
  "rtb": "RTB",
  "construction": "Install",
  "install": "Install",
  "installation": "Install",
  "inspection": "Inspect",
  "pto": "PTO",
};

function normalizeStage(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return STAGE_MAP[lower] || raw;
}

const SURVEY_STAGES = new Set(["Survey"]);
const INSTALL_STAGES = new Set(["RTB", "Install"]);
const INSPECTION_STAGES = new Set(["Inspect", "PTO"]);

// ---------- Pipeline Aggregation ----------

// Matches the real RawProject shape from src/lib/types.ts and Project from src/lib/hubspot.ts
interface ProjectForMetrics {
  id?: number;  // HubSpot deal ID
  name?: string;
  pbLocation?: string | null;
  stage?: string;
  amount?: number;
  siteSurveyor?: string | null;
  ptoGrantedDate?: string | null;        // NOT "ptoDate" — real field name
  forecastedInstallDate?: string | null;
  forecastedInspectionDate?: string | null;
  forecastedPtoDate?: string | null;
  constructionCompleteDate?: string | null;
  constructionScheduleDate?: string | null;
  inspectionPassDate?: string | null;
  daysSinceStageMovement?: number;        // NOT "daysInCurrentStage" — real field name
  closeDate?: string | null;
  siteSurveyTurnaroundTime?: number | null;  // From Project (hubspot.ts)
  constructionTurnaroundTime?: number | null;
  timeCcToPto?: number | null;
  isFirstTimeInspectionPass?: boolean;
  hasInspectionFailed?: boolean;
  inspectionScheduleDate?: string | null;
  projectManager?: string | null;
  dealOwner?: string | null;
  designLead?: string | null;
}

// ---------- Deal Drill-Down ----------

const DEAL_LIST_CAP = 12;

// ---------- Compliance Constants ----------

const STUCK_STATUSES = ["on our way", "started", "in progress"];
const NEVER_STARTED_STATUSES = ["new", "scheduled", "unassigned", "ready to schedule", "ready to build", "ready for inspection"];
const COMPLETED_STATUSES = ["completed", "construction complete", "passed", "partial pass", "failed"];
const GRACE_MS = 86_400_000; // 1 day grace for on-time
const STUCK_THRESHOLD_MS = 86_400_000; // 1 day minimum before showing as stuck

export interface ComplianceCachedJob {
  jobUid: string;
  jobCategory: string;
  jobStatus: string;
  completedDate: Date | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  assignedUsers: unknown;
  hubspotDealId: string | null;
  jobTitle: string | null;
  projectName: string | null;
}

export function buildComplianceData(
  jobs: ComplianceCachedJob[],
  now: Date,
  dealNameMap?: Map<string, string>
): SectionCompliance | null {
  if (jobs.length === 0) return null;

  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Per-employee tracking
  const empOnTime = new Map<string, number>();
  const empMeasurable = new Map<string, number>();
  const empStuck = new Map<string, number>();
  const empNeverStarted = new Map<string, number>();

  // Aggregate counters
  let onTimeCount = 0;
  let measurableCount = 0;
  const stuckJobs: ComplianceJob[] = [];
  let neverStartedCount = 0;

  for (const job of jobs) {
    const status = job.jobStatus.toLowerCase().trim();
    const users = extractAssignedUsers(job.assignedUsers);
    const userName = users[0]?.user_name || "Unassigned";

    // On-time calculation: completed jobs THIS MONTH where completedDate <= scheduledEnd + GRACE_MS
    if (COMPLETED_STATUSES.includes(status) && job.completedDate && job.scheduledEnd) {
      const completed = new Date(job.completedDate);
      if (completed >= mtdStart && completed <= now) {
        measurableCount++;
        empMeasurable.set(userName, (empMeasurable.get(userName) || 0) + 1);

        const completedTime = completed.getTime();
        const deadlineTime = new Date(job.scheduledEnd).getTime() + GRACE_MS;
        if (completedTime <= deadlineTime) {
          onTimeCount++;
          empOnTime.set(userName, (empOnTime.get(userName) || 0) + 1);
        }
      }
    }

    // Stuck jobs: in STUCK_STATUSES and stuck >= STUCK_THRESHOLD_MS (or no scheduledStart)
    if (STUCK_STATUSES.includes(status) && !job.completedDate) {
      if (job.scheduledStart) {
        const elapsed = now.getTime() - new Date(job.scheduledStart).getTime();
        if (elapsed < STUCK_THRESHOLD_MS) continue;
        const daysSinceScheduled = Math.floor(elapsed / (24 * 60 * 60 * 1000));
        const name = job.projectName || (dealNameMap && job.hubspotDealId ? dealNameMap.get(job.hubspotDealId) : null) || job.jobTitle || "Unknown";
        stuckJobs.push({ name, assignedUser: users[0]?.user_name, daysSinceScheduled });
        empStuck.set(userName, (empStuck.get(userName) || 0) + 1);
      } else {
        const name = job.projectName || (dealNameMap && job.hubspotDealId ? dealNameMap.get(job.hubspotDealId) : null) || job.jobTitle || "Unknown";
        stuckJobs.push({ name, assignedUser: users[0]?.user_name });
        empStuck.set(userName, (empStuck.get(userName) || 0) + 1);
      }
    }

    // Never-started: past scheduled start, still in pre-start status
    if (NEVER_STARTED_STATUSES.includes(status) && !job.completedDate && job.scheduledStart) {
      if (new Date(job.scheduledStart).getTime() < now.getTime()) {
        neverStartedCount++;
        empNeverStarted.set(userName, (empNeverStarted.get(userName) || 0) + 1);
      }
    }
  }

  const onTimePercent = measurableCount > 0
    ? Math.round((onTimeCount / measurableCount) * 100)
    : -1;

  // Build per-employee breakdown — collect all employee names across all maps
  const allEmployees = new Set<string>();
  for (const name of empMeasurable.keys()) allEmployees.add(name);
  for (const name of empStuck.keys()) allEmployees.add(name);
  for (const name of empNeverStarted.keys()) allEmployees.add(name);

  const byEmployee: EmployeeCompliance[] = [...allEmployees]
    .filter((name) => name !== "Unassigned")
    .map((name) => {
      const m = empMeasurable.get(name) || 0;
      const ot = empOnTime.get(name) || 0;
      return {
        name,
        onTimePercent: m > 0 ? Math.round((ot / m) * 100) : -1,
        measurableCount: m,
        stuckCount: empStuck.get(name) || 0,
        neverStartedCount: empNeverStarted.get(name) || 0,
      };
    })
    // Sort: worst on-time first, then most stuck, then most never-started
    .sort((a, b) => {
      const aOt = a.onTimePercent >= 0 ? a.onTimePercent : 101;
      const bOt = b.onTimePercent >= 0 ? b.onTimePercent : 101;
      if (aOt !== bOt) return aOt - bOt;
      if (a.stuckCount !== b.stuckCount) return b.stuckCount - a.stuckCount;
      return b.neverStartedCount - a.neverStartedCount;
    });

  return {
    onTimePercent,
    stuckJobs,
    neverStartedCount,
    byEmployee,
  };
}

export function buildDealRows(
  projects: ProjectForMetrics[],
  now: Date,
  assignedUserMap?: Map<string, Map<string, string>>,
  category?: string
): { deals: DealRow[]; totalCount: number } {
  const rows: DealRow[] = projects.map((p) => {
    const daysInStage = p.daysSinceStageMovement ?? 0;
    const stage = normalizeStage(p.stage || "Unknown");

    // Overdue: check each forecasted date against its completion counterpart
    const overdueChecks: Array<{ forecast?: string | null; completed?: string | null }> = [
      { forecast: p.forecastedInstallDate, completed: p.constructionCompleteDate },
      { forecast: p.forecastedInspectionDate, completed: p.inspectionPassDate },
      { forecast: p.forecastedPtoDate, completed: p.ptoGrantedDate },
    ];

    let overdue = false;
    let daysOverdue = 0;

    // Find earliest unmet forecasted date that is in the past
    let earliestOverdueDate: Date | null = null;
    for (const { forecast, completed } of overdueChecks) {
      if (forecast && !completed) {
        const forecastDate = new Date(forecast);
        if (forecastDate < now) {
          if (!earliestOverdueDate || forecastDate < earliestOverdueDate) {
            earliestOverdueDate = forecastDate;
          }
        }
      }
    }

    if (earliestOverdueDate) {
      overdue = true;
      daysOverdue = Math.floor((now.getTime() - earliestOverdueDate.getTime()) / (24 * 60 * 60 * 1000));
    }

    // Assigned user from pre-built map (dealId → category → userName)
    let assignedUser: string | undefined;
    if (assignedUserMap && category && p.id) {
      assignedUser = assignedUserMap.get(String(p.id))?.get(category);
    }

    return {
      name: p.name || `Deal ${p.id ?? "?"}`,
      stage,
      daysInStage,
      overdue,
      daysOverdue,
      assignedUser,
    };
  });

  // Sort: overdue first by daysOverdue desc, then non-overdue by daysInStage desc
  rows.sort((a, b) => {
    if (a.overdue && !b.overdue) return -1;
    if (!a.overdue && b.overdue) return 1;
    if (a.overdue && b.overdue) return b.daysOverdue - a.daysOverdue;
    return b.daysInStage - a.daysInStage;
  });

  return {
    deals: rows.slice(0, DEAL_LIST_CAP),
    totalCount: rows.length,
  };
}

export function buildPipelineData(
  projects: ProjectForMetrics[],
  goals: Record<OfficeMetricName, number>,
  now: Date
): PipelineData {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Stage distribution
  const stageCounts: Record<string, number> = {};
  let overdueCount = 0;
  let totalDaysInStage = 0;
  let daysInStageCount = 0;
  // Prior period avg will be enriched from QC metrics in the orchestrator
  const avgDaysInStagePrior = 0;

  for (const p of projects) {
    const stage = normalizeStage(p.stage || "Unknown");
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;

    // Overdue check — only count a forecast date as overdue if the
    // corresponding milestone has NOT been completed yet. Without this
    // guard, projects in inspection/PTO would be forever "overdue"
    // because their old install forecast is in the past.
    const overdueChecks: Array<{ forecast?: string | null; completed?: string | null }> = [
      { forecast: p.forecastedInstallDate, completed: p.constructionCompleteDate },
      { forecast: p.forecastedInspectionDate, completed: p.inspectionPassDate },
      { forecast: p.forecastedPtoDate, completed: p.ptoGrantedDate },
    ];
    for (const { forecast, completed } of overdueChecks) {
      if (forecast && !completed && new Date(forecast) < now) {
        overdueCount++;
        break;
      }
    }

    // Days in current stage
    if (p.daysSinceStageMovement != null) {
      totalDaysInStage += p.daysSinceStageMovement;
      daysInStageCount++;
    }
  }

  // Completed MTD = projects with PTO date in current month
  const completedMtd = projects.filter((p) => {
    const ptoDate = p.ptoGrantedDate ? new Date(p.ptoGrantedDate) : null;
    return ptoDate && ptoDate >= mtdStart && ptoDate <= now;
  }).length;

  // Recent wins
  const recentWins: string[] = [];
  const ptosThisWeek = projects.filter((p) => {
    const ptoDate = p.ptoGrantedDate ? new Date(p.ptoGrantedDate) : null;
    return ptoDate && ptoDate >= weekAgo && ptoDate <= now;
  }).length;
  if (ptosThisWeek > 0) {
    recentWins.push(`🎉 ${ptosThisWeek} PTO${ptosThisWeek > 1 ? "s" : ""} granted this week`);
  }

  const stageDistribution = ["Survey", "Design", "Permit", "RTB", "Install", "Inspect"]
    .map((stage) => ({ stage, count: stageCounts[stage] || 0 }));

  const { deals, totalCount } = buildDealRows(projects, now);

  return {
    activeProjects: projects.length,
    completedMtd,
    completedGoal: goals.projects_completed,
    overdueCount,
    avgDaysInStage: daysInStageCount > 0 ? Math.round((totalDaysInStage / daysInStageCount) * 10) / 10 : 0,
    avgDaysInStagePrior, // Enriched from QC metrics in orchestrator
    stageDistribution,
    recentWins,
    deals,
    totalCount,
  };
}

// ---------- Zuper Job Aggregation ----------

interface CachedJob {
  jobUid: string;
  jobCategory: string;
  jobStatus: string;
  completedDate: Date | null;
  scheduledStart: Date | null;
  assignedUsers: unknown;
  hubspotDealId: string | null;
}

interface UserJobCount {
  name: string;
  userUid: string;
  count: number;
}

function extractAssignedUsers(assignedUsers: unknown): Array<{ user_uid: string; user_name: string }> {
  if (!Array.isArray(assignedUsers)) return [];
  return assignedUsers
    .filter((u): u is { user_uid: string; user_name: string } =>
      typeof u === "object" && u !== null && "user_uid" in u && "user_name" in u
    );
}

export function buildLeaderboard(
  userCounts: UserJobCount[],
  monthlyHistory?: Map<string, UserJobCount[]>
): PersonStat[] {
  return userCounts
    .sort((a, b) => b.count - a.count)
    .map((u) => {
      const stat: PersonStat = { name: u.name, count: u.count };

      // Compute monthly leader streak — sort keys explicitly (oldest→newest)
      // so streak evaluation is deterministic regardless of Map insertion order.
      if (monthlyHistory) {
        let streak = 0;
        const sortedMonths = [...monthlyHistory.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .reverse(); // newest first for streak counting
        for (const [, monthUsers] of sortedMonths) {
          const leader = monthUsers.sort((a, b) => b.count - a.count)[0];
          if (leader?.userUid === u.userUid) {
            streak++;
          } else {
            break;
          }
        }
        if (streak >= 2) {
          stat.streak = {
            type: "monthly_leader",
            value: streak,
            label: `🔥 ${streak}-mo streak leading`,
          };
        }
      }

      return stat;
    });
}

export async function getZuperJobsByLocation(
  location: string,
  category: string,
  fromDate: Date,
  toDate: Date,
  locationDealIds?: Set<string>
): Promise<CachedJob[]> {
  if (!prisma) return [];

  // When locationDealIds is provided, filter directly by dealId set
  // instead of joining against HubSpotProjectCache (which may be empty).
  const whereClause: Record<string, unknown> = {
    jobCategory: category,
    completedDate: { gte: fromDate, lte: toDate },
    hubspotDealId: { not: null },
  };

  if (locationDealIds && locationDealIds.size > 0) {
    whereClause.hubspotDealId = { in: [...locationDealIds] };
  }

  const jobs = await prisma.zuperJobCache.findMany({
    where: whereClause,
    select: {
      jobUid: true,
      jobCategory: true,
      jobStatus: true,
      completedDate: true,
      scheduledStart: true,
      assignedUsers: true,
      hubspotDealId: true,
    },
  });

  // If no locationDealIds provided, fall back to HubSpotProjectCache join
  if (!locationDealIds) {
    if (jobs.length === 0) return [];
    const dealIds = jobs.map((j) => j.hubspotDealId).filter((id): id is string => id !== null);
    const projectCache = await prisma.hubSpotProjectCache.findMany({
      where: { dealId: { in: dealIds } },
      select: { dealId: true, pbLocation: true },
    });
    const dealLocationMap = new Map(projectCache.map((p) => [p.dealId, p.pbLocation]));
    return jobs.filter((j) => {
      const loc = j.hubspotDealId ? dealLocationMap.get(j.hubspotDealId) : null;
      return normalizeLocation(loc) === location;
    });
  }

  return jobs;
}

/**
 * Fetch all Zuper jobs for a category at a location — no date filter.
 * Compliance needs stuck/never-started jobs that may have no completedDate.
 */
export async function getZuperJobsForCompliance(
  location: string,
  category: string,
  locationDealIds?: Set<string>,
  dealNameMap?: Map<string, string>
): Promise<ComplianceCachedJob[]> {
  if (!prisma) return [];

  // Compliance needs ALL jobs for this category at this location (not just completed).
  // Use locationDealIds to filter by location when available — avoids empty HubSpotProjectCache.
  // Note: compliance scope is all location jobs, not just the section's deal list.
  // Some completed jobs may have moved to a different HubSpot stage, so we query broadly
  // by category + deal set, not by stage.
  const whereClause: Record<string, unknown> = {
    jobCategory: category,
    hubspotDealId: { not: null },
  };

  if (locationDealIds && locationDealIds.size > 0) {
    whereClause.hubspotDealId = { in: [...locationDealIds] };
  }

  const jobs = await prisma.zuperJobCache.findMany({
    where: whereClause,
    select: {
      jobUid: true,
      jobCategory: true,
      jobStatus: true,
      completedDate: true,
      scheduledStart: true,
      scheduledEnd: true,
      assignedUsers: true,
      hubspotDealId: true,
      jobTitle: true,
    },
  });

  if (jobs.length === 0) return [];

  // If no locationDealIds provided, fall back to HubSpotProjectCache join
  let filteredJobs = jobs;
  let resolvedDealNameMap = dealNameMap;

  if (!locationDealIds) {
    const jobDealIds = jobs.map((j) => j.hubspotDealId).filter((id): id is string => id !== null);
    const projectCache = await prisma.hubSpotProjectCache.findMany({
      where: { dealId: { in: jobDealIds } },
      select: { dealId: true, pbLocation: true, dealName: true },
    });
    const dealLocationMap = new Map(projectCache.map((p) => [p.dealId, p.pbLocation]));
    if (!resolvedDealNameMap) {
      resolvedDealNameMap = new Map(projectCache.map((p) => [p.dealId, p.dealName]));
    }
    filteredJobs = jobs.filter((j) => {
      const loc = j.hubspotDealId ? dealLocationMap.get(j.hubspotDealId) : null;
      return normalizeLocation(loc) === location;
    });
  }

  return filteredJobs.map((j) => ({
    jobUid: j.jobUid,
    jobCategory: j.jobCategory,
    jobStatus: j.jobStatus,
    completedDate: j.completedDate,
    scheduledStart: j.scheduledStart,
    scheduledEnd: j.scheduledEnd ?? null,
    assignedUsers: j.assignedUsers,
    hubspotDealId: j.hubspotDealId,
    jobTitle: j.jobTitle ?? null,
    projectName: j.hubspotDealId && resolvedDealNameMap ? resolvedDealNameMap.get(j.hubspotDealId) ?? null : null,
  }));
}

/**
 * Batch-fetch the primary assigned user per (dealId, category) from ZuperJobCache.
 * Returns Map<dealId, Map<category, userName>>.
 * Picks the most relevant job per group: active (no completedDate) over completed,
 * latest scheduledStart first, latest completedDate as tiebreak.
 */
export async function batchZuperAssignedUsers(
  dealIds: string[]
): Promise<Map<string, Map<string, string>>> {
  const result = new Map<string, Map<string, string>>();
  if (!prisma || dealIds.length === 0) return result;

  const jobs = await prisma.zuperJobCache.findMany({
    where: { hubspotDealId: { in: dealIds } },
    select: {
      hubspotDealId: true,
      jobCategory: true,
      assignedUsers: true,
      scheduledStart: true,
      completedDate: true,
    },
    orderBy: [
      { scheduledStart: { sort: "desc", nulls: "last" } },
      { completedDate: { sort: "desc", nulls: "first" } },
    ],
  });

  // Group by (dealId, category) — pick first (best) job per group
  const seen = new Set<string>();

  for (const job of jobs) {
    if (!job.hubspotDealId) continue;
    const key = `${job.hubspotDealId}::${job.jobCategory}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const users = extractAssignedUsers(job.assignedUsers);
    if (users.length === 0) continue;

    if (!result.has(job.hubspotDealId)) {
      result.set(job.hubspotDealId, new Map());
    }
    result.get(job.hubspotDealId)!.set(job.jobCategory, users[0].user_name);
  }

  return result;
}

export async function getScheduledJobsThisWeek(
  location: string,
  category: string,
  now: Date,
  locationDealIds?: Set<string>
): Promise<number> {
  if (!prisma) return 0;

  // Use start of today so we don't miss jobs scheduled earlier today
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekEnd = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const whereClause: Record<string, unknown> = {
    jobCategory: category,
    scheduledStart: { gte: startOfToday, lte: weekEnd },
    hubspotDealId: { not: null },
  };

  if (locationDealIds && locationDealIds.size > 0) {
    whereClause.hubspotDealId = { in: [...locationDealIds] };
  }

  const jobs = await prisma.zuperJobCache.findMany({
    where: whereClause,
    select: { hubspotDealId: true, jobStatus: true },
  });

  // Exclude completed jobs (case-insensitive)
  const activeJobs = jobs.filter(
    (j) => !COMPLETED_STATUSES.includes(j.jobStatus.toLowerCase().trim())
  );

  if (locationDealIds) return activeJobs.length;

  // Fallback to HubSpotProjectCache join
  const dealIds = activeJobs
    .map((j) => j.hubspotDealId)
    .filter((id): id is string => id !== null);

  if (dealIds.length === 0) return 0;

  const projectCache = await prisma.hubSpotProjectCache.findMany({
    where: { dealId: { in: dealIds } },
    select: { dealId: true, pbLocation: true },
  });

  const matching = projectCache.filter(
    (p) => normalizeLocation(p.pbLocation) === location
  );
  return matching.length;
}

// ---------- Monthly Job History (for streak detection) ----------

async function getMonthlyJobHistory(
  location: string,
  category: string,
  now: Date,
  monthsBack: number = 3,
  locationDealIds?: Set<string>
): Promise<Map<string, UserJobCount[]>> {
  const history = new Map<string, UserJobCount[]>();
  if (!prisma) return history;

  const oldestStart = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const latestEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  try {
    const allJobs = await getZuperJobsByLocation(location, category, oldestStart, latestEnd, locationDealIds);

    for (const job of allJobs) {
      if (!job.completedDate) continue;
      const d = new Date(job.completedDate);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

      for (const user of extractAssignedUsers(job.assignedUsers)) {
        if (!history.has(monthKey)) history.set(monthKey, []);
        const monthUsers = history.get(monthKey)!;
        const existing = monthUsers.find((u) => u.userUid === user.user_uid);
        if (existing) {
          existing.count++;
        } else {
          monthUsers.push({ name: user.user_name, userUid: user.user_uid, count: 1 });
        }
      }
    }
  } catch {
    // Non-fatal
  }

  return history;
}

// ---------- Survey Section ----------

export async function buildSurveyData(
  location: string,
  goals: Record<OfficeMetricName, number>,
  now: Date,
  locationProjects?: ProjectForMetrics[],
  assignedUserMap?: Map<string, Map<string, string>>,
  locationDealIds?: Set<string>,
  dealNameMap?: Map<string, string>
): Promise<SurveyData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // MTD completed surveys
  const mtdJobs = await getZuperJobsByLocation(location, "Site Survey", mtdStart, now, locationDealIds);

  // User counts for leaderboard
  const userCounts = new Map<string, UserJobCount>();
  for (const job of mtdJobs) {
    for (const user of extractAssignedUsers(job.assignedUsers)) {
      const existing = userCounts.get(user.user_uid) || {
        name: user.user_name,
        userUid: user.user_uid,
        count: 0,
      };
      existing.count++;
      userCounts.set(user.user_uid, existing);
    }
  }

  // Scheduled this week
  const scheduledThisWeek = await getScheduledJobsThisWeek(location, "Site Survey", now, locationDealIds);

  const surveyHistory = await getMonthlyJobHistory(location, "Site Survey", now, 3, locationDealIds);

  // Deal rows filtered to survey stages
  const surveyProjects = (locationProjects || []).filter(
    (p) => SURVEY_STAGES.has(normalizeStage(p.stage || ""))
  );
  const { deals, totalCount } = buildDealRows(surveyProjects, now, assignedUserMap, "Site Survey");

  // Compliance from Zuper "Site Survey" category
  const complianceJobs = await getZuperJobsForCompliance(location, "Site Survey", locationDealIds, dealNameMap);
  const compliance = buildComplianceData(complianceJobs, now) ?? undefined;

  return {
    completedMtd: mtdJobs.length,
    completedGoal: goals.surveys_completed,
    avgTurnaroundDays: 0, // Populated from QC metrics in the orchestrator
    avgTurnaroundPrior: 0,
    scheduledThisWeek,
    leaderboard: buildLeaderboard([...userCounts.values()], surveyHistory) as EnrichedPersonStat[],
    deals,
    totalCount,
    compliance,
  };
}

// ---------- Install Section ----------

export async function buildInstallData(
  location: string,
  goals: Record<OfficeMetricName, number>,
  now: Date,
  locationProjects?: ProjectForMetrics[],
  assignedUserMap?: Map<string, Map<string, string>>,
  locationDealIds?: Set<string>,
  dealNameMap?: Map<string, string>
): Promise<InstallData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const mtdJobs = await getZuperJobsByLocation(location, "Construction", mtdStart, now, locationDealIds);

  // Split by role (installer vs electrician) using CrewMember lookup
  const installerCounts = new Map<string, UserJobCount>();
  const electricianCounts = new Map<string, UserJobCount>();

  // Fetch crew members to determine roles.
  // An empty locations array means "all locations" (shared crew), so we
  // query members that either explicitly list this location OR have an
  // empty array (serve all offices).
  const crewMembers = await (prisma?.crewMember.findMany({
    where: {
      isActive: true,
      OR: [
        { locations: { hasSome: [location] } },
        { locations: { isEmpty: true } },
      ],
    },
    select: { zuperUserUid: true, role: true, name: true },
  }) ?? []);

  const crewRoleMap = new Map(
    crewMembers.map((c) => [c.zuperUserUid, c.role])
  );

  for (const job of mtdJobs) {
    for (const user of extractAssignedUsers(job.assignedUsers)) {
      const role = crewRoleMap.get(user.user_uid);
      const target = role === "electrician" ? electricianCounts : installerCounts;
      const existing = target.get(user.user_uid) || {
        name: user.user_name,
        userUid: user.user_uid,
        count: 0,
      };
      existing.count++;
      target.set(user.user_uid, existing);
    }
  }

  // Capacity utilization — count distinct crew members with construction availability.
  // CrewAvailability.location stores non-canonical aliases like "DTC" and "SLO",
  // so we query ALL construction availability and filter by normalizing each record's location.
  let capacityUtilization = -1; // -1 means N/A
  const allConstructionAvail = await (prisma?.crewAvailability.findMany({
    where: { jobType: "construction", isActive: true },
    select: { crewMemberId: true, dayOfWeek: true, location: true },
  }) ?? []);
  const availability = allConstructionAvail.filter(
    (slot) => normalizeLocation(slot.location) === location
  );

  if (availability.length > 0) {
    // Count distinct crew members and their available days per week
    const crewDaysPerWeek = new Map<string, number>();
    for (const slot of availability) {
      crewDaysPerWeek.set(
        slot.crewMemberId,
        (crewDaysPerWeek.get(slot.crewMemberId) || 0) + 1
      );
    }
    // Use elapsed days in the month (not total month days) so the
    // denominator matches the MTD numerator. Otherwise capacity reads
    // artificially low for most of the month.
    const dayOfMonth = now.getDate();
    const elapsedWeeks = dayOfMonth / 7;
    let totalAvailableDays = 0;
    for (const daysPerWeek of crewDaysPerWeek.values()) {
      totalAvailableDays += daysPerWeek * elapsedWeeks;
    }
    if (totalAvailableDays > 0) {
      capacityUtilization = Math.round((mtdJobs.length / totalAvailableDays) * 100);
    }
  }

  const scheduledThisWeek = await getScheduledJobsThisWeek(location, "Construction", now, locationDealIds);

  const constructionHistory = await getMonthlyJobHistory(location, "Construction", now, 3, locationDealIds);

  // Split monthly history by role so streaks are evaluated within each
  // population (installers vs electricians) rather than the combined pool.
  function filterHistoryByUids(
    history: Map<string, UserJobCount[]>,
    uidSet: Set<string>
  ): Map<string, UserJobCount[]> {
    const filtered = new Map<string, UserJobCount[]>();
    for (const [month, users] of history) {
      const matching = users.filter((u) => uidSet.has(u.userUid));
      if (matching.length > 0) filtered.set(month, matching);
    }
    return filtered;
  }

  const installerUids = new Set([...installerCounts.keys()]);
  const electricianUids = new Set([...electricianCounts.keys()]);
  // Include UIDs from historical months too (someone may not have current-month jobs)
  for (const [, monthUsers] of constructionHistory) {
    for (const u of monthUsers) {
      const role = crewRoleMap.get(u.userUid);
      if (role === "electrician") electricianUids.add(u.userUid);
      else installerUids.add(u.userUid);
    }
  }

  const installerHistory = filterHistoryByUids(constructionHistory, installerUids);
  const electricianHistory = filterHistoryByUids(constructionHistory, electricianUids);

  // Deal rows filtered to install stages
  const installProjects = (locationProjects || []).filter(
    (p) => INSTALL_STAGES.has(normalizeStage(p.stage || ""))
  );
  const { deals, totalCount } = buildDealRows(installProjects, now, assignedUserMap, "Construction");

  // Compliance from Zuper "Construction" category
  const complianceJobs = await getZuperJobsForCompliance(location, "Construction", locationDealIds, dealNameMap);
  const compliance = buildComplianceData(complianceJobs, now) ?? undefined;

  return {
    completedMtd: mtdJobs.length,
    completedGoal: goals.installs_completed,
    avgDaysPerInstall: 0, // Populated from QC metrics in orchestrator
    avgDaysPerInstallPrior: 0,
    capacityUtilization,
    scheduledThisWeek,
    installerLeaderboard: buildLeaderboard([...installerCounts.values()], installerHistory) as EnrichedPersonStat[],
    electricianLeaderboard: buildLeaderboard([...electricianCounts.values()], electricianHistory) as EnrichedPersonStat[],
    deals,
    totalCount,
    compliance,
  };
}

// ---------- Inspection Section ----------

export async function buildInspectionData(
  location: string,
  goals: Record<OfficeMetricName, number>,
  now: Date,
  locationProjects?: ProjectForMetrics[],
  assignedUserMap?: Map<string, Map<string, string>>,
  locationDealIds?: Set<string>,
  dealNameMap?: Map<string, string>
): Promise<InspectionData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const mtdJobs = await getZuperJobsByLocation(location, "Inspection", mtdStart, now, locationDealIds);

  const userCounts = new Map<string, UserJobCount>();
  for (const job of mtdJobs) {
    for (const user of extractAssignedUsers(job.assignedUsers)) {
      const existing = userCounts.get(user.user_uid) || {
        name: user.user_name,
        userUid: user.user_uid,
        count: 0,
      };
      existing.count++;
      userCounts.set(user.user_uid, existing);
    }
  }

  const inspectionHistory = await getMonthlyJobHistory(location, "Inspection", now, 3, locationDealIds);
  const baseLeaderboard = buildLeaderboard([...userCounts.values()], inspectionHistory);
  const leaderboard: InspectionPersonStat[] = baseLeaderboard.map((entry) => ({
    ...entry,
    passRate: -1,
  }));

  // Deal rows filtered to inspection stages
  const inspectionProjects = (locationProjects || []).filter(
    (p) => INSPECTION_STAGES.has(normalizeStage(p.stage || ""))
  );
  const { deals, totalCount } = buildDealRows(inspectionProjects, now, assignedUserMap, "Inspection");

  // Compliance from Zuper "Inspection" category
  const complianceJobs = await getZuperJobsForCompliance(location, "Inspection", locationDealIds, dealNameMap);
  const compliance = buildComplianceData(complianceJobs, now) ?? undefined;

  return {
    completedMtd: mtdJobs.length,
    completedGoal: goals.inspections_completed,
    firstPassRate: 0, // Populated from QC metrics
    avgConstructionDays: 0,
    avgConstructionDaysPrior: 0,
    avgCcToPtoDays: 0,
    avgCcToPtoDaysPrior: 0,
    leaderboard,
    deals,
    totalCount,
    compliance,
  };
}

// ---------- QC Metrics Enrichment ----------

/**
 * Fetches QC turnaround metrics from the same logic as /api/hubspot/qc-metrics
 * and patches the section data objects with rolling averages and trend comparisons.
 */
async function enrichWithQcMetrics(
  location: string,
  pipeline: PipelineData,
  surveys: SurveyData,
  installs: InstallData,
  inspections: InspectionData
): Promise<void> {
  try {
    // Reuse appCache to avoid redundant QC computation
    const { appCache, CACHE_KEYS } = await import("@/lib/cache");

    // Fetch QC data for 60-day and prior 60-day windows
    // Uses the same project data that qc-metrics route.ts computes
    const { data: allProjects } = await appCache.getOrFetch(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: false })
    );

    const locProjects = (allProjects || []).filter(
      (p: ProjectForMetrics) => normalizeLocation(p.pbLocation) === location
    );

    // Compute rolling 60-day averages from projects with constructionCompleteDate
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const oneTwentyDaysAgo = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);

    const recentProjects = locProjects.filter((p: ProjectForMetrics) =>
      p.constructionCompleteDate && new Date(p.constructionCompleteDate) >= sixtyDaysAgo
    );
    const priorProjects = locProjects.filter((p: ProjectForMetrics) =>
      p.constructionCompleteDate &&
      new Date(p.constructionCompleteDate) >= oneTwentyDaysAgo &&
      new Date(p.constructionCompleteDate) < sixtyDaysAgo
    );

    // Helper to compute average of a numeric field
    function avg(arr: ProjectForMetrics[], field: keyof ProjectForMetrics): number {
      const vals = arr.map((p) => p[field]).filter((v): v is number => typeof v === "number" && v > 0);
      if (vals.length === 0) return 0;
      return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    }

    // Use the real Project field names (from hubspot.ts):
    //   siteSurveyTurnaroundTime — days from survey schedule to DA ready
    //   constructionTurnaroundTime — days from construction start to complete
    //   timeCcToPto — days from construction complete to PTO
    //   isFirstTimeInspectionPass — boolean, true if inspection passed first try

    // Surveys: turnaround
    surveys.avgTurnaroundDays = avg(recentProjects, "siteSurveyTurnaroundTime");
    surveys.avgTurnaroundPrior = avg(priorProjects, "siteSurveyTurnaroundTime");

    // Per-surveyor turnaround enrichment
    for (const entry of surveys.leaderboard) {
      const surveyorProjects = recentProjects.filter(
        (p: ProjectForMetrics) =>
          p.siteSurveyor && nameMatchesLoosely(p.siteSurveyor, entry.name) &&
          typeof p.siteSurveyTurnaroundTime === "number" &&
          p.siteSurveyTurnaroundTime > 0
      );
      if (surveyorProjects.length > 0) {
        const total = surveyorProjects.reduce(
          (sum, p) => sum + (p.siteSurveyTurnaroundTime || 0),
          0
        );
        (entry as EnrichedPersonStat).avgTurnaround = Math.round((total / surveyorProjects.length) * 10) / 10;
      }
    }

    // Installs: construction turnaround
    installs.avgDaysPerInstall = avg(recentProjects, "constructionTurnaroundTime");
    installs.avgDaysPerInstallPrior = avg(priorProjects, "constructionTurnaroundTime");

    // Inspections: construction time, CC→PTO, first-pass rate
    inspections.avgConstructionDays = avg(recentProjects, "constructionTurnaroundTime");
    inspections.avgConstructionDaysPrior = avg(priorProjects, "constructionTurnaroundTime");
    inspections.avgCcToPtoDays = avg(recentProjects, "timeCcToPto");
    inspections.avgCcToPtoDaysPrior = avg(priorProjects, "timeCcToPto");

    // First-pass inspection rate — denominator includes ALL inspected projects
    // (passed OR failed), not just passed, to avoid inflating the rate.
    const withInspection = recentProjects.filter(
      (p: ProjectForMetrics) => p.inspectionPassDate || p.hasInspectionFailed
    );
    if (withInspection.length > 0) {
      const firstTimePasses = withInspection.filter(
        (p: ProjectForMetrics) => p.isFirstTimeInspectionPass
      ).length;
      inspections.firstPassRate = Math.round(
        (firstTimePasses / withInspection.length) * 100
      );
    }

    // Per-inspector pass rate + consecutive pass streak enrichment
    if (prisma) {
      try {
        // Single consolidated query for 120-day window (reused for both pass rate and streaks)
        const allInspectionJobs = await prisma.zuperJobCache.findMany({
          where: {
            jobCategory: "Inspection",
            completedDate: { gte: oneTwentyDaysAgo, lte: now },
            hubspotDealId: { not: null },
          },
          select: {
            assignedUsers: true,
            hubspotDealId: true,
            completedDate: true,
          },
          orderBy: { completedDate: "desc" },
        });

        // Build dealId → isFirstTimePass map
        const passMap = new Map<string, boolean>();
        for (const p of locProjects) {
          if (p.id && p.inspectionPassDate) {
            passMap.set(String(p.id), p.isFirstTimeInspectionPass === true);
          }
        }

        // Per-inspector pass rate (60-day window)
        const sixtyDayJobs = allInspectionJobs.filter(
          (j: { completedDate: Date | null; hubspotDealId: string | null; assignedUsers: unknown }) => j.completedDate && j.completedDate >= sixtyDaysAgo
        );
        const inspectorStats = new Map<string, { passes: number; total: number }>();

        for (const job of sixtyDayJobs) {
          const dealId = job.hubspotDealId;
          if (!dealId || !passMap.has(dealId)) continue;

          const passed = passMap.get(dealId)!;
          for (const user of extractAssignedUsers(job.assignedUsers)) {
            const stats = inspectorStats.get(user.user_name) || { passes: 0, total: 0 };
            stats.total++;
            if (passed) stats.passes++;
            inspectorStats.set(user.user_name, stats);
          }
        }

        for (const entry of inspections.leaderboard) {
          const stats = inspectorStats.get(entry.name);
          if (stats && stats.total > 0) {
            entry.passRate = Math.round((stats.passes / stats.total) * 100);
          }
        }

        // Consecutive pass streak (120-day window, ordered desc)
        const streakMap = new Map<string, number>();
        const streakBroken = new Set<string>();

        for (const job of allInspectionJobs) {
          const dealId = job.hubspotDealId;
          if (!dealId || !passMap.has(dealId)) continue;

          const passed = passMap.get(dealId)!;
          for (const user of extractAssignedUsers(job.assignedUsers)) {
            if (streakBroken.has(user.user_name)) continue;
            if (passed) {
              streakMap.set(user.user_name, (streakMap.get(user.user_name) || 0) + 1);
            } else {
              streakBroken.add(user.user_name);
            }
          }
        }

        for (const entry of inspections.leaderboard) {
          const streak = streakMap.get(entry.name);
          if (streak && streak >= 3) {
            entry.consecutivePasses = streak;
          }
        }
      } catch (err) {
        console.warn("[office-performance] Per-inspector enrichment failed:", err);
      }
    }

    // Pipeline: avg days in stage prior period
    pipeline.avgDaysInStagePrior = avg(priorProjects, "daysSinceStageMovement");
  } catch (err) {
    console.error("[office-performance] QC metrics enrichment failed:", err);
    // Non-fatal — sections will show 0/"--" for turnaround metrics
  }
}

// ---------- Main Orchestrator ----------

export async function getOfficePerformanceData(
  location: string
): Promise<OfficePerformanceData> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // Fetch goals
  const goals = await getGoalsForLocation(location, month, year);

  // Fetch projects for this location — active for display, all for Zuper joins.
  // The locationDealIds set must include inactive/closed deals so that compliance
  // can count recently completed Zuper jobs whose HubSpot deals have since closed.
  const allProjects = await fetchAllProjects({ activeOnly: false });
  const allLocationProjects = (allProjects || []).filter(
    (p: ProjectForMetrics) => normalizeLocation(p.pbLocation) === location
  );
  const locationProjects = allLocationProjects.filter(
    (p: ProjectForMetrics) => p.stage && !["closed lost", "closed won"].includes(p.stage.toLowerCase())
  );

  // Build dealId sets and maps from ALL location projects (active + closed).
  // This avoids joining against HubSpotProjectCache (which may be empty).
  const allDealIds = allLocationProjects.filter((p: ProjectForMetrics) => p.id).map((p: ProjectForMetrics) => String(p.id));
  const locationDealIds = new Set(allDealIds);
  const dealNameMap = new Map(
    allLocationProjects
      .filter((p: ProjectForMetrics) => p.id && p.name)
      .map((p: ProjectForMetrics) => [String(p.id), p.name!])
  );

  // Batch-fetch Zuper assigned users for deal rows (active deals only)
  const activeDealIds = locationProjects.filter((p: ProjectForMetrics) => p.id).map((p: ProjectForMetrics) => String(p.id));
  const assignedUserMap = await batchZuperAssignedUsers(activeDealIds);

  // Build pipeline data
  const pipeline = buildPipelineData(locationProjects, goals, now);

  // Build section data in parallel
  const [surveys, installs, inspections] = await Promise.all([
    buildSurveyData(location, goals, now, locationProjects, assignedUserMap, locationDealIds, dealNameMap),
    buildInstallData(location, goals, now, locationProjects, assignedUserMap, locationDealIds, dealNameMap),
    buildInspectionData(location, goals, now, locationProjects, assignedUserMap, locationDealIds, dealNameMap),
  ]);

  // Enrich with QC metrics turnaround times
  await enrichWithQcMetrics(location, pipeline, surveys, installs, inspections);

  // Individual achievements across sections
  const achievements: string[] = [];

  for (const entry of surveys.leaderboard) {
    if (entry.count >= 10) {
      achievements.push(`📍 ${entry.name.split(" ")[0]} hit ${entry.count} surveys this month!`);
    }
  }

  for (const entry of installs.installerLeaderboard) {
    if (entry.count >= 8) {
      achievements.push(`⚡ ${entry.name.split(" ")[0]} completed ${entry.count} installs!`);
    }
  }

  for (const entry of inspections.leaderboard) {
    if (entry.passRate >= 95 && entry.count >= 3) {
      achievements.push(`✅ ${entry.name.split(" ")[0]} — ${entry.passRate}% first-pass rate!`);
    }
    if (entry.consecutivePasses && entry.consecutivePasses >= 5) {
      achievements.push(`🔥 ${entry.name.split(" ")[0]} — ${entry.consecutivePasses} inspections passed in a row!`);
    }
  }

  pipeline.recentWins = [...pipeline.recentWins, ...achievements].slice(0, 4);

  return {
    location,
    lastUpdated: now.toISOString(),
    pipeline,
    surveys,
    installs,
    inspections,
  };
}
