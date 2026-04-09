import { prisma } from "@/lib/db";
import { fetchAllProjects } from "@/lib/hubspot";
import { normalizeLocation } from "@/lib/locations";
import { handleLookup } from "@/app/api/zuper/jobs/lookup/route";
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
} from "@/lib/office-performance-types";
import { computeLocationCompliance } from "@/lib/compliance-compute";

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
const INSTALL_STAGES = new Set(["Install"]);
const INSPECTION_STAGES = new Set(["Inspect", "PTO"]);

/** Stages the ops team considers "active" — excludes Design, Permitting, Close Out, PTO, On Hold */
const OPS_ACTIVE_STAGES = new Set(["Survey", "Install", "Inspect"]);

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
  siteSurveyCompletionDate?: string | null;
  daysSinceStageMovement?: number;        // NOT "daysInCurrentStage" — real field name
  closeDate?: string | null;
  siteSurveyTurnaroundTime?: number | null;  // From Project (hubspot.ts)
  constructionTurnaroundTime?: number | null;
  timeCcToPto?: number | null;
  isFirstTimeInspectionPass?: boolean;
  hasInspectionFailed?: boolean;
  inspectionScheduleDate?: string | null;
  siteSurveyScheduleDate?: string | null;
  projectManager?: string | null;
  dealOwner?: string | null;
  designLead?: string | null;
  installCrew?: string | null;
  hasInspectionFailedNotRejected?: boolean;
}

// ---------- Deal Drill-Down ----------

const DEAL_LIST_CAP = 12;

// ---------- Compliance Constants ----------

// Completed statuses used for scheduled-this-week filtering
const COMPLETED_STATUSES_LIST = [
  "completed", "construction complete", "passed", "partial pass", "failed",
];

