// src/lib/shop-health.ts
// Core data layer for the Weekly Shop Health Dashboard.
// Week utilities, health scoring, and the main getShopHealthData orchestrator.

import type {
  HealthStatus,
  HeroMetric,
  ShopHealthData,
  ShopHealthHeroes,
  ShopHealthGoals,
  SectionHealth,
  PipelineSection,
  PreconstructionSection,
  CustomerSuccessSection,
  SentimentBucket,
  SchedulingSection,
  OperationsSection,
  InspectionsSection,
  ShopHealthBottleneckEntry,
  DrilldownDeal,
  ShopHealthDrilldown,
} from "./shop-health-types";
import type { Project } from "./hubspot";
import type { DashboardLocationGroup } from "./dashboard-location-groups";
import { resolveDashboardGroup } from "./dashboard-location-groups";
import { fetchAllProjects } from "./hubspot";
import { normalizeLocation } from "./locations";
import { DEFAULT_TARGETS } from "./goals-pipeline-types";
import {
  fetchFiveStarReviewsForMonth,
  resolveReviewLocations,
} from "./hubspot-customer-reviews";
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

// ─── Drill-down Helpers ─────────────────────────────────────────────────────

/** Convert a Project to a lightweight drill-down row. */
function toDrilldown(p: Project, date?: string | null): DrilldownDeal {
  return {
    id: String(p.id),
    name: p.name,
    projectNumber: p.projectNumber,
    amount: p.amount || 0,
    stage: p.stage,
    pm: p.projectManager,
    date: date ?? null,
  };
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
 * Sentiment score health: >= 75 green, >= 50 yellow, else red.
 */
export function scoreSentiment(avgScore: number): HealthStatus {
  if (avgScore >= 75) return "green";
  if (avgScore >= 50) return "yellow";
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

  // Fetch raw projects (cached with request coalescing so concurrent calls
  // from the overview endpoint share a single HubSpot fetch).
  const { data: allProjects } = await appCache.getOrFetch(
    CACHE_KEYS.PROJECTS_ACTIVE,
    () => fetchAllProjects({ activeOnly: true })
  );

  // Filter to this location group's canonical locations
  const canonicalSet = new Set<string>(group.canonicals);
  const locationProjects = allProjects.filter((p) => {
    const normalized = normalizeLocation(p.pbLocation);
    return normalized !== null && canonicalSet.has(normalized);
  });

  // Compute average deal size from this location's active projects for
  // revenue→volume target derivation.
  const avgDealSize = computeAvgDealSize(locationProjects);

  // Goals sourced from OfficeGoal DB table (same targets as the Monday
  // weekly digest email). cc_revenue = install revenue target,
  // inspection_revenue = inspection revenue target. Volume targets are
  // back-calculated via avgDealSize.
  const goals = await computeGoalsFromOfficeGoals(group, avgDealSize, weekStart);

  // Compute sections for current and prior week
  const pipelineResult = computePipeline(locationProjects, weekStart);
  const preconResult = computePreconstruction(locationProjects, weekStart);
  const schedulingResult = computeScheduling(locationProjects, goals);
  const opsResult = computeOperations(locationProjects, weekStart, goals);
  const inspResult = computeInspections(locationProjects, weekStart);

  const pipeline = pipelineResult.section;
  const preconstruction = preconResult.section;
  const scheduling = schedulingResult.section;
  const operations = opsResult.section;
  const inspections = inspResult.section;

  const priorPipeline = computePipeline(locationProjects, priorWeekStart).section;
  const priorPreconstruction = computePreconstruction(
    locationProjects,
    priorWeekStart
  ).section;
  const priorOperations = computeOperations(
    locationProjects,
    priorWeekStart,
    goals
  ).section;
  const priorInspections = computeInspections(
    locationProjects,
    priorWeekStart
  ).section;

  // Compute weekly revenue = sum of deal amounts for installs completed this week
  const weeklyRevenueActual = locationProjects
    .filter((p) => isInWeek(p.constructionCompleteDate, weekStart))
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  const priorWeekRevenueActual = locationProjects
    .filter((p) => isInWeek(p.constructionCompleteDate, priorWeekStart))
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  // ── Customer Success section ──
  const csResult = await computeCustomerSuccess(
    locationProjects,
    group,
    weekStart
  );
  const customerSuccess = csResult.section;

  // Compute prior-week avg sentiment for hero delta
  const priorActive = locationProjects.filter((p) => p.isActive);
  const priorSentimentScores = priorActive
    .map((p) => p.customerSentimentScore)
    .filter((s): s is number => s !== null && !isNaN(s));
  const priorAvgSentiment =
    priorSentimentScores.length > 0
      ? Math.round(
          (priorSentimentScores.reduce((a, b) => a + b, 0) /
            priorSentimentScores.length) *
            10
        ) / 10
      : null;

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
    goals,
    weeklyRevenueActual,
    priorWeekRevenueActual,
    customerSuccess.avgSentimentScore,
    priorAvgSentiment
  );

  // Compute per-section health indicators (worst-case of key metrics)
  const sectionHealth = computeSectionHealth(heroes, pipeline, scheduling, operations);

  const bottlenecks = await getBottlenecksForLocationWeek(group.label, weekStart);

  // Assemble drill-down data from all section results
  const drilldown: ShopHealthDrilldown = {
    ...pipelineResult.drilldown,
    ...preconResult.drilldown,
    ...schedulingResult.drilldown,
    ...opsResult.drilldown,
    ...inspResult.drilldown,
    ...csResult.drilldown,
  };

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
    customerSuccess,
    sectionHealth,
    bottlenecks,
    drilldown,
    lastUpdated: new Date().toISOString(),
    goals,
  };
}

