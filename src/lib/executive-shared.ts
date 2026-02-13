/**
 * Shared types, constants, and helpers for Executive Suite dashboards.
 * Extracted from command-center to be reused across Pipeline, Revenue,
 * Capacity, PE, and Alerts standalone pages.
 */

// ============================================================
// Types
// ============================================================

export interface Crew {
  name: string;
  roofers: number;
  electricians: number;
  color: string;
  dailyCapacity: number;
}

export interface CrewConfig {
  crews: Crew[];
  monthly_capacity: number;
}

export interface ApiProject {
  id: string;
  name?: string;
  pbLocation?: string;
  ahj?: string;
  utility?: string;
  stage?: string;
  amount?: number;
  url?: string;
  closeDate?: string;
  forecastedInstallDate?: string;
  constructionScheduleDate?: string;
  forecastedInspectionDate?: string;
  inspectionScheduleDate?: string;
  forecastedPtoDate?: string;
  daysToInstall?: number | null;
  daysToInspection?: number | null;
  daysToPto?: number | null;
  daysSinceClose?: number;
  isParticipateEnergy?: boolean;
  priorityScore?: number;
  daysForInstallers?: number;
  designApprovalDate?: string | null;
  constructionCompleteDate?: string | null;
  inspectionPassDate?: string | null;
  ptoGrantedDate?: string | null;
}

export interface ExecProject {
  id: string;
  name: string;
  pb_location: string;
  ahj: string;
  utility: string;
  stage: string;
  amount: number;
  url: string;
  close_date?: string;
  forecast_install?: string;
  forecast_inspection?: string;
  forecast_pto?: string;
  days_to_install: number | null;
  days_to_inspection: number | null;
  days_to_pto: number | null;
  days_since_close: number;
  is_participate_energy: boolean;
  is_rtb: boolean;
  is_schedulable: boolean;
  priority_score: number;
  estimated_install_days: number;
  default_crew: string;
  design_approval: string | null;
  construction_complete: string | null;
  inspection_pass: string | null;
  pto_granted: string | null;
}

export interface MonthlyForecastEntry {
  count: number;
  days_needed: number;
  value: number;
}

export interface CapacityAnalysis {
  crews: Crew[];
  monthly_capacity: number;
  monthly_forecast: Record<string, MonthlyForecastEntry>;
  total_projects: number;
  rtb_count: number;
  pe_count: number;
}

export interface Alert {
  type: "danger" | "warning";
  title: string;
  message: string;
  project?: ExecProject;
}

// ============================================================
// Constants
// ============================================================

export const CREWS_CONFIG: Record<string, CrewConfig> = {
  Westminster: {
    crews: [
      { name: "WM Crew 1", roofers: 2, electricians: 1, color: "#3b82f6", dailyCapacity: 1 },
      { name: "WM Crew 2", roofers: 2, electricians: 1, color: "#8b5cf6", dailyCapacity: 1 },
    ],
    monthly_capacity: 44,
  },
  Centennial: {
    crews: [
      { name: "CENT Crew", roofers: 2, electricians: 1, color: "#22c55e", dailyCapacity: 1 },
    ],
    monthly_capacity: 22,
  },
  "Colorado Springs": {
    crews: [
      { name: "COS Crew", roofers: 2, electricians: 1, color: "#eab308", dailyCapacity: 1 },
    ],
    monthly_capacity: 22,
  },
  "San Luis Obispo": {
    crews: [
      { name: "SLO Solar", roofers: 2, electricians: 1, color: "#06b6d4", dailyCapacity: 1 },
      { name: "SLO Electrical 1", roofers: 0, electricians: 2, color: "#a855f7", dailyCapacity: 1 },
      { name: "SLO Electrical 2", roofers: 0, electricians: 2, color: "#14b8a6", dailyCapacity: 1 },
    ],
    monthly_capacity: 66,
  },
  Camarillo: {
    crews: [
      { name: "CAM Crew", roofers: 2, electricians: 1, color: "#f43f5e", dailyCapacity: 1 },
    ],
    monthly_capacity: 22,
  },
};

export const STAGE_ORDER = [
  "Close Out",
  "Permission To Operate",
  "Inspection",
  "Construction",
  "Ready To Build",
  "RTB - Blocked",
  "Permitting & Interconnection",
  "Design & Engineering",
  "Site Survey",
  "Project Rejected",
];

export const STAGE_COLORS: Record<string, string> = {
  "Site Survey": "#3b82f6",
  "Design & Engineering": "#8b5cf6",
  "Permitting & Interconnection": "#ec4899",
  "RTB - Blocked": "#ef4444",
  "Ready To Build": "#10b981",
  Construction: "#f97316",
  Inspection: "#eab308",
  "Permission To Operate": "#06b6d4",
  "Close Out": "#22c55e",
};

export const BACKLOG_STAGES = [
  "Site Survey",
  "Design & Engineering",
  "Permitting & Interconnection",
  "RTB - Blocked",
  "Ready To Build",
];

// ============================================================
// Helper Functions
// ============================================================

