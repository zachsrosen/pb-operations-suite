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
  assignedUser?: string;
}

/** Zuper compliance summary for a job category at a location */
export interface SectionCompliance {
  onTimePercent: number;
  stuckJobs: ComplianceJob[];
  neverStartedCount: number;
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
  leaderboard: InspectionPersonStat[];
  deals: DealRow[];
  totalCount: number;
  compliance?: SectionCompliance;
}

export interface OfficePerformanceData {
  location: string;
  lastUpdated: string;
  pipeline: PipelineData;
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
export type CarouselSection = "pipeline" | "surveys" | "installs" | "inspections";

export const CAROUSEL_SECTIONS: CarouselSection[] = [
  "pipeline",
  "surveys",
  "installs",
  "inspections",
];

export const SECTION_COLORS: Record<CarouselSection, string> = {
  pipeline: "#f97316",   // orange
  surveys: "#3b82f6",    // blue
  installs: "#22c55e",   // green
  inspections: "#06b6d4", // cyan
};

export const SECTION_LABELS: Record<CarouselSection, string> = {
  pipeline: "PIPELINE OVERVIEW",
  surveys: "SURVEYS",
  installs: "INSTALLS",
  inspections: "INSPECTIONS & QUALITY",
};
