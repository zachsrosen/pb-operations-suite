export interface PersonStat {
  name: string;
  count: number;
  avgMetric?: number;
  streak?: { type: string; value: number; label: string };
}

export interface InspectionPersonStat extends PersonStat {
  passRate: number;
  consecutivePasses?: number;
}

/** Person stat with per-person average metric (turnaround days, etc.) */
export interface EnrichedPersonStat extends PersonStat {
  avgTurnaround?: number;
  personalBest?: string;
}

/** A single project row in the deal drill-down list */
export interface DealRow {
  name: string;
  stage: string;
  daysInStage: number;
  overdue: boolean;
  daysOverdue: number;
  assignedUsers?: string[];
}

/** Per-employee compliance stats (full metrics from live Zuper API) */
export interface EmployeeCompliance {
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
  /** % of completed jobs where the tech used the On Our Way status (customer notification). -1 if no completed jobs. */
  oowUsagePercent: number;
  /** Of the jobs where OOW was used, % that were on-time relative to scheduled start. -1 if never used. */
  oowOnTimePercent: number;
  statusUsagePercent: number;
  complianceScore: number;
  grade: string;            // A-F
}

/** Zuper compliance summary for a job category at a location */
export interface SectionCompliance {
  totalJobs: number;
  completedJobs: number;
  onTimePercent: number;
  stuckJobs: ComplianceJob[];
  neverStartedCount: number;
  avgDaysToComplete: number;
  avgDaysLate: number;
  /** % of completed jobs where OOW status was used (customer notification). -1 if no completed jobs. */
  oowUsagePercent: number;
  /** Of the jobs where OOW was used, % that were on-time relative to scheduled start. -1 if never used. */
  oowOnTimePercent: number;
  /** Location-level aggregate compliance grade */
  aggregateGrade: string;
  /** Location-level aggregate compliance score */
  aggregateScore: number;
  byEmployee: EmployeeCompliance[];
}

/** A single stuck/problem job in compliance data */
export interface ComplianceJob {
  name: string;
  assignedUser?: string;
  daysSinceScheduled?: number;
}

export interface StageCount {
  stage: string;
  count: number;
}

export interface PipelineData {
  activeProjects: number;
  completedMtd: number;
  completedGoal: number;
  overdueCount: number;
  avgDaysInStage: number;
  avgDaysInStagePrior: number;
  stageDistribution: StageCount[];
  recentWins: string[];
  deals: DealRow[];
  totalCount: number;
}

export interface SurveyData {
  completedMtd: number;
  completedGoal: number;
  scheduledMtd: number;
  avgTurnaroundDays: number;
  avgTurnaroundPrior: number;
  scheduledThisWeek: number;
  leaderboard: EnrichedPersonStat[];
  deals: DealRow[];
  totalCount: number;
  compliance?: SectionCompliance;
}

export interface InstallData {
  completedMtd: number;
  completedGoal: number;
  kwInstalledMtd: number;
  avgDaysPerInstall: number;
  avgDaysPerInstallPrior: number;
  capacityUtilization: number;
  scheduledThisWeek: number;
  installerLeaderboard: EnrichedPersonStat[];
  electricianLeaderboard: EnrichedPersonStat[];
  deals: DealRow[];
  totalCount: number;
  compliance?: SectionCompliance;
}

export interface InspectionData {
  completedMtd: number;
  completedGoal: number;
  firstPassRate: number;
  avgConstructionDays: number;
  avgConstructionDaysPrior: number;
  avgCcToPtoDays: number;
  avgCcToPtoDaysPrior: number;
  scheduledThisWeek: number;
  leaderboard: InspectionPersonStat[];
  deals: DealRow[];
  totalCount: number;
  compliance?: SectionCompliance;
}

/** Per-crew-member YTD stats for Team Results slide */
export interface CrewMemberStats {
  name: string;
  surveys: number;
  installs: number;
  inspections: number;
  kwInstalled: number;
  batteriesInstalled: number;
  /** True for the synthetic "Unattributed" row (deals with no matching Zuper crew). */
  isUnattributed?: boolean;
}

/** Recent completed project for the wins ticker */
export interface RecentWin {
  customerName: string;
  amount: number;
}

/** Data for the Team Results carousel slide */
export interface TeamResultsData {
  homesPowered: number;
  kwInstalled: number;
  batteriesInstalled: number;
  revenueEarned: number;
  crewBreakdown: CrewMemberStats[];
  recentWins: RecentWin[];
}

export interface OfficePerformanceData {
  location: string;
  lastUpdated: string;
  teamResults: TeamResultsData;
  surveys: SurveyData;
  installs: InstallData;
  inspections: InspectionData;
}

export type OfficeMetricName =
  | "surveys_completed"
  | "installs_completed"
  | "inspections_completed"
  | "projects_completed";

/** Carousel section identifiers */
export type CarouselSection = "teamResults" | "surveys" | "installs" | "inspections";

export const CAROUSEL_SECTIONS: CarouselSection[] = [
  "teamResults",
  "surveys",
  "installs",
  "inspections",
];

export const SECTION_COLORS: Record<CarouselSection, string> = {
  teamResults: "#f97316", // orange
  surveys: "#3b82f6",     // blue
  installs: "#22c55e",    // green
  inspections: "#06b6d4", // cyan
};

export const SECTION_LABELS: Record<CarouselSection, string> = {
  teamResults: "TEAM RESULTS",
  surveys: "SURVEYS",
  installs: "INSTALLS",
  inspections: "INSPECTIONS & QUALITY",
};