export function formatDays(days: number | null, completedDate?: string | null): string {
  if (completedDate) return "Done";
  if (days === null || days === undefined) return "N/A";
  if (days === 0) return "today";
  if (days < 0) return `${Math.abs(days)}d over`;
  return `in ${days}d`;
}

export function formatCurrencyExec(value: number, unit: "k" | "M" = "k"): string {
  if (unit === "M") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

export function getDaysClass(
  days: number | null,
  completedDate: string | null,
  warningThreshold: number = 14
): string {
  if (completedDate) return "text-emerald-500";
  if (days !== null && days < 0) return "text-red-500";
  if (days !== null && days <= warningThreshold) return "text-yellow-500";
  return "text-emerald-500";
}

export function transformProject(p: ApiProject): ExecProject {
  const isRtb = p.stage === "Ready To Build" || p.stage === "RTB - Blocked";
  const isSchedulable = isRtb || p.stage === "Construction";

  return {
    id: p.id,
    name: p.name || `Project ${p.id}`,
    pb_location: p.pbLocation || "Unknown",
    ahj: p.ahj || "",
    utility: p.utility || "",
    stage: p.stage || "Unknown",
    amount: p.amount || 0,
    url: p.url || `https://app.hubspot.com/contacts/21710069/record/0-3/${p.id}`,
    close_date: p.closeDate,
    forecast_install: p.forecastedInstallDate || p.constructionScheduleDate,
    forecast_inspection: p.forecastedInspectionDate || p.inspectionScheduleDate,
    forecast_pto: p.forecastedPtoDate,
    days_to_install: p.daysToInstall ?? null,
    days_to_inspection: p.daysToInspection ?? null,
    days_to_pto: p.daysToPto ?? null,
    days_since_close: p.daysSinceClose || 0,
    is_participate_energy: p.isParticipateEnergy || false,
    is_rtb: isRtb,
    is_schedulable: isSchedulable,
    priority_score: p.priorityScore || 0,
    estimated_install_days: p.daysForInstallers || 2,
    default_crew: CREWS_CONFIG[p.pbLocation || ""]?.crews[0]?.name || "Unassigned",
    design_approval: p.designApprovalDate || null,
    construction_complete: p.constructionCompleteDate || null,
    inspection_pass: p.inspectionPassDate || null,
    pto_granted: p.ptoGrantedDate || null,
  };
}

export function calculateCapacityAnalysis(
  projectList: ExecProject[]
): Record<string, CapacityAnalysis> {
  const analysis: Record<string, CapacityAnalysis> = {};
  Object.keys(CREWS_CONFIG).forEach((location) => {
    const config = CREWS_CONFIG[location];
    const locProjects = projectList.filter((p) => p.pb_location === location);
    const monthlyForecast: Record<string, MonthlyForecastEntry> = {};

    locProjects.forEach((p) => {
      if (p.forecast_install) {
        const month = p.forecast_install.substring(0, 7);
        if (!monthlyForecast[month])
          monthlyForecast[month] = { count: 0, days_needed: 0, value: 0 };
        monthlyForecast[month].count++;
        monthlyForecast[month].days_needed += p.estimated_install_days || 2;
        monthlyForecast[month].value += p.amount || 0;
      }
    });

    analysis[location] = {
      crews: config.crews,
      monthly_capacity: config.monthly_capacity,
      monthly_forecast: monthlyForecast,
      total_projects: locProjects.length,
      rtb_count: locProjects.filter((p) => p.is_rtb).length,
      pe_count: locProjects.filter((p) => p.is_participate_energy).length,
    };
  });
  return analysis;
}

export function calculateAlerts(
  projectList: ExecProject[],
  capacityAnalysis: Record<string, CapacityAnalysis>
): Alert[] {
  const alerts: Alert[] = [];

  projectList
    .filter(
      (p) =>
        p.days_to_install !== null &&
        p.days_to_install < -7 &&
        !p.construction_complete
    )
    .forEach((p) => {
      alerts.push({
        type: "danger",
        title: "Install Significantly Overdue",
        message: `${p.name.split("|")[1]?.trim() || p.name} is ${Math.abs(p.days_to_install!)} days past forecast`,
        project: p,
      });
    });

  projectList
    .filter(
      (p) =>
        p.is_participate_energy &&
        p.days_to_pto !== null &&
        p.days_to_pto < 0 &&
        !p.pto_granted
    )
    .forEach((p) => {
      alerts.push({
        type: "danger",
        title: "PE PTO Overdue",
        message: `${p.name.split("|")[1]?.trim() || p.name} PE milestone at risk`,
        project: p,
      });
    });

  Object.entries(capacityAnalysis).forEach(([loc, cap]) => {
    Object.entries(cap.monthly_forecast).forEach(([month, data]) => {
      if (data.days_needed > cap.monthly_capacity * 1.2) {
        alerts.push({
          type: "warning",
          title: "Capacity Overload",
          message: `${loc} forecasted ${data.days_needed} days in ${month}, capacity is ${cap.monthly_capacity}`,
        });
      }
    });
  });

  return alerts;
}