// ─── Section Computation Helpers ─────────────────────────────────────────────

/**
 * Compute average deal size from active projects with positive amounts.
 * Uses all active projects (not just backlog) for a representative sample.
 * Falls back to $30k if no data is available.
 */
function computeAvgDealSize(projects: Project[]): number {
  const withAmount = projects.filter(
    (p) => p.isActive && (p.amount || 0) > 0
  );
  if (withAmount.length === 0) return 30_000; // reasonable solar install default
  const total = withAmount.reduce((sum, p) => sum + (p.amount || 0), 0);
  return total / withAmount.length;
}

/**
 * Read goals from OfficeGoal DB table — the same targets used by the Monday
 * weekly digest email. For multi-location dashboard groups (California =
 * SLO + Camarillo), targets are summed across canonical locations.
 *
 * Uses cc_revenue for install revenue targets and pto_revenue for inspection
 * targets. Volume targets are back-calculated via avgDealSize.
 */
async function computeGoalsFromOfficeGoals(
  group: DashboardLocationGroup,
  avgDealSize: number,
  weekStart: Date
): Promise<ShopHealthGoals> {
  const month = weekStart.getMonth() + 1; // 1-12
  const year = weekStart.getFullYear();

  // Sum targets across all canonical locations in this dashboard group
  let ccRevenueTarget = 0;
  let ptoRevenueTarget = 0;

  try {
    const goalRecords = await prisma.officeGoal.findMany({
      where: {
        location: { in: group.canonicals },
        month,
        year,
      },
    });

    const targetMap = new Map<string, number>();
    for (const g of goalRecords) {
      const key = g.metric;
      targetMap.set(key, (targetMap.get(key) || 0) + g.target);
    }

    ccRevenueTarget = targetMap.get("cc_revenue") || 0;
    ptoRevenueTarget = targetMap.get("pto_revenue") || 0;
  } catch (err) {
    console.error("[shop-health] Failed to fetch OfficeGoal records, using defaults:", err);
  }

  // Fall back to DEFAULT_TARGETS if no DB records found
  if (ccRevenueTarget === 0) {
    for (const loc of group.canonicals) {
      const defaults = DEFAULT_TARGETS[loc] ?? DEFAULT_TARGETS["Westminster"];
      ccRevenueTarget += defaults.cc_revenue;
      ptoRevenueTarget += defaults.pto_revenue;
    }
  }

  const safeDealSize = avgDealSize > 0 ? avgDealSize : 30_000;
  const monthlyRevenueTarget = ccRevenueTarget;
  const weeklyRevenueTarget = monthlyRevenueTarget / 4.3;
  const monthlyInstalls = Math.round(monthlyRevenueTarget / safeDealSize);
  const monthlyInspections = Math.round(ptoRevenueTarget / safeDealSize);

  return {
    monthlyInstalls,
    weeklyInstalls: Math.round(monthlyInstalls / 4.3),
    monthlyInspections,
    weeklyInspections: Math.round(monthlyInspections / 4.3),
    monthlyRevenueTarget,
    weeklyRevenueTarget,
    avgDealSize: safeDealSize,
  };
}

