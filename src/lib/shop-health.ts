// src/lib/shop-health.ts
// Core data layer for the Weekly Shop Health Dashboard.
// Week utilities, health scoring, and the main getShopHealthData orchestrator.

import type {
  HealthStatus,
  HeroMetric,
  ShopHealthData,
  ShopHealthHeroes,
  ShopHealthGoals,
  PipelineSection,
  PreconstructionSection,
  SchedulingSection,
  OperationsSection,
  InspectionsSection,
  ShopHealthBottleneckEntry,
} from "./shop-health-types";
import type { OfficePerformanceData } from "./office-performance-types";
import type { Project } from "./hubspot";
import { getOfficePerformanceData } from "./office-performance";
import { resolveDashboardGroup } from "./dashboard-location-groups";
import { fetchAllProjects } from "./hubspot";
import { normalizeLocation } from "./locations";
import { prisma } from "./db";
import { appCache, CACHE_KEYS } from "./cache";

// ─── Week Utilities ──────────────────────────────────────────────────────────
// Re-exported from shop-health-utils.ts (which has no server deps) so that
// client components can import from the utils file directly without pulling in
// prisma/hubspot/etc. Server-side code can still import from this file.

import { getWeekStart, getWeekEnd, formatWeekParam } from "./shop-health-utils";
export { getWeekStart, getWeekEnd, formatWeekParam };

/**
 * Returns true if the given ISO date string falls within the Mon-Sun week
 * starting at `weekStart`.
 */
export function isInWeek(
  dateStr: string | null | undefined,
  weekStart: Date
): boolean {
  if (!dateStr) return false;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    const weekEnd = getWeekEnd(weekStart);
    return date >= weekStart && date <= weekEnd;
  } catch {
    return false;
  }
}

/**
 * Returns true if the given ISO date string is 0..`days` calendar days in the
 * future (inclusive). Useful for "scheduled in the next N days" checks.
 */
export function isWithinDays(
  dateStr: string | null | undefined,
  days: number
): boolean {
  if (!dateStr) return false;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const diffMs = target.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= days;
  } catch {
    return false;
  }
}

/**
 * Returns the number of calendar days between two ISO date strings.
 * Returns NaN if either date is invalid.
 */
function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return NaN;
  const ms = db.getTime() - da.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * Returns a new Date shifted back by `n` weeks.
 */
function subWeeks(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - n * 7);
  return d;
}

// ─── Health Scoring ──────────────────────────────────────────────────────────

/**
 * Backlog depth scoring: 4-8 weeks is healthy, 3 or 9-10 is caution, else red.
 */
export function scoreBacklogWeeks(weeks: number): HealthStatus {
  if (weeks >= 4 && weeks <= 8) return "green";
  if (weeks === 3 || (weeks > 8 && weeks <= 10)) return "yellow";
  return "red";
}

/**
 * RTB pool scoring: 2x weekly capacity = green, 1x = yellow, else red.
 */
export function scoreReadyToBuild(
  rtbCount: number,
  weeklyCapacity: number
): HealthStatus {
  if (weeklyCapacity <= 0) return "red";
  const ratio = rtbCount / weeklyCapacity;
  if (ratio >= 2) return "green";
  if (ratio >= 1) return "yellow";
  return "red";
}

/**
 * Scheduled installs scoring: 100%+ of capacity = green, 75%+ = yellow.
 */
export function scoreScheduledInstalls(
  scheduled: number,
  capacity: number
): HealthStatus {
  if (capacity <= 0) return "red";
  const pct = (scheduled / capacity) * 100;
  if (pct >= 100) return "green";
  if (pct >= 75) return "yellow";
  return "red";
}

/**
 * General goal scoring: 100%+ = green, 80%+ = yellow, else red.
 */
export function scoreAgainstGoal(
  actual: number,
  weeklyGoal: number
): HealthStatus {
  if (weeklyGoal <= 0) return "green";
  const pct = (actual / weeklyGoal) * 100;
  if (pct >= 100) return "green";
  if (pct >= 80) return "yellow";
  return "red";
}

/**
 * Constructs a HeroMetric with automatic delta calculation.
 */
export function buildHeroMetric(
  value: number,
  priorWeek: number | null,
  health: HealthStatus,
  target: number | null = null
): HeroMetric {
  return {
    value,
    priorWeek,
    delta: priorWeek !== null ? value - priorWeek : null,
    health,
    target,
  };
}

