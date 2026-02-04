// Shared type definitions for the PB Operations Suite
// Extracted from at-risk, executive, locations, timeline, pe pages

export interface RawProject {
  id: string;
  name: string;
  pbLocation?: string;
  ahj?: string;
  utility?: string;
  projectType?: string;
  stage: string;
  amount?: number;
  url?: string;
  closeDate?: string;
  permitSubmitDate?: string;
  permitIssueDate?: string;
  constructionScheduleDate?: string;
  constructionCompleteDate?: string;
  inspectionScheduleDate?: string;
  inspectionPassDate?: string;
  forecastedInstallDate?: string;
  forecastedInspectionDate?: string;
  forecastedPtoDate?: string;
  ptoGrantedDate?: string;
  daysSinceStageMovement?: number;
  isBlocked?: boolean;
  isParticipateEnergy?: boolean;
  siteSurveyScheduleDate?: string;
  daysForInstallers?: number;
  daysForElectricians?: number;
  expectedDaysForInstall?: number;
  roofersCount?: number;
  electriciansCount?: number;
  installDifficulty?: number;
  installNotes?: string;
  priorityScore?: number;
  daysToInstall?: number | null;
  daysToInspection?: number | null;
  daysToPto?: number | null;
  daysSinceClose?: number;
  equipment?: {
    systemSizeKwdc?: number;
    modules?: { count?: number };
    inverter?: { count?: number };
    battery?: { count?: number; expansionCount?: number; brand?: string };
    evCount?: number;
  };
}

export interface TransformedProject {
  id: string;
  name: string;
  pb_location: string;
  ahj: string;
  utility: string;
  project_type: string;
  stage: string;
  amount: number;
  url?: string;
  close_date?: string;
  permit_submit?: string;
  permit_issued?: string;
  install_scheduled?: string;
  construction_complete?: string;
  inspection_scheduled?: string;
  inspection_pass?: string;
  pto_granted?: string;
  forecast_install: string | null;
  forecast_inspection: string | null;
  forecast_pto: string | null;
  days_to_install: number | null;
  days_to_inspection: number | null;
  days_to_pto: number | null;
  days_since_close: number;
}

// Risk types used by at-risk dashboard
export interface Risk {
  type: string;
  days: number;
  severity: "critical" | "warning";
}

export interface ProjectWithRisk extends TransformedProject {
  risks: Risk[];
  riskScore: number;
  hasCritical: boolean;
  hasWarning: boolean;
}

// Location stats used by locations and executive dashboards
export interface LocationStat {
  name: string;
  count: number;
  totalValue: number;
  overdue: number;
  thisMonth: number;
  nextMonth: number;
  stages: Record<string, number>;
  projects: TransformedProject[];
  avgInstall: number | null;
  avgInspection: number | null;
  avgPTO: number | null;
}

// Stage data used by executive dashboard
export interface StageData {
  count: number;
  value: number;
}

// Deal type used by sales, service, dnr dashboards
export interface Deal {
  id: number;
  name: string;
  amount: number;
  stage: string;
  stageId: string;
  pipeline: string;
  pbLocation: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  projectType: string;
  closeDate: string | null;
  createDate: string | null;
  lastModified: string | null;
  url: string;
  isActive: boolean;
  daysSinceCreate: number;
}

export interface DealsApiResponse {
  deals: Deal[];
  count: number;
  totalCount: number;
  stats: {
    totalValue: number;
    stageCounts: Record<string, number>;
    locationCounts: Record<string, number>;
  };
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasMore: boolean;
  } | null;
  pipeline: string;
  cached: boolean;
  stale: boolean;
  lastUpdated: string;
}