function computePipeline(
  projects: Project[],
  weekStart: Date
): { section: PipelineSection; drilldown: Pick<ShopHealthDrilldown, 'contractsSigned' | 'backlog'> } {
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
    section: {
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
    },
    drilldown: {
      contractsSigned: contractsSigned.map((p) => toDrilldown(p, p.closeDate)),
      backlog: backlog.map((p) => toDrilldown(p, p.closeDate)),
    },
  };
}

type PreconDrilldownKeys = 'inDesign' | 'inPermitting' | 'readyToBuild' | 'agingOver2Weeks' | 'surveysCompleted' | 'dasApproved' | 'permitsIssued' | 'icApproved';

function computePreconstruction(
  projects: Project[],
  weekStart: Date
): { section: PreconstructionSection; drilldown: Pick<ShopHealthDrilldown, PreconDrilldownKeys> } {
  const active = projects.filter((p) => p.isActive);
  const inDesign = active.filter(
    (p) => p.stage === "Design & Engineering"
  );
  const inPermitting = active.filter(
    (p) => p.stage === "Permitting & Interconnection"
  );
  const rtb = active.filter((p) => RTB_STAGES.includes(p.stage));

  // ── Weekly throughput (milestone events this week) ──
  const surveysCompletedList = projects.filter(
    (p) => isInWeek(p.siteSurveyCompletionDate, weekStart)
  );

  const dasApprovedList = projects.filter(
    (p) => isInWeek(p.designApprovalDate, weekStart)
  );

  const permitsIssuedList = projects.filter(
    (p) => isInWeek(p.permitIssueDate, weekStart)
  );

  const icApprovedList = projects.filter(
    (p) => isInWeek(p.interconnectionApprovalDate, weekStart)
  );

  // ── Cycle times (averages from recent completions) ──
  // Avg days from contract close to permit issue
  const permitsIssued = projects.filter(
    (p) => p.permitIssueDate && isInWeek(p.permitIssueDate, weekStart)
  );
  const daysToPermit = permitsIssued
    .filter((p) => p.closeDate && p.permitIssueDate)
    .map((p) => daysBetween(p.closeDate!, p.permitIssueDate!))
    .filter((d) => !isNaN(d) && d >= 0);
  const avgDaysSaleToPermit =
    daysToPermit.length > 0
      ? Math.round(
          daysToPermit.reduce((a, b) => a + b, 0) / daysToPermit.length
        )
      : null;

  // Avg design turnaround (design start → design completion)
  const designCompleted = projects.filter(
    (p) => p.designCompletionDate && p.designStartDate
  );
  const designDays = designCompleted
    .map((p) => daysBetween(p.designStartDate!, p.designCompletionDate!))
    .filter((d) => !isNaN(d) && d >= 0);
  const avgDesignTurnaroundDays =
    designDays.length > 0
      ? Math.round(designDays.reduce((a, b) => a + b, 0) / designDays.length)
      : null;

  // Avg permit turnaround (permit submit → permit issue)
  const permitDays = permitsIssued
    .filter((p) => p.permitSubmitDate && p.permitIssueDate)
    .map((p) => daysBetween(p.permitSubmitDate!, p.permitIssueDate!))
    .filter((d) => !isNaN(d) && d >= 0);
  const avgPermitTurnaroundDays =
    permitDays.length > 0
      ? Math.round(permitDays.reduce((a, b) => a + b, 0) / permitDays.length)
      : null;

  // Projects stuck in precon stages for >14 days
  const agingProjects = active.filter(
    (p) =>
      [...PRECON_STAGES, ...RTB_STAGES].includes(p.stage) &&
      p.daysSinceStageMovement > 14
  );

  return {
    section: {
      jobsInDesign: inDesign.length,
      jobsSubmittedForPermit: inPermitting.length,
      totalReadyJobs: rtb.length,
      jobsAgingOver2Weeks: agingProjects.length,
      surveysCompletedThisWeek: surveysCompletedList.length,
      dasApprovedThisWeek: dasApprovedList.length,
      permitsIssuedThisWeek: permitsIssuedList.length,
      icApprovedThisWeek: icApprovedList.length,
      avgDaysSaleToPermit,
      avgDesignTurnaroundDays,
      avgPermitTurnaroundDays,
    },
    drilldown: {
      inDesign: inDesign.map((p) => toDrilldown(p, p.designStartDate)),
      inPermitting: inPermitting.map((p) => toDrilldown(p, p.permitSubmitDate)),
      readyToBuild: rtb.map((p) => toDrilldown(p, p.readyToBuildDate)),
      agingOver2Weeks: agingProjects.map((p) => toDrilldown(p)),
      surveysCompleted: surveysCompletedList.map((p) => toDrilldown(p, p.siteSurveyCompletionDate)),
      dasApproved: dasApprovedList.map((p) => toDrilldown(p, p.designApprovalDate)),
      permitsIssued: permitsIssuedList.map((p) => toDrilldown(p, p.permitIssueDate)),
      icApproved: icApprovedList.map((p) => toDrilldown(p, p.interconnectionApprovalDate)),
    },
  };
}