// ─── Stage Constants ─────────────────────────────────────────────────────────

const BACKLOG_STAGES = [
  "Site Survey",
  "Design & Engineering",
  "Permitting & Interconnection",
  "RTB - Blocked",
  "Ready To Build",
];
const PRECON_STAGES = [
  "Design & Engineering",
  "Permitting & Interconnection",
];
const RTB_STAGES = ["Ready To Build", "RTB - Blocked"];

// ─── Core Orchestrator ───────────────────────────────────────────────────────

/**
 * Main entry point for Weekly Shop Health data.
 *
 * Fetches HubSpot projects + office-performance goal data, then computes
 * pipeline, preconstruction, scheduling, operations, and inspection sections
 * for the requested location and week. Also loads the manager bottleneck entry
 * from the DB (if one has been saved).
 */
export async function getShopHealthData(
  locationSlug: string,
  weekStart: Date
): Promise<ShopHealthData> {
  const group = resolveDashboardGroup(locationSlug);
  if (!group) throw new Error(`Unknown location slug: ${locationSlug}`);

  const priorWeekStart = subWeeks(weekStart, 1);
  const weekEndDate = getWeekEnd(weekStart);

  // Fetch office-performance data (for goals) and raw projects in parallel.
  // Projects are cached with request coalescing so concurrent calls from the
  // overview endpoint (4 location groups in parallel) share a single HubSpot
  // fetch instead of each hammering the API and triggering 429 rate limits.
  const [opData, { data: allProjects }] = await Promise.all([
    getOfficePerformanceData(group),
    appCache.getOrFetch(CACHE_KEYS.PROJECTS_ACTIVE, () =>
      fetchAllProjects({ activeOnly: true })
    ),
  ]);

  // Filter to this location group's canonical locations
  const canonicalSet = new Set<string>(group.canonicals);
  const locationProjects = allProjects.filter((p) => {
    const normalized = normalizeLocation(p.pbLocation);
    return normalized !== null && canonicalSet.has(normalized);
  });

  const goals = computeGoals(opData);

  // Compute sections for current and prior week
  const pipeline = computePipeline(locationProjects, weekStart);
  const preconstruction = computePreconstruction(locationProjects, weekStart);
  const scheduling = computeScheduling(locationProjects, goals);
  const operations = computeOperations(locationProjects, weekStart, goals);
  const inspections = computeInspections(locationProjects, weekStart);

  const priorPipeline = computePipeline(locationProjects, priorWeekStart);
  const priorPreconstruction = computePreconstruction(
    locationProjects,
    priorWeekStart
  );
  const priorOperations = computeOperations(
    locationProjects,
    priorWeekStart,
    goals
  );
  const priorInspections = computeInspections(
    locationProjects,
    priorWeekStart
  );

  const heroes = buildHeroes(
    pipeline,
    operations,
    inspections,
    scheduling,
    preconstruction,
    priorPipeline,
    priorOperations,
    priorInspections,
    priorPreconstruction,
    goals
  );

  const bottleneck = await getBottleneckForWeek(group.label, weekStart);

  return {
    location: group.label,
    weekStart: formatWeekParam(weekStart),
    weekEnd: formatWeekParam(weekEndDate),
    heroes,
    pipeline,
    preconstruction,
    scheduling,
    operations,
    inspections,
    bottleneck,
    lastUpdated: new Date().toISOString(),
    goals,
  };
}

// ─── Section Computation Helpers ─────────────────────────────────────────────

function computeGoals(opData: OfficePerformanceData): ShopHealthGoals {
  const monthlyInstalls = opData.installs?.completedGoal ?? 0;
  const monthlyInspections = opData.inspections?.completedGoal ?? 0;
  return {
    monthlyInstalls,
    weeklyInstalls: Math.round(monthlyInstalls / 4.3),
    monthlyInspections,
    weeklyInspections: Math.round(monthlyInspections / 4.3),
  };
}