export function buildDealRows(
  projects: ProjectForMetrics[],
  now: Date,
  assignedUserMap?: Map<string, Map<string, string[]>>,
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

    // Assigned users: resolved via Zuper 4-pass lookup (same as schedulers)
    let assignedUsers: string[] | undefined;
    if (assignedUserMap && category && p.id) {
      assignedUsers = assignedUserMap.get(String(p.id))?.get(category);
    }

    return {
      name: p.name || `Deal ${p.id ?? "?"}`,
      stage,
      daysInStage,
      overdue,
      daysOverdue,
      assignedUsers,
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

  const stageDistribution = ["Survey", "Install", "Inspect"]
    .map((stage) => ({ stage, count: stageCounts[stage] || 0 }));

  // Pipeline deals: only show ops-active stages (Survey, RTB/Install, Inspect)
  const opsProjects = projects.filter(
    (p) => OPS_ACTIVE_STAGES.has(normalizeStage(p.stage || ""))
  );
  const { deals, totalCount } = buildDealRows(opsProjects, now);

  // Count only ops-relevant stages (Survey, RTB/Install, Inspect)
  const opsActiveCount = projects.filter(
    (p) => OPS_ACTIVE_STAGES.has(normalizeStage(p.stage || ""))
  ).length;

  return {
    activeProjects: opsActiveCount,
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
 * Resolve assigned users via the same 4-pass Zuper lookup the schedulers use:
 * DB cache → custom field deal ID → tags → fuzzy name match.
 * Returns Map<dealId, Map<category, userName>>.
 */
export async function resolveZuperAssignedUsers(
  dealIds: string[],
  dealNameMap: Map<string, string>
): Promise<Map<string, Map<string, string[]>>> {
  const result = new Map<string, Map<string, string[]>>();
  if (dealIds.length === 0) return result;

  const projectNames = dealIds.map((id) => dealNameMap.get(id) || "");

  // Look up all three categories in parallel using the scheduler's handleLookup
  const categories = ["site-survey", "construction", "inspection"] as const;
  const displayNames = ["Site Survey", "Construction", "Inspection"] as const;

  const responses = await Promise.all(
    categories.map((cat) =>
      handleLookup(dealIds, projectNames, cat).catch((err) => {
        console.warn(`[office-performance] Zuper lookup for ${cat} failed:`, err);
        return null;
      })
    )
  );

  for (let i = 0; i < categories.length; i++) {
    const resp = responses[i];
    if (!resp) continue;

    let data: { jobs?: Record<string, { assignedTo?: string[] }> };
    try {
      data = await resp.json();
    } catch {
      continue;
    }
    if (!data?.jobs) continue;

    const displayName = displayNames[i];
    for (const [dealId, jobInfo] of Object.entries(data.jobs)) {
      if (jobInfo.assignedTo && jobInfo.assignedTo.length > 0) {
        if (!result.has(dealId)) result.set(dealId, new Map());
        result.get(dealId)!.set(displayName, jobInfo.assignedTo);
      }
    }
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
    (j) => !COMPLETED_STATUSES_LIST.includes(j.jobStatus.toLowerCase().trim())
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

// ---------- Scheduled This Week (HubSpot properties) ----------

/**
 * Count projects scheduled this week using HubSpot date properties.
 * More reliable than ZuperJobCache which requires deal linkage.
 */
function countScheduledThisWeek(
  projects: ProjectForMetrics[],
  category: string,
  now: Date
): number {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekEnd = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

  return projects.filter((p) => {
    let scheduleDate: string | null | undefined;
    if (category === "Site Survey") scheduleDate = p.siteSurveyScheduleDate;
    else if (category === "Construction") scheduleDate = p.constructionScheduleDate;
    else if (category === "Inspection") scheduleDate = p.inspectionScheduleDate;
    if (!scheduleDate) return false;

    const d = new Date(scheduleDate);
    // Scheduled in this week AND not already completed for this category
    if (d < startOfToday || d > weekEnd) return false;

    // Exclude if the milestone is already done
    if (category === "Site Survey" && p.siteSurveyCompletionDate) return false;
    if (category === "Construction" && p.constructionCompleteDate) return false;
    if (category === "Inspection" && p.inspectionPassDate) return false;

    return true;
  }).length;
}

// ---------- Survey Section ----------

export async function buildSurveyData(
  location: string,
  goals: Record<OfficeMetricName, number>,
  now: Date,
  locationProjects?: ProjectForMetrics[],
  assignedUserMap?: Map<string, Map<string, string[]>>,
  locationDealIds?: Set<string>,
  dealNameMap?: Map<string, string>
): Promise<SurveyData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // MTD completed surveys — count from HubSpot property (source of truth)
  const completedMtd = (locationProjects || []).filter((p) => {
    const d = p.siteSurveyCompletionDate ? new Date(p.siteSurveyCompletionDate) : null;
    return d && d >= mtdStart && d <= now;
  }).length;

  // Zuper jobs for leaderboard user counts
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

  // Scheduled this week — from HubSpot schedule date (source of truth)
  const scheduledThisWeek = countScheduledThisWeek(locationProjects || [], "Site Survey", now);

  const surveyHistory = await getMonthlyJobHistory(location, "Site Survey", now, 3, locationDealIds);

  // Deal rows filtered to survey stages
  const surveyProjects = (locationProjects || []).filter(
    (p) => SURVEY_STAGES.has(normalizeStage(p.stage || ""))
  );
  const { deals, totalCount } = buildDealRows(surveyProjects, now, assignedUserMap, "Site Survey");

  // Compliance from Zuper "Site Survey" category
  // Compliance is populated by the orchestrator via computeLocationCompliance
  const compliance = undefined;

  return {
    completedMtd,
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
  assignedUserMap?: Map<string, Map<string, string[]>>,
  locationDealIds?: Set<string>,
  dealNameMap?: Map<string, string>
): Promise<InstallData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // MTD completed installs — count from HubSpot property (source of truth)
  const completedMtd = (locationProjects || []).filter((p) => {
    const d = p.constructionCompleteDate ? new Date(p.constructionCompleteDate) : null;
    return d && d >= mtdStart && d <= now;
  }).length;

  // Zuper jobs for leaderboard and capacity calculations
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

  // Scheduled this week — from HubSpot construction_schedule_date (source of truth)
  const scheduledThisWeek = countScheduledThisWeek(locationProjects || [], "Construction", now);

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
  // Compliance is populated by the orchestrator via computeLocationCompliance
  const compliance = undefined;

  return {
    completedMtd,
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
  assignedUserMap?: Map<string, Map<string, string[]>>,
  locationDealIds?: Set<string>,
  dealNameMap?: Map<string, string>
): Promise<InspectionData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // MTD completed inspections — count from HubSpot property (source of truth)
  const completedMtd = (locationProjects || []).filter((p) => {
    const d = p.inspectionPassDate ? new Date(p.inspectionPassDate) : null;
    return d && d >= mtdStart && d <= now;
  }).length;

  // Zuper jobs for leaderboard user counts
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
  // Compliance is populated by the orchestrator via computeLocationCompliance
  const compliance = undefined;

  return {
    completedMtd,
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

    // Inspections: construction time, CC→Inspection pass, first-pass rate
    inspections.avgConstructionDays = avg(recentProjects, "constructionTurnaroundTime");
    inspections.avgConstructionDaysPrior = avg(priorProjects, "constructionTurnaroundTime");

    // CC → Inspection: compute from constructionCompleteDate to inspectionPassDate
    function avgCcToInspection(projects: ProjectForMetrics[]): number {
      const vals = projects
        .filter((p) => p.constructionCompleteDate && p.inspectionPassDate)
        .map((p) => {
          const cc = new Date(p.constructionCompleteDate!).getTime();
          const insp = new Date(p.inspectionPassDate!).getTime();
          return (insp - cc) / (1000 * 60 * 60 * 24);
        })
        .filter((d) => d > 0);
      if (vals.length === 0) return 0;
      return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    }
    inspections.avgCcToPtoDays = avgCcToInspection(recentProjects);
    inspections.avgCcToPtoDaysPrior = avgCcToInspection(priorProjects);

    // First-pass inspection rate — uses ALL location projects (not just
    // recentProjects which filters by constructionCompleteDate). This ensures
    // projects that failed inspection and haven't re-passed are included in
    // the denominator even if their construction completed long ago.
    const withInspection = locProjects.filter((p: ProjectForMetrics) => {
      // Include if inspection passed OR failed within the 60-day window
      const passDate = p.inspectionPassDate ? new Date(p.inspectionPassDate) : null;
      const schedDate = p.inspectionScheduleDate ? new Date(p.inspectionScheduleDate) : null;
      const relevantDate = passDate || schedDate;
      if (relevantDate && relevantDate >= sixtyDaysAgo) return true;
      // Also include projects currently stuck with a failed inspection (no pass date)
      if (p.hasInspectionFailed && !p.inspectionPassDate) return true;
      return false;
    });
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

  // Fetch active projects for this location.
  // Uses activeOnly: true to avoid fetching all historical deals (which causes
  // HubSpot rate limits and Vercel timeouts). The small coverage gap for
  // recently-closed deals is acceptable — compliance mostly cares about
  // active jobs on active deals.
  const allProjects = await fetchAllProjects({ activeOnly: true });
  const locationProjects = (allProjects || []).filter(
    (p: ProjectForMetrics) => normalizeLocation(p.pbLocation) === location
  );

  // Build dealId sets and maps from active location projects.
  // This avoids joining against HubSpotProjectCache (which may be empty).
  const dealIds = locationProjects.filter((p: ProjectForMetrics) => p.id).map((p: ProjectForMetrics) => String(p.id));
  const locationDealIds = new Set(dealIds);
  const dealNameMap = new Map(
    locationProjects
      .filter((p: ProjectForMetrics) => p.id && p.name)
      .map((p: ProjectForMetrics) => [String(p.id), p.name!])
  );

  // Resolve assigned users via Zuper 4-pass lookup (same as schedulers)
  const assignedUserMap = await resolveZuperAssignedUsers(dealIds, dealNameMap);

  // Build pipeline data
  const pipeline = buildPipelineData(locationProjects, goals, now);

  // Build section data in parallel
  const [surveys, installs, inspections] = await Promise.all([
    buildSurveyData(location, goals, now, locationProjects, assignedUserMap, locationDealIds, dealNameMap),
    buildInstallData(location, goals, now, locationProjects, assignedUserMap, locationDealIds, dealNameMap),
    buildInspectionData(location, goals, now, locationProjects, assignedUserMap, locationDealIds, dealNameMap),
  ]);

  // Enrich with QC metrics and live Zuper compliance in parallel
  const [, surveyCompliance, installCompliance, inspectionCompliance] = await Promise.all([
    enrichWithQcMetrics(location, pipeline, surveys, installs, inspections),
    computeLocationCompliance("Site Survey", location).catch((err) => {
      console.warn("[office-performance] Survey compliance fetch failed:", err);
      return null;
    }),
    computeLocationCompliance("Construction", location).catch((err) => {
      console.warn("[office-performance] Install compliance fetch failed:", err);
      return null;
    }),
    computeLocationCompliance("Inspection", location).catch((err) => {
      console.warn("[office-performance] Inspection compliance fetch failed:", err);
      return null;
    }),
  ]);

  // Patch compliance data into section objects
  if (surveyCompliance) {
    surveys.compliance = {
      totalJobs: surveyCompliance.summary.totalJobs,
      completedJobs: surveyCompliance.summary.completedJobs,
      onTimePercent: surveyCompliance.summary.onTimePercent,
      stuckJobs: surveyCompliance.stuckJobs,
      neverStartedCount: surveyCompliance.summary.neverStartedCount,
      avgDaysToComplete: surveyCompliance.summary.avgDaysToComplete,
      avgDaysLate: surveyCompliance.summary.avgDaysLate,
      oowOnTimePercent: surveyCompliance.summary.oowOnTimePercent,
      byEmployee: surveyCompliance.byEmployee,
    };
  }
  if (installCompliance) {
    installs.compliance = {
      totalJobs: installCompliance.summary.totalJobs,
      completedJobs: installCompliance.summary.completedJobs,
      onTimePercent: installCompliance.summary.onTimePercent,
      stuckJobs: installCompliance.stuckJobs,
      neverStartedCount: installCompliance.summary.neverStartedCount,
      avgDaysToComplete: installCompliance.summary.avgDaysToComplete,
      avgDaysLate: installCompliance.summary.avgDaysLate,
      oowOnTimePercent: installCompliance.summary.oowOnTimePercent,
      byEmployee: installCompliance.byEmployee,
    };
  }
  if (inspectionCompliance) {
    inspections.compliance = {
      totalJobs: inspectionCompliance.summary.totalJobs,
      completedJobs: inspectionCompliance.summary.completedJobs,
      onTimePercent: inspectionCompliance.summary.onTimePercent,
      stuckJobs: inspectionCompliance.stuckJobs,
      neverStartedCount: inspectionCompliance.summary.neverStartedCount,
      avgDaysToComplete: inspectionCompliance.summary.avgDaysToComplete,
      avgDaysLate: inspectionCompliance.summary.avgDaysLate,
      oowOnTimePercent: inspectionCompliance.summary.oowOnTimePercent,
      byEmployee: inspectionCompliance.byEmployee,
    };
  }

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