function computeScheduling(
  projects: Project[],
  goals: ShopHealthGoals
): { section: SchedulingSection; drilldown: Pick<ShopHealthDrilldown, 'scheduledNext2Weeks' | 'scheduledNext4Weeks'> } {
  const active = projects.filter((p) => p.isActive);
  const sched2 = active.filter((p) =>
    isWithinDays(p.constructionScheduleDate, 14)
  );
  const sched4 = active.filter((p) =>
    isWithinDays(p.constructionScheduleDate, 28)
  );

  // Spec: "% Crew Capacity Filled = Scheduled installs for next 2 weeks /
  // (crew count × 2 weeks of workdays)". Use weeklyInstalls * 2 as the
  // 2-week capacity denominator.
  const twoWeekCapacity = goals.weeklyInstalls * 2;
  const crewCapacityFilledPct =
    twoWeekCapacity > 0
      ? Math.round((sched2.length / twoWeekCapacity) * 100)
      : 0;

  return {
    section: {
      scheduledNext2Weeks: sched2.length,
      scheduledNext4Weeks: sched4.length,
      scheduleAccuracy: null,
      crewCapacityFilledPct,
    },
    drilldown: {
      scheduledNext2Weeks: sched2.map((p) => toDrilldown(p, p.constructionScheduleDate)),
      scheduledNext4Weeks: sched4.map((p) => toDrilldown(p, p.constructionScheduleDate)),
    },
  };
}

function computeOperations(
  projects: Project[],
  weekStart: Date,
  goals: ShopHealthGoals
): { section: OperationsSection; drilldown: Pick<ShopHealthDrilldown, 'installsCompleted' | 'installsPlanned'> } {
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
    section: {
      installsCompleted: completedThisWeek.length,
      installsPlanned: plannedThisWeek.length,
      installsActual: completedThisWeek.length,
      crewUtilizationPct,
    },
    drilldown: {
      installsCompleted: completedThisWeek.map((p) => toDrilldown(p, p.constructionCompleteDate)),
      installsPlanned: plannedThisWeek.map((p) => toDrilldown(p, p.constructionScheduleDate)),
    },
  };
}

function computeInspections(
  projects: Project[],
  weekStart: Date
): { section: InspectionsSection; drilldown: Pick<ShopHealthDrilldown, 'awaitingInspection' | 'inspectionsPassed' | 'ptosReceived'> } {
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
    section: {
      jobsAwaitingInspection: awaitingInspection.length,
      inspectionsPassed: passedThisWeek.length,
      avgDaysInstallToInspection,
      ptosReceived: ptosThisWeek.length,
    },
    drilldown: {
      awaitingInspection: awaitingInspection.map((p) => toDrilldown(p, p.constructionCompleteDate)),
      inspectionsPassed: passedThisWeek.map((p) => toDrilldown(p, p.inspectionPassDate)),
      ptosReceived: ptosThisWeek.map((p) => toDrilldown(p, p.ptoGrantedDate)),
    },
  };
}

// ─── Sentiment Distribution Buckets ──────────────────────────────────────────

const SENTIMENT_BUCKETS: Omit<SentimentBucket, "count" | "pct">[] = [
  { label: "At Risk", min: 0, max: 25, color: "bg-red-500" },
  { label: "Needs Attention", min: 26, max: 50, color: "bg-orange-500" },
  { label: "Neutral", min: 51, max: 75, color: "bg-amber-400" },
  { label: "Happy", min: 76, max: 100, color: "bg-emerald-500" },
];

/**
 * Compute Customer Success section from deal sentiment data and 5-star reviews.
 */