function computePipeline(
  projects: Project[],
  weekStart: Date
): PipelineSection {
  const contractsSigned = projects.filter((p) =>
    isInWeek(p.closeDate, weekStart)
  );
  const backlog = projects.filter(
    (p) => BACKLOG_STAGES.includes(p.stage) && p.isActive
  );

  // Average weekly completions over the last 8 weeks to estimate backlog depth
  const eightWeeksAgo = subWeeks(weekStart, 8);
  const weekEnd = getWeekEnd(weekStart);
  const completedRecently = projects.filter(
    (p) =>
      p.constructionCompleteDate &&
      new Date(p.constructionCompleteDate) >= eightWeeksAgo &&
      new Date(p.constructionCompleteDate) <= weekEnd
  );
  const avgWeeklyCompletions = completedRecently.length / 8;
  const backlogInWeeks =
    avgWeeklyCompletions > 0
      ? Math.round((backlog.length / avgWeeklyCompletions) * 10) / 10
      : 0;

  return {
    contractsSigned: contractsSigned.length,
    contractsSignedValue: contractsSigned.reduce(
      (sum, p) => sum + (p.amount || 0),
      0
    ),
    totalBacklogCount: backlog.length,
    totalBacklogValue: backlog.reduce((sum, p) => sum + (p.amount || 0), 0),
    backlogInWeeks,
    cancellationCount: 0, // V1: no cancelled_date property on Project
    cancellationRate: 0,
  };
}

function computePreconstruction(
  projects: Project[],
  weekStart: Date
): PreconstructionSection {
  const active = projects.filter((p) => p.isActive);
  const inDesign = active.filter(
    (p) => p.stage === "Design & Engineering"
  );
  const inPermitting = active.filter(
    (p) => p.stage === "Permitting & Interconnection"
  );
  const rtb = active.filter((p) => RTB_STAGES.includes(p.stage));

  const permitsApproved = projects.filter(
    (p) => p.permitIssueDate && isInWeek(p.permitIssueDate, weekStart)
  );

  // Average days from contract close to permit approval
  const daysToPermit = permitsApproved
    .filter((p) => p.closeDate && p.permitIssueDate)
    .map((p) => daysBetween(p.closeDate!, p.permitIssueDate!))
    .filter((d) => !isNaN(d));
  const avgDaysSaleToPermit =
    daysToPermit.length > 0
      ? Math.round(
          daysToPermit.reduce((a, b) => a + b, 0) / daysToPermit.length
        )
      : null;

  // Projects stuck in precon stages for >14 days
  const agingProjects = active.filter(
    (p) =>
      [...PRECON_STAGES, ...RTB_STAGES].includes(p.stage) &&
      p.daysSinceStageMovement > 14
  );

  return {
    jobsInDesign: inDesign.length,
    jobsSubmittedForPermit: inPermitting.length,
    permitsApprovedThisWeek: permitsApproved.length,
    avgDaysSaleToPermit,
    totalReadyJobs: rtb.length,
    jobsAgingOver2Weeks: agingProjects.length,
    customerExperience: {
      avgResponseDays: null, // V1: needs HubSpot engagement timeline API
      proactiveUpdatePct: null, // V1: needs HubSpot engagement timeline API
      avgIssueResolutionDays: null,
      changeOrdersPerJob: null,
      escalationCount: null,
      escalationAvgAgeDays: null,
    },
  };
}

function computeScheduling(
  projects: Project[],
  goals: ShopHealthGoals
): SchedulingSection {
  const active = projects.filter((p) => p.isActive);
  const scheduledNext2Weeks = active.filter((p) =>
    isWithinDays(p.constructionScheduleDate, 14)
  ).length;
  const scheduledNext4Weeks = active.filter((p) =>
    isWithinDays(p.constructionScheduleDate, 28)
  ).length;

  const twoWeekCapacity = goals.weeklyInstalls * 2;
  const crewCapacityFilledPct =
    twoWeekCapacity > 0
      ? Math.round((scheduledNext2Weeks / twoWeekCapacity) * 100)
      : 0;

  return {
    scheduledNext2Weeks,
    scheduledNext4Weeks,
    scheduleAccuracy: null,
    crewCapacityFilledPct,
  };
}

