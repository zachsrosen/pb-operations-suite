import { prisma } from "@/lib/db";
import { fetchAllProjects, searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
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
  TeamResultsData,
  CrewMemberStats,
  RecentWin,
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
  systemSizeKwdc?: number;
  batteryCount?: number;  // battery.count + battery.expansionCount
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

// ---------- Completed Projects Fetch ----------

// Properties needed for ProjectForMetrics from completed deals
const COMPLETED_DEAL_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "dealstage",
  "pb_location",
  "construction_complete_date",
  "site_survey_date",
  "inspections_completion_date",
  "site_survey_schedule_date",
  "install_schedule_date",
  "inspections_schedule_date",
  "pto_completion_date",
  "closedate",
  "forecasted_installation_date",
  "forecasted_inspection_date",
  "forecasted_pto_date",
  "hs_v2_date_entered_current_stage",
  "site_survey_turnaround_time",
  "construction_turnaround_time",
  "time_between_cc___pto",
  "first_time_inspection_pass_",
  "has_inspection_failed_",
  "has_inspection_failed__not_rejected__",
  "calculated_system_size__kwdc_",
  "battery_count",
  "battery_expansion_count",
  "site_surveyor",
  "project_manager",
  "hubspot_owner_id",
  "design",
  "install_crew",
];

const PROJECT_COMPLETE_STAGE_ID = "20440343";
const PROJECT_PIPELINE_ID = "6900017";

/**
 * Fetch Project Complete deals with any relevant activity date in the given year.
 * Uses OR filter groups to catch deals where:
 *   - construction_complete_date is this year (installs, team results)
 *   - inspections_completion_date is this year (inspections — construction may be last year)
 *   - site_survey_date is this year (surveys — deal may have moved fast to Project Complete)
 * Returns lightweight ProjectForMetrics objects, not full Project objects.
 */
async function fetchCompletedProjects(year: number): Promise<ProjectForMetrics[]> {
  const yearStartMs = String(new Date(`${year}-01-01T00:00:00Z`).getTime());

  // Base filters shared by all groups: project pipeline + Project Complete stage
  const baseFilters = [
    { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: PROJECT_PIPELINE_ID },
    { propertyName: "dealstage", operator: FilterOperatorEnum.Eq, value: PROJECT_COMPLETE_STAGE_ID },
  ];

  const allDeals: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();
  let after: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const response = await searchWithRetry({
      // OR groups: any deal in Project Complete with a relevant date this year
      filterGroups: [
        { filters: [...baseFilters, { propertyName: "construction_complete_date", operator: FilterOperatorEnum.Gte, value: yearStartMs }] },
        { filters: [...baseFilters, { propertyName: "inspections_completion_date", operator: FilterOperatorEnum.Gte, value: yearStartMs }] },
        { filters: [...baseFilters, { propertyName: "site_survey_date", operator: FilterOperatorEnum.Gte, value: yearStartMs }] },
      ],
      properties: COMPLETED_DEAL_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    });

    const results = response.results ?? [];
    for (const result of results) {
      const id = String(result.properties.hs_object_id || "");
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        allDeals.push(result.properties as Record<string, unknown>);
      }
    }

    const nextAfter = response.paging?.next?.after;
    if (nextAfter && results.length > 0) {
      after = nextAfter;
    } else {
      hasMore = false;
    }
  }

  console.log(`[office-performance] Fetched ${allDeals.length} Project Complete deals for ${year}`);

  // Map raw HubSpot properties to ProjectForMetrics
  return allDeals.map((d) => {
    const num = (v: unknown) => (v ? Number(v) : undefined);
    const str = (v: unknown) => (v ? String(v) : null);
    const days = (v: unknown) => {
      if (!v) return undefined;
      const n = Number(v);
      return isNaN(n) ? undefined : Math.round(n / 86400000); // ms to days
    };
    const batteryCount = (num(d.battery_count) || 0) + (num(d.battery_expansion_count) || 0);

    return {
      id: num(d.hs_object_id),
      name: str(d.dealname) || undefined,
      pbLocation: str(d.pb_location),
      stage: "Project Complete",
      amount: num(d.amount),
      constructionCompleteDate: str(d.construction_complete_date),
      siteSurveyCompletionDate: str(d.site_survey_date),
      inspectionPassDate: str(d.inspections_completion_date),
      siteSurveyScheduleDate: str(d.site_survey_schedule_date),
      constructionScheduleDate: str(d.install_schedule_date),
      inspectionScheduleDate: str(d.inspections_schedule_date),
      ptoGrantedDate: str(d.pto_completion_date),
      closeDate: str(d.closedate),
      forecastedInstallDate: str(d.forecasted_installation_date),
      forecastedInspectionDate: str(d.forecasted_inspection_date),
      forecastedPtoDate: str(d.forecasted_pto_date),
      daysSinceStageMovement: days(d.hs_v2_date_entered_current_stage),
      siteSurveyTurnaroundTime: num(d.site_survey_turnaround_time),
      constructionTurnaroundTime: num(d.construction_turnaround_time),
      timeCcToPto: num(d.time_between_cc___pto),
      isFirstTimeInspectionPass: d.first_time_inspection_pass_ === "true" || d.first_time_inspection_pass_ === true,
      hasInspectionFailed: d.has_inspection_failed_ === "true" || d.has_inspection_failed_ === true,
      hasInspectionFailedNotRejected: d.has_inspection_failed__not_rejected__ === "true" || d.has_inspection_failed__not_rejected__ === true,
      systemSizeKwdc: num(d.calculated_system_size__kwdc_) || 0,
      batteryCount: batteryCount || 0,
      siteSurveyor: str(d.site_surveyor),
      projectManager: str(d.project_manager),
      dealOwner: str(d.hubspot_owner_id),
      designLead: str(d.design),
      installCrew: str(d.install_crew),
    } as ProjectForMetrics;
  });
}