async function computeCustomerSuccess(
  locationProjects: Project[],
  group: DashboardLocationGroup,
  weekStart: Date
): Promise<{ section: CustomerSuccessSection; drilldown: Pick<ShopHealthDrilldown, 'daysSinceContact' | 'noSameDayResponse' | 'sentimentScores' | 'fiveStarReviews' | 'responseTime'> }> {
  const activeDeals = locationProjects.filter((p) => p.isActive);

  // ── Sentiment from deal properties ──
  const dealsWithSentiment = activeDeals
    .filter((p) => p.customerSentimentScore !== null && !isNaN(p.customerSentimentScore!))
    .map((p) => ({ deal: p, score: p.customerSentimentScore! }));
  // Sort worst-first (lowest sentiment at top)
  dealsWithSentiment.sort((a, b) => a.score - b.score);

  const sentimentScores = dealsWithSentiment.map((d) => d.score);

  const avgSentimentScore =
    sentimentScores.length > 0
      ? Math.round(
          (sentimentScores.reduce((a, b) => a + b, 0) /
            sentimentScores.length) *
            10
        ) / 10
      : null;

  // ── Avg days since last contact ──
  const now = new Date();
  const dealsWithContactDays: { deal: Project; days: number }[] = [];
  for (const p of activeDeals) {
    if (!p.notesLastContacted) continue;
    const last = new Date(p.notesLastContacted);
    if (isNaN(last.getTime())) continue;
    const days = Math.max(0, Math.round((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)));
    dealsWithContactDays.push({ deal: p, days });
  }
  // Sort worst-first (most days since contact at top)
  dealsWithContactDays.sort((a, b) => b.days - a.days);

  const daysSinceContactValues = dealsWithContactDays.map((d) => d.days);
  const avgDaysSinceContact =
    daysSinceContactValues.length > 0
      ? Math.round(
          (daysSinceContactValues.reduce((a, b) => a + b, 0) /
            daysSinceContactValues.length) *
            10
        ) / 10
      : null;

  // ── Sentiment distribution (most_recent_sentiment_score) ──
  const recentScores = activeDeals
    .map((p) => p.mostRecentSentimentScore)
    .filter((s): s is number => s !== null && !isNaN(s));

  const distribution: SentimentBucket[] = SENTIMENT_BUCKETS.map((bucket) => {
    const count = recentScores.filter(
      (s) => s >= bucket.min && s <= bucket.max
    ).length;
    return {
      ...bucket,
      count,
      pct:
        recentScores.length > 0
          ? Math.round((count / recentScores.length) * 1000) / 10
          : 0,
    };
  });

  // ── 5-star reviews (shared cache with Goals dashboard) ──
  const month = weekStart.getMonth() + 1;
  const year = weekStart.getFullYear();
  let reviewCount = 0;
  let reviewTarget = 0;

  // Cache stores location → deal IDs (shared with goals-pipeline)
  const reviewDealIds: string[] = [];
  try {
    const reviewCacheKey = CACHE_KEYS.FIVE_STAR_REVIEWS(`${year}-${month}`);
    const { data: reviewLocationDealIds } =
      await appCache.getOrFetch<Record<string, string[]>>(
        reviewCacheKey,
        async () => {
          const allReviews = await fetchFiveStarReviewsForMonth(month, year);
          const reviewLocations = await resolveReviewLocations(allReviews);
          const dealIdsByLocation: Record<string, string[]> = {};
          for (const resolved of reviewLocations.values()) {
            if (!dealIdsByLocation[resolved.location]) dealIdsByLocation[resolved.location] = [];
            dealIdsByLocation[resolved.location].push(resolved.dealId);
          }
          return dealIdsByLocation;
        },
        false
      );

    // Collect deal IDs and count across all canonical locations in this group
    for (const loc of group.canonicals) {
      const locDealIds = reviewLocationDealIds[loc] || [];
      reviewCount += locDealIds.length;
      reviewDealIds.push(...locDealIds);
    }
  } catch (err) {
    console.error("[shop-health] Failed to fetch 5-star reviews:", err);
  }

  // Review target: sum across canonical locations from OfficeGoal or defaults
  try {
    const goalRecords = await prisma.officeGoal.findMany({
      where: {
        location: { in: group.canonicals },
        metric: "five_star_reviews",
        month,
        year: weekStart.getFullYear(),
      },
    });
    if (goalRecords.length > 0) {
      reviewTarget = goalRecords.reduce((sum, g) => sum + g.target, 0);
    }
  } catch {
    // Fall through to defaults
  }

  if (reviewTarget === 0) {
    for (const loc of group.canonicals) {
      const defaults = DEFAULT_TARGETS[loc] ?? DEFAULT_TARGETS["Westminster"];
      reviewTarget += defaults.five_star_reviews;
    }
  }

  // ── Response metrics from deal-level rollup properties ──
  // Uses deal properties directly — no extra API calls needed.
  // no_same_day_response: count of missed same-day responses per deal
  // average_customer_response_time: avg response time in hours per deal
  const noSameDayDealsData: { deal: Project; count: number }[] = [];
  let noSameDayCount = 0;
  const respondHours: number[] = [];
  const dealResponseHours = new Map<string, number>();
  for (const deal of activeDeals) {
    if (deal.noSameDayResponse > 0) {
      noSameDayCount += deal.noSameDayResponse;
      noSameDayDealsData.push({ deal, count: deal.noSameDayResponse });
    }
    if (deal.averageCustomerResponseTime !== null) {
      respondHours.push(deal.averageCustomerResponseTime);
      dealResponseHours.set(String(deal.id), deal.averageCustomerResponseTime);
    }
  }
  // Sort no-same-day deals worst-first (highest count at top)
  noSameDayDealsData.sort((a, b) => b.count - a.count);

  const avgTimeToRespondHours =
    respondHours.length > 0
      ? Math.round(
          (respondHours.reduce((a, b) => a + b, 0) / respondHours.length) * 10
        ) / 10
      : null;

  // ── Drilldown: deals for "days since contact" (sorted worst-first) ──
  const daysSinceContactDrilldown = dealsWithContactDays.map(({ deal }) =>
    toDrilldown(deal, deal.notesLastContacted)
  ).map((d, i) => ({
    ...d,
    // Override the date field to show "Xd ago" for clarity
    date: dealsWithContactDays[i] ? `${dealsWithContactDays[i].days}d ago` : d.date,
  }));

  // ── Drilldown: deals with no-same-day-response (sorted worst-first) ──
  const activeDealMap = new Map(activeDeals.map((p) => [String(p.id), p]));
  const noSameDayDeals: DrilldownDeal[] = noSameDayDealsData.map(({ deal, count }) => ({
    ...toDrilldown(deal, deal.notesLastContacted),
    date: `${count}× missed`,
  }));

  // ── Drilldown: sentiment scores (worst-first) ──
  const sentimentDrilldown = dealsWithSentiment.map(({ deal, score }) => ({
    ...toDrilldown(deal, null),
    date: `${score}/100`,
  }));

  // ── Drilldown: 5-star review deals ──
  // reviewDealIds can include deals from any pipeline (Project, D&R, Service, Roofing).
  // Map known deals from locationProjects; batch-read unknown deals from HubSpot.
  const allProjectMap = new Map(locationProjects.map((p) => [String(p.id), p]));
  const fiveStarDrilldown: DrilldownDeal[] = [];
  const missingDealIds: string[] = [];
  for (const dealId of reviewDealIds) {
    const deal = allProjectMap.get(dealId);
    if (deal) {
      fiveStarDrilldown.push(toDrilldown(deal, deal.closeDate));
    } else {
      missingDealIds.push(dealId);
    }
  }
  // Batch-read deals from other pipelines (D&R, Service, Roofing) for drill-down
  if (missingDealIds.length > 0) {
    try {
      const { hubspotClient } = await import("./hubspot");
      const batchResponse = await hubspotClient.crm.deals.batchApi.read({
        inputs: missingDealIds.map((id) => ({ id })),
        properties: ["dealname", "project_number", "amount", "dealstage", "project_manager", "closedate"],
        propertiesWithHistory: [],
      });
      for (const deal of batchResponse.results ?? []) {
        const props = deal.properties as Record<string, string | null>;
        fiveStarDrilldown.push({
          id: deal.id,
          name: props.dealname || "Unknown",
          projectNumber: props.project_number || "",
          amount: parseFloat(props.amount || "0") || 0,
          stage: props.dealstage || "",
          pm: props.project_manager || "",
          date: props.closedate || null,
        });
      }
    } catch (err) {
      console.error("[shop-health] Failed to batch-read review deals from other pipelines:", err);
    }
  }

  // ── Drilldown: response time per deal (slowest first) ──
  const responseTimeDrilldown: DrilldownDeal[] = [];
  for (const [dealId, hours] of [...dealResponseHours.entries()].sort(([, a], [, b]) => b - a)) {
    const deal = activeDealMap.get(dealId);
    if (deal) {
      responseTimeDrilldown.push({
        ...toDrilldown(deal, null),
        date: `${Math.round(hours * 10) / 10}h`,
      });
    }
  }

  return {
    section: {
      avgSentimentScore,
      fiveStarReviewsMTD: reviewCount,
      fiveStarReviewsTarget: reviewTarget,
      npsCsat: null,
      avgDaysSinceContact,
      noSameDayResponseCount: noSameDayCount,
      avgTimeToRespondHours,
      proactiveUpdatePct: null,
      openEscalations: null,
      avgEscalationAge: null,
      avgResolutionTime: null,
      changeOrdersPerJob: null,
      activeServiceTickets: null,
      sentimentDistribution: distribution,
    },
    drilldown: {
      daysSinceContact: daysSinceContactDrilldown,
      noSameDayResponse: noSameDayDeals,
      sentimentScores: sentimentDrilldown,
      fiveStarReviews: fiveStarDrilldown,
      responseTime: responseTimeDrilldown,
    },
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
  goals: ShopHealthGoals,
  weeklyRevenueActual: number,
  priorWeekRevenueActual: number,
  avgSentiment: number | null,
  priorAvgSentiment: number | null
): ShopHealthHeroes {
  return {
    weeklyRevenue: buildHeroMetric(
      weeklyRevenueActual,
      priorWeekRevenueActual,
      scoreAgainstGoal(
        weeklyRevenueActual,
        goals.weeklyRevenueTarget
      ),
      Math.round(goals.weeklyRevenueTarget)
    ),
    sentiment: buildHeroMetric(
      avgSentiment ?? 0,
      priorAvgSentiment,
      avgSentiment !== null ? scoreSentiment(avgSentiment) : "red",
      75 // target: 75 out of 100
    ),
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
      // Scheduled installs for the current week (install date falls in this
      // Mon-Sun window). Shows how full this week's schedule is vs. target.
      operations.installsPlanned,
      priorOperations.installsPlanned,
      scoreScheduledInstalls(
        operations.installsPlanned,
        goals.weeklyInstalls
      ),
      goals.weeklyInstalls
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

// ─── Section Health ─────────────────────────────────────────────────────────

/** Pick the worst health status from a list (red > yellow > green). */
function worstHealth(...statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("red")) return "red";
  if (statuses.includes("yellow")) return "yellow";
  return "green";
}

/**
 * Derive per-section health from hero metrics and section data.
 * Each section's health = worst-case of its key indicators.
 */
function computeSectionHealth(
  heroes: ShopHealthHeroes,
  pipeline: PipelineSection,
  scheduling: SchedulingSection,
  operations: OperationsSection,
): SectionHealth {
  return {
    pipeline: heroes.backlogWeeks.health,
    preconstruction: heroes.readyToBuild.health,
    scheduling: worstHealth(
      heroes.scheduledInstalls.health,
      scheduling.crewCapacityFilledPct >= 100 ? "green" :
        scheduling.crewCapacityFilledPct >= 75 ? "yellow" : "red"
    ),
    operations: worstHealth(
      heroes.installsCompleted.health,
      operations.crewUtilizationPct >= 100 ? "green" :
        operations.crewUtilizationPct >= 80 ? "yellow" : "red"
    ),
    inspections: heroes.ptosReceived.health,
    customerSuccess: heroes.sentiment.health,
  };
}

// ─── Bottleneck Persistence ──────────────────────────────────────────────────

async function getBottlenecksForLocationWeek(
  location: string,
  weekStart: Date
): Promise<ShopHealthBottleneckEntry[]> {
  const entries = await prisma.shopHealthBottleneck.findMany({
    where: { location, weekStart },
    orderBy: { createdAt: 'asc' },
  });
  return entries.map((entry) => ({
    id: entry.id,
    location: entry.location,
    weekStart: entry.weekStart.toISOString(),
    constraint: entry.constraint,
    rootCause: entry.rootCause,
    actionPlan: entry.actionPlan,
    owner: entry.owner,
    userId: entry.userId,
    updatedAt: entry.updatedAt.toISOString(),
  }));
}
