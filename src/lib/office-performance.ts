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
  PipelinePersonStat,
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

// ---------- Pipeline Aggregation ----------

// Matches the real RawProject shape from src/lib/types.ts and Project from src/lib/hubspot.ts
interface ProjectForMetrics {
  id?: number;  // HubSpot deal ID
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
  projectManager?: string | null;
  dealOwner?: string | null;
  designLead?: string | null;
}

function buildPipelinePersonLeaderboard(
  projects: ProjectForMetrics[],
  field: keyof ProjectForMetrics,
  now: Date
): PipelinePersonStat[] {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const personMap = new Map<string, { active: number; completed: number; totalDays: number; daysCount: number }>();

  for (const p of projects) {
    const name = p[field] as string | null | undefined;
    if (!name || name.trim() === "") continue;

    const trimmed = name.trim();
    const existing = personMap.get(trimmed) || { active: 0, completed: 0, totalDays: 0, daysCount: 0 };
    existing.active++;

    const ptoDate = p.ptoGrantedDate ? new Date(p.ptoGrantedDate) : null;
    if (ptoDate && ptoDate >= mtdStart && ptoDate <= now) {
      existing.completed++;
    }

    if (p.daysSinceStageMovement != null) {
      existing.totalDays += p.daysSinceStageMovement;
      existing.daysCount++;
    }

    personMap.set(trimmed, existing);
  }

  return [...personMap.entries()]
    .map(([name, stats]) => ({
      name,
      activeCount: stats.active,
      completedMtd: stats.completed,
      avgDaysInStage: stats.daysCount > 0
        ? Math.round((stats.totalDays / stats.daysCount) * 10) / 10
        : undefined,
    }))
    .sort((a, b) => b.activeCount - a.activeCount)
    .slice(0, 8);
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

  const pmLeaderboard = buildPipelinePersonLeaderboard(projects, "projectManager", now);
  const designerLeaderboard = buildPipelinePersonLeaderboard(projects, "designLead", now);
  const ownerLeaderboard = buildPipelinePersonLeaderboard(projects, "dealOwner", now);

  // Individual achievements from PM leaderboard
  for (const pm of pmLeaderboard) {
    if (pm.completedMtd >= 5) {
      recentWins.push(`🌟 ${pm.name.split(" ")[0]} completed ${pm.completedMtd} projects this month!`);
    }
  }

  return {
    activeProjects: projects.length,
    completedMtd,
    completedGoal: goals.projects_completed,
    overdueCount,
    avgDaysInStage: daysInStageCount > 0 ? Math.round((totalDaysInStage / daysInStageCount) * 10) / 10 : 0,
    avgDaysInStagePrior, // Enriched from QC metrics in orchestrator
    stageDistribution,
    recentWins,
    pmLeaderboard,
    designerLeaderboard,
    ownerLeaderboard,
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
  toDate: Date
): Promise<CachedJob[]> {
  if (!prisma) return [];

  // Query ZuperJobCache, join with HubSpotProjectCache for location
  const jobs = await prisma.zuperJobCache.findMany({
    where: {
      jobCategory: category,
      completedDate: { gte: fromDate, lte: toDate },
      hubspotDealId: { not: null },
    },
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

  // Filter by location via HubSpotProjectCache
  if (jobs.length === 0) return [];

  const dealIds = jobs
    .map((j) => j.hubspotDealId)
    .filter((id): id is string => id !== null);

  const projectCache = await prisma.hubSpotProjectCache.findMany({
    where: { dealId: { in: dealIds } },
    select: { dealId: true, pbLocation: true },
  });

  const dealLocationMap = new Map(
    projectCache.map((p) => [p.dealId, p.pbLocation])
  );

  return jobs.filter((j) => {
    const loc = j.hubspotDealId ? dealLocationMap.get(j.hubspotDealId) : null;
    return normalizeLocation(loc) === location;
  });
}

export async function getScheduledJobsThisWeek(
  location: string,
  category: string,
  now: Date
): Promise<number> {
  if (!prisma) return 0;

  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const jobs = await prisma.zuperJobCache.findMany({
    where: {
      jobCategory: category,
      jobStatus: { in: ["SCHEDULED", "UNSCHEDULED"] },
      scheduledStart: { gte: now, lte: weekEnd },
      hubspotDealId: { not: null },
    },
    select: { hubspotDealId: true },
  });

  const dealIds = jobs
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
  monthsBack: number = 3
): Promise<Map<string, UserJobCount[]>> {
  const history = new Map<string, UserJobCount[]>();
  if (!prisma) return history;

  const oldestStart = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const latestEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  try {
    const allJobs = await getZuperJobsByLocation(location, category, oldestStart, latestEnd);

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
  now: Date
): Promise<SurveyData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // MTD completed surveys
  const mtdJobs = await getZuperJobsByLocation(location, "Site Survey", mtdStart, now);

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
  const scheduledThisWeek = await getScheduledJobsThisWeek(location, "Site Survey", now);

  const surveyHistory = await getMonthlyJobHistory(location, "Site Survey", now, 3);

  return {
    completedMtd: mtdJobs.length,
    completedGoal: goals.surveys_completed,
    avgTurnaroundDays: 0, // Populated from QC metrics in the orchestrator
    avgTurnaroundPrior: 0,
    scheduledThisWeek,
    leaderboard: buildLeaderboard([...userCounts.values()], surveyHistory) as EnrichedPersonStat[],
  };
}

// ---------- Install Section ----------

export async function buildInstallData(
  location: string,
  goals: Record<OfficeMetricName, number>,
  now: Date
): Promise<InstallData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const mtdJobs = await getZuperJobsByLocation(location, "Construction", mtdStart, now);

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

  const scheduledThisWeek = await getScheduledJobsThisWeek(location, "Construction", now);

  const constructionHistory = await getMonthlyJobHistory(location, "Construction", now, 3);

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

  return {
    completedMtd: mtdJobs.length,
    completedGoal: goals.installs_completed,
    avgDaysPerInstall: 0, // Populated from QC metrics in orchestrator
    avgDaysPerInstallPrior: 0,
    capacityUtilization,
    scheduledThisWeek,
    installerLeaderboard: buildLeaderboard([...installerCounts.values()], installerHistory) as EnrichedPersonStat[],
    electricianLeaderboard: buildLeaderboard([...electricianCounts.values()], electricianHistory) as EnrichedPersonStat[],
  };
}

// ---------- Inspection Section ----------

export async function buildInspectionData(
  location: string,
  goals: Record<OfficeMetricName, number>,
  now: Date
): Promise<InspectionData> {
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const mtdJobs = await getZuperJobsByLocation(location, "Inspection", mtdStart, now);

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

  const inspectionHistory = await getMonthlyJobHistory(location, "Inspection", now, 3);
  const baseLeaderboard = buildLeaderboard([...userCounts.values()], inspectionHistory);
  const leaderboard: InspectionPersonStat[] = baseLeaderboard.map((entry) => ({
    ...entry,
    passRate: -1,
  }));

  return {
    completedMtd: mtdJobs.length,
    completedGoal: goals.inspections_completed,
    firstPassRate: 0, // Populated from QC metrics
    avgConstructionDays: 0,
    avgConstructionDaysPrior: 0,
    avgCcToPtoDays: 0,
    avgCcToPtoDaysPrior: 0,
    leaderboard,
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

    // First-pass inspection rate
    const withInspection = recentProjects.filter(
      (p: ProjectForMetrics) => p.inspectionPassDate
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

  // Fetch projects for this location
  const allProjects = await fetchAllProjects({ activeOnly: true });
  const locationProjects = (allProjects || []).filter(
    (p: ProjectForMetrics) => normalizeLocation(p.pbLocation) === location
  );

  // Build pipeline data
  const pipeline = buildPipelineData(locationProjects, goals, now);

  // Build section data in parallel
  const [surveys, installs, inspections] = await Promise.all([
    buildSurveyData(location, goals, now),
    buildInstallData(location, goals, now),
    buildInspectionData(location, goals, now),
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
