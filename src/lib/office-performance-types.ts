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
}

export interface SurveyData {
  completedMtd: number;
  completedGoal: number;
  avgTurnaroundDays: number;
  avgTurnaroundPrior: number;
  scheduledThisWeek: number;
  leaderboard: PersonStat[];
}

export interface InstallData {
  completedMtd: number;
  completedGoal: number;
  avgDaysPerInstall: number;
  avgDaysPerInstallPrior: number;
  capacityUtilization: number;
  scheduledThisWeek: number;
  installerLeaderboard: PersonStat[];
  electricianLeaderboard: PersonStat[];
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