// ---------- Team Results Section ----------

async function buildTeamResultsData(
  location: string,
  now: Date,
  locationProjects: ProjectForMetrics[],
  locationDealIds: Set<string>
): Promise<TeamResultsData> {
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // YTD impact: deals with construction_complete_date in current year
  const completedYtd = locationProjects.filter((p) => {
    const d = p.constructionCompleteDate ? new Date(p.constructionCompleteDate) : null;
    return d && d >= yearStart && d <= now;
  });

  const homesPowered = completedYtd.length;
  const kwInstalled = Math.round(
    completedYtd.reduce((sum, p) => sum + (p.systemSizeKwdc || 0), 0) * 10
  ) / 10;
  const batteriesInstalled = completedYtd.reduce(
    (sum, p) => sum + (p.batteryCount || 0), 0
  );

  // Revenue: sum of deal amount for construction-completed deals this year
  const revenueEarned = completedYtd.reduce(
    (sum, p) => sum + (p.amount || 0), 0
  );

  // Recent wins: construction completed in last 7 days
  const recentWins: RecentWin[] = completedYtd
    .filter((p) => {
      const d = new Date(p.constructionCompleteDate!);
      return d >= weekAgo;
    })
    .map((p) => {
      // Extract customer last name from deal name: "PROJ-XXXX | LastName, FirstName | Address"
      const parts = (p.name || "").split("|").map((s) => s.trim());
      const namePart = parts[1] || parts[0] || "Unknown";
      const lastName = namePart.split(",")[0].trim();
      return { customerName: lastName, amount: p.amount || 0 };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // Crew breakdown — use HubSpot date properties to determine what was completed
  // this year, then look up Zuper jobs by deal ID to find who was assigned.
  const crewMap = new Map<string, CrewMemberStats>();
  const unattributed: CrewMemberStats = {
    name: "Unattributed",
    surveys: 0, installs: 0, inspections: 0,
    kwInstalled: 0, batteriesInstalled: 0,
    isUnattributed: true,
  };

  // Categorize deals by which HubSpot dates fall in this year
  const surveyedYtd = locationProjects.filter((p) => {
    const d = p.siteSurveyCompletionDate ? new Date(p.siteSurveyCompletionDate) : null;
    return d && d >= yearStart && d <= now;
  });
  const installedYtd = completedYtd; // already filtered by constructionCompleteDate
  const inspectedYtd = locationProjects.filter((p) => {
    const d = p.inspectionPassDate ? new Date(p.inspectionPassDate) : null;
    return d && d >= yearStart && d <= now;
  });

  if (prisma) {
    // Collect all deal IDs that had any activity this year
    const ytdDealIds = new Set<string>();
    for (const p of [...surveyedYtd, ...installedYtd, ...inspectedYtd]) {
      if (p.id) ytdDealIds.add(String(p.id));
    }

    // Batch-fetch all Zuper jobs for these deals (any category, no date filter)
    const allJobs = ytdDealIds.size > 0
      ? await prisma.zuperJobCache.findMany({
          where: {
            hubspotDealId: { in: [...ytdDealIds] },
            jobCategory: { in: ["Site Survey", "Construction", "Inspection"] },
          },
          select: {
            jobCategory: true,
            assignedUsers: true,
            hubspotDealId: true,
          },
        })
      : [];

    // Index jobs by dealId + category for fast lookup
    const jobsByDealCategory = new Map<string, Array<{ assignedUsers: unknown }>>();
    for (const job of allJobs) {
      const key = `${job.hubspotDealId}:${job.jobCategory}`;
      if (!jobsByDealCategory.has(key)) jobsByDealCategory.set(key, []);
      jobsByDealCategory.get(key)!.push(job);
    }

    // Helper to attribute a deal's work to crew members. Deals with no matching
    // Zuper crew fall through to the `unattributedFn` so totals still reconcile.
    const attributeWork = (
      deals: ProjectForMetrics[],
      category: "Site Survey" | "Construction" | "Inspection",
      updateFn: (stats: CrewMemberStats, userCount: number, deal: ProjectForMetrics) => void,
      unattributedFn: (stats: CrewMemberStats, deal: ProjectForMetrics) => void
    ) => {
      for (const deal of deals) {
        if (!deal.id) continue;
        const key = `${deal.id}:${category}`;
        const jobs = jobsByDealCategory.get(key) || [];
        // Collect all unique users across jobs for this deal+category
        const seenUids = new Set<string>();
        const allUsers: Array<{ user_uid: string; user_name: string }> = [];
        for (const job of jobs) {
          for (const u of extractAssignedUsers(job.assignedUsers)) {
            if (!seenUids.has(u.user_uid)) {
              seenUids.add(u.user_uid);
              allUsers.push(u);
            }
          }
        }
        if (allUsers.length === 0) {
          unattributedFn(unattributed, deal);
          continue;
        }
        const userCount = allUsers.length;
        for (const user of allUsers) {
          if (!crewMap.has(user.user_uid)) {
            crewMap.set(user.user_uid, {
              name: user.user_name,
              surveys: 0, installs: 0, inspections: 0,
              kwInstalled: 0, batteriesInstalled: 0,
            });
          }
          updateFn(crewMap.get(user.user_uid)!, userCount, deal);
        }
      }
    };

    // Surveys: count per person (multi-tech jobs inflate the column sum — noted in UI footnote)
    attributeWork(
      surveyedYtd,
      "Site Survey",
      (stats) => { stats.surveys++; },
      (stats) => { stats.surveys++; }
    );

    // Installs: count + kW/batteries split among crew (kW/batteries reconcile; install count does not)
    attributeWork(
      installedYtd,
      "Construction",
      (stats, userCount, deal) => {
        stats.installs++;
        stats.kwInstalled += (deal.systemSizeKwdc || 0) / userCount;
        stats.batteriesInstalled += (deal.batteryCount || 0) / userCount;
      },
      (stats, deal) => {
        stats.installs++;
        stats.kwInstalled += (deal.systemSizeKwdc || 0);
        stats.batteriesInstalled += (deal.batteryCount || 0);
      }
    );

    // Inspections: count per person
    attributeWork(
      inspectedYtd,
      "Inspection",
      (stats) => { stats.inspections++; },
      (stats) => { stats.inspections++; }
    );
  } else {
    // No prisma (should be rare) — everything is unattributed
    unattributed.surveys += surveyedYtd.length;
    unattributed.inspections += inspectedYtd.length;
    for (const deal of installedYtd) {
      unattributed.installs++;
      unattributed.kwInstalled += deal.systemSizeKwdc || 0;
      unattributed.batteriesInstalled += deal.batteryCount || 0;
    }
  }

  // Sort by total activity (no cap) and append the Unattributed row at the bottom
  const attributedCrew = [...crewMap.values()]
    .map((s) => ({
      ...s,
      kwInstalled: Math.round(s.kwInstalled * 10) / 10,
      batteriesInstalled: Math.round(s.batteriesInstalled),
    }))
    .sort((a, b) =>
      (b.surveys + b.installs + b.inspections) -
      (a.surveys + a.installs + a.inspections)
    );

  const hasUnattributedWork =
    unattributed.surveys > 0 ||
    unattributed.installs > 0 ||
    unattributed.inspections > 0 ||
    unattributed.kwInstalled > 0 ||
    unattributed.batteriesInstalled > 0;

  const crewBreakdown: CrewMemberStats[] = hasUnattributedWork
    ? [
        ...attributedCrew,
        {
          ...unattributed,
          kwInstalled: Math.round(unattributed.kwInstalled * 10) / 10,
          batteriesInstalled: Math.round(unattributed.batteriesInstalled),
        },
      ]
    : attributedCrew;

  return {
    homesPowered,
    kwInstalled,
    batteriesInstalled,
    revenueEarned,
    crewBreakdown,
    recentWins,
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
    .filter((u): u is { user_uid: string; user_name?: string } =>
      typeof u === "object" && u !== null && "user_uid" in u
    )
    .map((u) => ({
      user_uid: u.user_uid,
      user_name: u.user_name || u.user_uid.slice(0, 8),
    }));
}

export function buildLeaderboard(
  userCounts: UserJobCount[],
  monthlyHistory?: Map<string, UserJobCount[]>
): PersonStat[] {
  return userCounts
    .sort((a, b) => b.count - a.count)
    .map((u) => {
      const stat: PersonStat = { name: u.name, count: u.count, userUid: u.userUid };

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

  // Terminal statuses that indicate a job is done, even if completedDate wasn't
  // set by older sync runs (before the fix to recognize Passed/Failed).
  const TERMINAL_STATUSES = [
    "Completed", "Construction Complete", "Passed", "Partial Pass", "Failed",
  ];

  // When locationDealIds is provided, filter directly by dealId set
  // instead of joining against HubSpotProjectCache (which may be empty).
  const dealFilter = locationDealIds && locationDealIds.size > 0
    ? { in: [...locationDealIds] }
    : { not: null as unknown as string };

  // Match jobs with completedDate in range OR terminal-status jobs with
  // scheduledStart in range (fallback for cached jobs missing completedDate).
  const jobs = await prisma.zuperJobCache.findMany({
    where: {
      jobCategory: category,
      hubspotDealId: dealFilter,
      OR: [
        { completedDate: { gte: fromDate, lte: toDate } },
        {
          jobStatus: { in: TERMINAL_STATUSES },
          completedDate: null,
          scheduledStart: { gte: fromDate, lte: toDate },
        },
      ],
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

  // Scheduled this month — surveys with schedule date in current month (completed or not)
  const scheduledMtd = (locationProjects || []).filter((p) => {
    const d = p.siteSurveyScheduleDate ? new Date(p.siteSurveyScheduleDate) : null;
    return d && d >= mtdStart && d <= now;
  }).length;

  // Scheduled AND completed this month — for completion rate that excludes carryover
  const scheduledAndCompletedMtd = (locationProjects || []).filter((p) => {
    const sched = p.siteSurveyScheduleDate ? new Date(p.siteSurveyScheduleDate) : null;
    const comp = p.siteSurveyCompletionDate ? new Date(p.siteSurveyCompletionDate) : null;
    return sched && sched >= mtdStart && sched <= now && comp && comp >= mtdStart && comp <= now;
  }).length;

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
    scheduledMtd,
    scheduledAndCompletedMtd,
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
  const installsCompletedMtd = (locationProjects || []).filter((p) => {
    const d = p.constructionCompleteDate ? new Date(p.constructionCompleteDate) : null;
    return d && d >= mtdStart && d <= now;
  });
  const completedMtd = installsCompletedMtd.length;

  // kW installed this month — sum system size for MTD completed installs
  const kwInstalledMtd = Math.round(
    installsCompletedMtd.reduce((sum, p) => sum + (p.systemSizeKwdc || 0), 0) * 10
  ) / 10;

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
    kwInstalledMtd,
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

  // Scheduled this week — from HubSpot inspection_schedule_date (source of truth)
  const scheduledThisWeek = countScheduledThisWeek(locationProjects || [], "Inspection", now);

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
    outstandingFailedInspections: 0, // Populated from QC metrics
    avgConstructionDays: 0,
    avgConstructionDaysPrior: 0,
    avgCcToPtoDays: 0,
    avgCcToPtoDaysPrior: 0,
    scheduledThisWeek,
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
  pipeline: PipelineData | null,
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

    // Compute rolling 60-day averages using category-specific cohorts so each
    // metric reflects projects recently completed in that discipline, not all
    // projects whose construction finished recently.
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const oneTwentyDaysAgo = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);

    // Construction-completed cohort (install turnaround, pipeline)
    const recentConstructionProjects = locProjects.filter((p: ProjectForMetrics) =>
      p.constructionCompleteDate && new Date(p.constructionCompleteDate) >= sixtyDaysAgo
    );
    const priorConstructionProjects = locProjects.filter((p: ProjectForMetrics) =>
      p.constructionCompleteDate &&
      new Date(p.constructionCompleteDate) >= oneTwentyDaysAgo &&
      new Date(p.constructionCompleteDate) < sixtyDaysAgo
    );

    // Survey-completed cohort (survey turnaround)
    const recentSurveyProjects = locProjects.filter((p: ProjectForMetrics) =>
      p.siteSurveyCompletionDate && new Date(p.siteSurveyCompletionDate) >= sixtyDaysAgo
    );
    const priorSurveyProjects = locProjects.filter((p: ProjectForMetrics) =>
      p.siteSurveyCompletionDate &&
      new Date(p.siteSurveyCompletionDate) >= oneTwentyDaysAgo &&
      new Date(p.siteSurveyCompletionDate) < sixtyDaysAgo
    );

    // Inspection-passed cohort (CC→inspection turnaround)
    const recentInspectionProjects = locProjects.filter((p: ProjectForMetrics) =>
      p.inspectionPassDate && new Date(p.inspectionPassDate) >= sixtyDaysAgo
    );
    const priorInspectionProjects = locProjects.filter((p: ProjectForMetrics) =>
      p.inspectionPassDate &&
      new Date(p.inspectionPassDate) >= oneTwentyDaysAgo &&
      new Date(p.inspectionPassDate) < sixtyDaysAgo
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

    // Surveys: turnaround (use survey-completed cohort, not construction-completed)
    surveys.avgTurnaroundDays = avg(recentSurveyProjects, "siteSurveyTurnaroundTime");
    surveys.avgTurnaroundPrior = avg(priorSurveyProjects, "siteSurveyTurnaroundTime");

    // Per-surveyor turnaround enrichment
    for (const entry of surveys.leaderboard) {
      const surveyorProjects = recentSurveyProjects.filter(
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
    installs.avgDaysPerInstall = avg(recentConstructionProjects, "constructionTurnaroundTime");
    installs.avgDaysPerInstallPrior = avg(priorConstructionProjects, "constructionTurnaroundTime");

    // Inspections: construction time, CC→Inspection pass, first-pass rate
    inspections.avgConstructionDays = avg(recentConstructionProjects, "constructionTurnaroundTime");
    inspections.avgConstructionDaysPrior = avg(priorConstructionProjects, "constructionTurnaroundTime");

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
    inspections.avgCcToPtoDays = avgCcToInspection(recentInspectionProjects);
    inspections.avgCcToPtoDaysPrior = avgCcToInspection(priorInspectionProjects);

    // First-pass inspection rate — projects with inspection activity in the
    // 60-day window. Failed inspections without a pass date are only included
    // if their schedule/construction date falls within the window, preventing
    // ancient failures from dragging down the metric indefinitely.
    const withInspection = locProjects.filter((p: ProjectForMetrics) => {
      const passDate = p.inspectionPassDate ? new Date(p.inspectionPassDate) : null;
      const schedDate = p.inspectionScheduleDate ? new Date(p.inspectionScheduleDate) : null;
      const relevantDate = passDate || schedDate;
      if (relevantDate && relevantDate >= sixtyDaysAgo) return true;
      // Include stuck failures only if they were scheduled/completed recently
      if (p.hasInspectionFailed && !p.inspectionPassDate) {
        const fallbackDate = schedDate
          || (p.constructionCompleteDate ? new Date(p.constructionCompleteDate) : null);
        return fallbackDate !== null && fallbackDate >= sixtyDaysAgo;
      }
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

    // Outstanding failed inspections — projects that failed and have NOT yet
    // passed. Unbounded (all-time) because these are actively stuck projects.
    inspections.outstandingFailedInspections = locProjects.filter(
      (p: ProjectForMetrics) => p.hasInspectionFailed && !p.inspectionPassDate
    ).length;

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

        // Per-inspector pass rate (60-day window) — keyed on user_uid to
        // avoid name-collision issues between inspectors with similar names.
        const sixtyDayJobs = allInspectionJobs.filter(
          (j: { completedDate: Date | null; hubspotDealId: string | null; assignedUsers: unknown }) => j.completedDate && j.completedDate >= sixtyDaysAgo
        );
        const inspectorStats = new Map<string, { passes: number; total: number }>();

        for (const job of sixtyDayJobs) {
          const dealId = job.hubspotDealId;
          if (!dealId || !passMap.has(dealId)) continue;

          const passed = passMap.get(dealId)!;
          for (const user of extractAssignedUsers(job.assignedUsers)) {
            const stats = inspectorStats.get(user.user_uid) || { passes: 0, total: 0 };
            stats.total++;
            if (passed) stats.passes++;
            inspectorStats.set(user.user_uid, stats);
          }
        }

        for (const entry of inspections.leaderboard) {
          const stats = entry.userUid ? inspectorStats.get(entry.userUid) : undefined;
          if (stats && stats.total > 0) {
            entry.passRate = Math.round((stats.passes / stats.total) * 100);
          }
        }

        // Consecutive pass streak (120-day window, ordered desc) — also keyed on uid
        const streakMap = new Map<string, number>();
        const streakBroken = new Set<string>();

        for (const job of allInspectionJobs) {
          const dealId = job.hubspotDealId;
          if (!dealId || !passMap.has(dealId)) continue;

          const passed = passMap.get(dealId)!;
          for (const user of extractAssignedUsers(job.assignedUsers)) {
            if (streakBroken.has(user.user_uid)) continue;
            if (passed) {
              streakMap.set(user.user_uid, (streakMap.get(user.user_uid) || 0) + 1);
            } else {
              streakBroken.add(user.user_uid);
            }
          }
        }

        for (const entry of inspections.leaderboard) {
          const streak = entry.userUid ? streakMap.get(entry.userUid) : undefined;
          if (streak && streak >= 3) {
            entry.consecutivePasses = streak;
          }
        }
      } catch (err) {
        console.warn("[office-performance] Per-inspector enrichment failed:", err);
      }
    }

    // Pipeline: avg days in stage prior period
    if (pipeline) pipeline.avgDaysInStagePrior = avg(priorConstructionProjects, "daysSinceStageMovement");
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

  // Fetch active projects + completed projects for this location.
  // Active-only fetch avoids HubSpot rate limits / Vercel timeouts (~700 vs ~6,500 deals).
  // Supplementary fetch adds Project Complete deals with construction_complete_date this
  // year so all sections correctly count completed work (surveys, installs, inspections,
  // team results) even after a deal reaches Project Complete stage.
  //
  // When the compliance 30-day window crosses the year boundary (Jan 1–30),
  // also fetch prior-year completed deals so deal-based location attribution
  // covers late-December jobs instead of falling back to team filtering.
  const complianceWindowCrossesYear = month === 1 && now.getDate() <= 30;
  const completedFetches: Promise<ProjectForMetrics[]>[] = [
    fetchCompletedProjects(year),
  ];
  if (complianceWindowCrossesYear) {
    completedFetches.push(fetchCompletedProjects(year - 1));
  }

  const [activeProjects, ...completedArrays] = await Promise.all([
    fetchAllProjects({ activeOnly: true }),
    ...completedFetches,
  ]);
  const completedProjects = completedArrays.flat();

  // Merge active + completed, deduplicate by ID
  const seenDealIds = new Set<number>();
  const allProjects: ProjectForMetrics[] = [];
  for (const p of (activeProjects || []) as ProjectForMetrics[]) {
    if (p.id && !seenDealIds.has(p.id)) {
      seenDealIds.add(p.id);
      // Enrich with equipment data for team results
      const proj = p as ProjectForMetrics & { equipment?: { systemSizeKwdc?: number; battery?: { count?: number; expansionCount?: number } } };
      if (proj.equipment) {
        p.systemSizeKwdc = proj.equipment.systemSizeKwdc || 0;
        p.batteryCount = (proj.equipment.battery?.count || 0) + (proj.equipment.battery?.expansionCount || 0);
      }
      allProjects.push(p);
    }
  }
  for (const p of completedProjects) {
    if (p.id && !seenDealIds.has(p.id)) {
      seenDealIds.add(p.id);
      allProjects.push(p);
    }
  }

  const locationProjects = allProjects.filter(
    (p: ProjectForMetrics) => normalizeLocation(p.pbLocation) === location
  );

  // Build dealId sets and maps from all location projects.
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

  // Build all section data in parallel (team results replaces pipeline)
  const [teamResults, surveys, installs, inspections] = await Promise.all([
    buildTeamResultsData(location, now, locationProjects, locationDealIds),
    buildSurveyData(location, goals, now, locationProjects, assignedUserMap, locationDealIds, dealNameMap),
    buildInstallData(location, goals, now, locationProjects, assignedUserMap, locationDealIds, dealNameMap),
    buildInspectionData(location, goals, now, locationProjects, assignedUserMap, locationDealIds, dealNameMap),
  ]);

  // Enrich with QC metrics and live Zuper compliance in parallel
  const [, surveyCompliance, installCompliance, inspectionCompliance] = await Promise.all([
    enrichWithQcMetrics(location, null, surveys, installs, inspections),
    computeLocationCompliance("Site Survey", location, 30, locationDealIds).catch((err) => {
      console.warn("[office-performance] Survey compliance fetch failed:", err);
      return null;
    }),
    computeLocationCompliance("Construction", location, 30, locationDealIds).catch((err) => {
      console.warn("[office-performance] Install compliance fetch failed:", err);
      return null;
    }),
    computeLocationCompliance("Inspection", location, 30, locationDealIds).catch((err) => {
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
      oowUsagePercent: surveyCompliance.summary.oowUsagePercent,
      oowOnTimePercent: surveyCompliance.summary.oowOnTimePercent,
      aggregateGrade: surveyCompliance.summary.aggregateGrade,
      aggregateScore: surveyCompliance.summary.aggregateScore,
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
      oowUsagePercent: installCompliance.summary.oowUsagePercent,
      oowOnTimePercent: installCompliance.summary.oowOnTimePercent,
      aggregateGrade: installCompliance.summary.aggregateGrade,
      aggregateScore: installCompliance.summary.aggregateScore,
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
      oowUsagePercent: inspectionCompliance.summary.oowUsagePercent,
      oowOnTimePercent: inspectionCompliance.summary.oowOnTimePercent,
      aggregateGrade: inspectionCompliance.summary.aggregateGrade,
      aggregateScore: inspectionCompliance.summary.aggregateScore,
      byEmployee: inspectionCompliance.byEmployee,
    };
  }

  return {
    location,
    lastUpdated: now.toISOString(),
    teamResults,
    surveys,
    installs,
    inspections,
  };
}