function computeOperations(
  projects: Project[],
  weekStart: Date,
  goals: ShopHealthGoals
): OperationsSection {
  const completedThisWeek = projects.filter((p) =>
    isInWeek(p.constructionCompleteDate, weekStart)
  );
  const plannedThisWeek = projects.filter((p) =>
    isInWeek(p.constructionScheduleDate, weekStart)
  );
  const crewUtilizationPct =
    goals.weeklyInstalls > 0
      ? Math.round(
          (completedThisWeek.length / goals.weeklyInstalls) * 100
        )
      : 0;

  return {
    installsCompleted: completedThisWeek.length,
    installsPlanned: plannedThisWeek.length,
    installsActual: completedThisWeek.length,
    crewUtilizationPct,
  };
}

function computeInspections(
  projects: Project[],
  weekStart: Date
): InspectionsSection {
  const active = projects.filter((p) => p.isActive);
  const awaitingInspection = active.filter(
    (p) => p.stage === "Inspection"
  );
  const passedThisWeek = projects.filter((p) =>
    isInWeek(p.inspectionPassDate, weekStart)
  );

  // Average days from construction complete to inspection pass
  const turnaroundDays = passedThisWeek
    .filter((p) => p.constructionCompleteDate && p.inspectionPassDate)
    .map((p) =>
      daysBetween(p.constructionCompleteDate!, p.inspectionPassDate!)
    )
    .filter((d) => !isNaN(d) && d >= 0);
  const avgDaysInstallToInspection =
    turnaroundDays.length > 0
      ? Math.round(
          turnaroundDays.reduce((a, b) => a + b, 0) /
            turnaroundDays.length
        )
      : null;

  const ptosThisWeek = projects.filter((p) =>
    isInWeek(p.ptoGrantedDate, weekStart)
  );

  return {
    jobsAwaitingInspection: awaitingInspection.length,
    inspectionsPassed: passedThisWeek.length,
    avgDaysInstallToInspection,
    ptosReceived: ptosThisWeek.length,
  };
}

// ─── Hero Metric Assembly ────────────────────────────────────────────────────

function buildHeroes(
  pipeline: PipelineSection,
  operations: OperationsSection,
  inspections: InspectionsSection,
  scheduling: SchedulingSection,
  preconstruction: PreconstructionSection,
  priorPipeline: PipelineSection,
  priorOperations: OperationsSection,
  priorInspections: InspectionsSection,
  priorPreconstruction: PreconstructionSection,
  goals: ShopHealthGoals
): ShopHealthHeroes {
  return {
    leads: null, // deferred — requires marketing data source
    backlogWeeks: buildHeroMetric(
      pipeline.backlogInWeeks,
      priorPipeline.backlogInWeeks,
      scoreBacklogWeeks(pipeline.backlogInWeeks),
      6
    ),
    readyToBuild: buildHeroMetric(
      preconstruction.totalReadyJobs,
      priorPreconstruction.totalReadyJobs,
      scoreReadyToBuild(
        preconstruction.totalReadyJobs,
        goals.weeklyInstalls
      ),
      goals.weeklyInstalls * 2
    ),
    scheduledInstalls: buildHeroMetric(
      scheduling.scheduledNext2Weeks,
      null,
      scoreScheduledInstalls(
        scheduling.scheduledNext2Weeks,
        goals.weeklyInstalls * 2
      ),
      goals.weeklyInstalls * 2
    ),
    installsCompleted: buildHeroMetric(
      operations.installsCompleted,
      priorOperations.installsCompleted,
      scoreAgainstGoal(operations.installsCompleted, goals.weeklyInstalls),
      goals.weeklyInstalls
    ),
    ptosReceived: buildHeroMetric(
      inspections.ptosReceived,
      priorInspections.ptosReceived,
      scoreAgainstGoal(
        inspections.ptosReceived,
        goals.weeklyInspections
      ),
      goals.weeklyInspections
    ),
  };
}

// ─── Bottleneck Persistence ──────────────────────────────────────────────────

async function getBottleneckForWeek(
  location: string,
  weekStart: Date
): Promise<ShopHealthBottleneckEntry | null> {
  const entry = await prisma.shopHealthBottleneck.findUnique({
    where: { location_weekStart: { location, weekStart } },
  });
  if (!entry) return null;
  return {
    id: entry.id,
    location: entry.location,
    weekStart: entry.weekStart.toISOString(),
    constraint: entry.constraint,
    rootCause: entry.rootCause,
    actionPlan: entry.actionPlan,
    owner: entry.owner,
    userId: entry.userId,
    updatedAt: entry.updatedAt.toISOString(),
  };
}
