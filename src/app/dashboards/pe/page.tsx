"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatCurrency } from "@/lib/format";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PEProject {
  id: string;
  name: string;
  pb_location: string;
  ahj: string;
  utility: string;
  project_type: string;
  stage: string;
  amount: number;
  url: string;
  close_date: string | null;
  design_approval: string | null;
  install_scheduled: string | null;
  construction_complete: string | null;
  inspection_scheduled: string | null;
  inspection_complete: string | null;
  pto_granted: string | null;
  forecast_install: string | null;
  install_basis: string;
  days_to_install: number | null;
  forecast_inspection: string | null;
  inspection_basis: string;
  days_to_inspection: number | null;
  forecast_pto: string | null;
  pto_basis: string;
  days_to_pto: number | null;
  days_since_close: number | null;
}

interface APIProject {
  id: string;
  name: string;
  pbLocation: string;
  ahj: string;
  utility: string;
  projectType: string;
  stage: string;
  amount: number;
  url: string;
  closeDate: string | null;
  designApprovalDate: string | null;
  constructionScheduleDate: string | null;
  constructionCompleteDate: string | null;
  inspectionScheduleDate: string | null;
  inspectionPassDate: string | null;
  ptoGrantedDate: string | null;
  forecastedInstallDate: string | null;
  forecastedInspectionDate: string | null;
  forecastedPtoDate: string | null;
  daysToInstall: number | null;
  daysToInspection: number | null;
  daysToPto: number | null;
  daysSinceClose: number | null;
}

interface APIResponse {
  projects: APIProject[];
}

interface MilestoneStats {
  overdue: number;
  soon: number;
  onTrack: number;
}

interface Stats {
  total: number;
  totalValue: number;
  install: MilestoneStats;
  inspection: MilestoneStats;
  pto: MilestoneStats;
}

interface ForecastMonth {
  label: string;
  installs: number;
  inspections: number;
  ptos: number;
}

type ViewType = "overview" | "projects" | "milestones" | "revenue";
type SortKey = "pto" | "inspection" | "install" | "amount";
type FilterStatus = "all" | "overdue" | "soon" | "ontrack";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function displayName(name: string): string {
  return name.split("|")[0].trim();
}

function formatRevenueShort(amount: number): string {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}k`;
  return `$${amount.toFixed(0)}`;
}

interface RevenuePeriod {
  label: string;
  start: Date;
  end: Date;
  isCurrent: boolean;
  isPast: boolean;
}

function generateMonthlyPeriods(): RevenuePeriod[] {
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const months: RevenuePeriod[] = [];
  for (let i = -2; i <= 5; i++) {
    const d = new Date(currentYear, currentMonth + i, 1);
    const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    months.push({
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      start: d,
      end: endOfMonth,
      isCurrent: i === 0,
      isPast: i < 0,
    });
  }
  return months;
}

function generateWeeklyPeriods(): RevenuePeriod[] {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weeks: RevenuePeriod[] = [];
  for (let i = -4; i <= 7; i++) {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset + i * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 4);
    weekEnd.setHours(23, 59, 59, 999);
    weeks.push({
      label: weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      start: weekStart,
      end: weekEnd,
      isCurrent: i === 0,
      isPast: i < 0,
    });
  }
  return weeks;
}

function transformProject(p: APIProject): PEProject {
  return {
    id: p.id,
    name: p.name,
    pb_location: p.pbLocation,
    ahj: p.ahj,
    utility: p.utility,
    project_type: p.projectType,
    stage: p.stage,
    amount: p.amount,
    url: p.url,
    close_date: p.closeDate,
    design_approval: p.designApprovalDate,
    install_scheduled: p.constructionScheduleDate,
    construction_complete: p.constructionCompleteDate,
    inspection_scheduled: p.inspectionScheduleDate,
    inspection_complete: p.inspectionPassDate,
    pto_granted: p.ptoGrantedDate,
    forecast_install: p.forecastedInstallDate || p.constructionScheduleDate,
    install_basis: p.constructionScheduleDate ? "Scheduled" : "Forecast",
    days_to_install: p.daysToInstall,
    forecast_inspection:
      p.forecastedInspectionDate || p.inspectionScheduleDate,
    inspection_basis: p.inspectionScheduleDate ? "Scheduled" : "Forecast",
    days_to_inspection: p.daysToInspection,
    forecast_pto: p.forecastedPtoDate,
    pto_basis: p.ptoGrantedDate ? "Completed" : "Forecast",
    days_to_pto: p.daysToPto,
    days_since_close: p.daysSinceClose,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({
  days,
  threshold = 14,
}: {
  days: number | null | undefined;
  threshold?: number;
}) {
  if (days === null || days === undefined) {
    return (
      <span className="px-2 py-1 rounded-full text-xs font-medium bg-surface-2 text-muted">
        N/A
      </span>
    );
  }
  if (days < 0) {
    return (
      <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
        {Math.abs(days)}d overdue
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">
        due today
      </span>
    );
  }
  if (days <= threshold) {
    return (
      <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">
        in {days}d
      </span>
    );
  }
  return (
    <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
      in {days}d
    </span>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: "blue" | "red" | "yellow" | "green";
}) {
  const borderColors: Record<string, string> = {
    blue: "border-blue-500",
    red: "border-red-500",
    yellow: "border-yellow-500",
    green: "border-green-500",
  };
  const textColors: Record<string, string> = {
    blue: "text-blue-400",
    red: "text-red-400",
    yellow: "text-yellow-400",
    green: "text-green-400",
  };

  return (
    <div
      className={`bg-surface border border-t-border rounded-lg p-4 border-l-4 ${borderColors[accent]}`}
    >
      <div className="text-sm text-muted">{label}</div>
      <div className={`text-2xl font-bold ${textColors[accent]}`}>{value}</div>
    </div>
  );
}

function MilestoneSummaryCard({
  title,
  dotColor,
  stats,
  soonLabel,
}: {
  title: string;
  dotColor: string;
  stats: MilestoneStats;
  soonLabel: string;
}) {
  const total = stats.overdue + stats.soon + stats.onTrack;
  const overduePercent = total > 0 ? (stats.overdue / total) * 100 : 0;
  const soonPercent = total > 0 ? (stats.soon / total) * 100 : 0;
  const onTrackPercent = total > 0 ? (stats.onTrack / total) * 100 : 0;

  return (
    <div className="bg-surface border border-t-border rounded-lg p-4">
      <h3 className="font-semibold text-foreground/90 mb-3 flex items-center gap-2">
        <span className={`w-3 h-3 rounded-full ${dotColor}`} />
        {title}
      </h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-red-400">Overdue:</span>
          <strong className="text-foreground/90">{stats.overdue}</strong>
        </div>
        <div className="flex justify-between">
          <span className="text-yellow-400">{soonLabel}:</span>
          <strong className="text-foreground/90">{stats.soon}</strong>
        </div>
        <div className="flex justify-between">
          <span className="text-green-400">On Track:</span>
          <strong className="text-foreground/90">{stats.onTrack}</strong>
        </div>
      </div>
      {/* Progress bar */}
      <div className="mt-3 h-2 rounded-full bg-surface-2 flex overflow-hidden">
        {overduePercent > 0 && (
          <div
            className="bg-red-500 h-full"
            style={{ width: `${overduePercent}%` }}
          />
        )}
        {soonPercent > 0 && (
          <div
            className="bg-yellow-500 h-full"
            style={{ width: `${soonPercent}%` }}
          />
        )}
        {onTrackPercent > 0 && (
          <div
            className="bg-green-500 h-full"
            style={{ width: `${onTrackPercent}%` }}
          />
        )}
      </div>
    </div>
  );
}

function CSSBarChart({ data }: { data: ForecastMonth[] }) {
  const maxValue = Math.max(
    ...data.flatMap((m) => [m.installs, m.inspections, m.ptos]),
    1
  );

  return (
    <div className="bg-surface border border-t-border rounded-lg p-4">
      <h3 className="font-semibold text-foreground/90 mb-4">
        6-Month Milestone Forecast
      </h3>
      <div className="flex items-end gap-2 h-52">
        {data.map((month) => (
          <div key={month.label} className="flex-1 flex flex-col items-center">
            <div className="flex items-end gap-[2px] h-44 w-full justify-center">
              {/* Install bar */}
              <div className="flex flex-col items-center flex-1 max-w-6 h-full justify-end">
                {month.installs > 0 && (
                  <span className="text-[10px] text-muted mb-1">
                    {month.installs}
                  </span>
                )}
                <div
                  className="w-full bg-blue-500 rounded-t transition-all duration-500"
                  style={{
                    height: `${(month.installs / maxValue) * 100}%`,
                    minHeight: month.installs > 0 ? "4px" : "0px",
                  }}
                />
              </div>
              {/* Inspection bar */}
              <div className="flex flex-col items-center flex-1 max-w-6 h-full justify-end">
                {month.inspections > 0 && (
                  <span className="text-[10px] text-muted mb-1">
                    {month.inspections}
                  </span>
                )}
                <div
                  className="w-full bg-yellow-500 rounded-t transition-all duration-500"
                  style={{
                    height: `${(month.inspections / maxValue) * 100}%`,
                    minHeight: month.inspections > 0 ? "4px" : "0px",
                  }}
                />
              </div>
              {/* PTO bar */}
              <div className="flex flex-col items-center flex-1 max-w-6 h-full justify-end">
                {month.ptos > 0 && (
                  <span className="text-[10px] text-muted mb-1">
                    {month.ptos}
                  </span>
                )}
                <div
                  className="w-full bg-green-500 rounded-t transition-all duration-500"
                  style={{
                    height: `${(month.ptos / maxValue) * 100}%`,
                    minHeight: month.ptos > 0 ? "4px" : "0px",
                  }}
                />
              </div>
            </div>
            <div className="text-xs text-muted mt-2">{month.label}</div>
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex justify-center gap-6 mt-4 text-xs text-muted">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-blue-500" />
          Installations
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-yellow-500" />
          Inspections
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-green-500" />
          PTO
        </div>
      </div>
    </div>
  );
}

function MilestoneGroup({
  title,
  description,
  accentBg,
  accentTitle,
  accentDesc,
  projects,
  dateField,
  daysField,
  threshold,
}: {
  title: string;
  description: string;
  accentBg: string;
  accentTitle: string;
  accentDesc: string;
  projects: PEProject[];
  dateField: keyof PEProject;
  daysField: keyof PEProject;
  threshold: number;
}) {
  return (
    <div className="bg-surface border border-t-border rounded-lg overflow-hidden">
      <div className={`p-4 border-b border-t-border ${accentBg}`}>
        <h3 className={`font-semibold text-lg ${accentTitle}`}>{title}</h3>
        <p className={`text-sm ${accentDesc}`}>{description}</p>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {projects.length === 0 && (
          <div className="p-6 text-center text-muted">
            No projects in this category
          </div>
        )}
        {projects.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between p-3 border-b border-t-border/50 hover:bg-surface-2/30 transition-colors"
          >
            <div>
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-400 hover:text-green-300 hover:underline"
              >
                {displayName(p.name)}
              </a>
              <div className="text-xs text-muted">
                {p.pb_location} | {p.ahj}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted mb-1">Forecasted</div>
              <div className="text-sm text-foreground/80">
                {p[dateField] as string}
              </div>
              <StatusBadge
                days={p[daysField] as number | null}
                threshold={threshold}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue View
// ---------------------------------------------------------------------------

interface MilestoneTableConfig {
  title: string;
  dateField: keyof PEProject;
  forecastField: keyof PEProject;
  borderColor: string;
  barColor: string;
  headerBg: string;
}

const MILESTONE_CONFIGS: MilestoneTableConfig[] = [
  {
    title: "Design Approvals",
    dateField: "design_approval",
    forecastField: "design_approval",
    borderColor: "border-l-purple-500",
    barColor: "bg-purple-500",
    headerBg: "bg-purple-500/10",
  },
  {
    title: "Construction Completes",
    dateField: "construction_complete",
    forecastField: "forecast_install",
    borderColor: "border-l-blue-500",
    barColor: "bg-blue-500",
    headerBg: "bg-blue-500/10",
  },
  {
    title: "PE M1: Inspection Passed",
    dateField: "inspection_complete",
    forecastField: "forecast_inspection",
    borderColor: "border-l-emerald-500",
    barColor: "bg-emerald-500",
    headerBg: "bg-emerald-500/10",
  },
  {
    title: "PE M2: PTO Granted",
    dateField: "pto_granted",
    forecastField: "forecast_pto",
    borderColor: "border-l-amber-500",
    barColor: "bg-amber-500",
    headerBg: "bg-amber-500/10",
  },
];

function RevenueView({
  projects,
  revenuePeriod,
  setRevenuePeriod,
}: {
  projects: PEProject[];
  revenuePeriod: "monthly" | "weekly";
  setRevenuePeriod: (v: "monthly" | "weekly") => void;
}) {
  // Pipeline strength cards
  const pipelineStrength = useMemo(() => {
    const RTB_STAGES = ["RTB", "Ready to Build", "Ready To Build"];
    const rtbProjects = projects.filter((p) =>
      RTB_STAGES.some((s) => p.stage.toLowerCase() === s.toLowerCase())
    );
    const scheduledConstruction = projects.filter(
      (p) => p.install_scheduled && !p.construction_complete
    );
    const upcomingInspections = projects.filter(
      (p) => p.construction_complete && !p.inspection_complete
    );
    const awaitingPto = projects.filter(
      (p) => p.inspection_complete && !p.pto_granted
    );

    return {
      rtb: {
        count: rtbProjects.length,
        value: rtbProjects.reduce((sum, p) => sum + (p.amount || 0), 0),
      },
      scheduled: {
        count: scheduledConstruction.length,
        value: scheduledConstruction.reduce((sum, p) => sum + (p.amount || 0), 0),
      },
      inspections: {
        count: upcomingInspections.length,
        value: upcomingInspections.reduce((sum, p) => sum + (p.amount || 0), 0),
      },
      pto: {
        count: awaitingPto.length,
        value: awaitingPto.reduce((sum, p) => sum + (p.amount || 0), 0),
      },
    };
  }, [projects]);

  // Period generation
  const periods = useMemo(
    () => (revenuePeriod === "monthly" ? generateMonthlyPeriods() : generateWeeklyPeriods()),
    [revenuePeriod]
  );

  // Milestone revenue data computation
  const milestoneData = useMemo(() => {
    return MILESTONE_CONFIGS.map((config) => {
      const periodData = periods.map((period) => {
        let completions = 0;
        let revenue = 0;

        projects.forEach((p) => {
          // Use actual completion date if available, otherwise use forecast
          const dateStr =
            (p[config.dateField] as string | null) ||
            (config.dateField !== config.forecastField
              ? (p[config.forecastField] as string | null)
              : null);
          if (!dateStr) return;

          const date = new Date(dateStr + "T12:00:00");
          if (date >= period.start && date <= period.end) {
            completions++;
            revenue += p.amount || 0;
          }
        });

        return { completions, revenue };
      });

      const totalCompletions = periodData.reduce((s, d) => s + d.completions, 0);
      const totalRevenue = periodData.reduce((s, d) => s + d.revenue, 0);
      const maxRevenue = Math.max(...periodData.map((d) => d.revenue), 1);

      return { config, periodData, totalCompletions, totalRevenue, maxRevenue };
    });
  }, [projects, periods]);

  return (
    <div className="space-y-6">
      {/* Pipeline Strength */}
      <div>
        <h2 className="text-lg font-semibold text-foreground/90 mb-3">Pipeline Strength</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-surface border border-t-border rounded-lg p-4 border-l-4 border-l-green-500">
            <div className="text-sm text-muted">RTB Projects</div>
            <div className="text-2xl font-bold text-green-400">{pipelineStrength.rtb.count}</div>
            <div className="text-sm text-muted">{formatRevenueShort(pipelineStrength.rtb.value)}</div>
          </div>
          <div className="bg-surface border border-t-border rounded-lg p-4 border-l-4 border-l-blue-500">
            <div className="text-sm text-muted">Scheduled Construction</div>
            <div className="text-2xl font-bold text-blue-400">{pipelineStrength.scheduled.count}</div>
            <div className="text-sm text-muted">{formatRevenueShort(pipelineStrength.scheduled.value)}</div>
          </div>
          <div className="bg-surface border border-t-border rounded-lg p-4 border-l-4 border-l-emerald-500">
            <div className="text-sm text-muted">Upcoming Inspections</div>
            <div className="text-2xl font-bold text-emerald-400">{pipelineStrength.inspections.count}</div>
            <div className="text-sm text-muted">{formatRevenueShort(pipelineStrength.inspections.value)}</div>
          </div>
          <div className="bg-surface border border-t-border rounded-lg p-4 border-l-4 border-l-amber-500">
            <div className="text-sm text-muted">Awaiting PTO</div>
            <div className="text-2xl font-bold text-amber-400">{pipelineStrength.pto.count}</div>
            <div className="text-sm text-muted">{formatRevenueShort(pipelineStrength.pto.value)}</div>
          </div>
        </div>
      </div>

      {/* Period Toggle */}
      <div className="flex items-center gap-2">
        <div className="flex bg-surface border border-t-border rounded-lg p-1">
          <button
            onClick={() => setRevenuePeriod("monthly")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              revenuePeriod === "monthly"
                ? "bg-green-600 text-white"
                : "text-muted hover:text-foreground/90 hover:bg-surface-2"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setRevenuePeriod("weekly")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              revenuePeriod === "weekly"
                ? "bg-green-600 text-white"
                : "text-muted hover:text-foreground/90 hover:bg-surface-2"
            }`}
          >
            Weekly
          </button>
        </div>
      </div>

      {/* Milestone Revenue Tables */}
      {milestoneData.map(({ config, periodData, totalCompletions, totalRevenue, maxRevenue }) => (
        <div
          key={config.title}
          className={`bg-surface border border-t-border rounded-lg overflow-hidden border-l-4 ${config.borderColor}`}
        >
          <div className={`p-4 border-b border-t-border ${config.headerBg}`}>
            <h3 className="font-semibold text-foreground/90">{config.title}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-t-border bg-surface/50">
                  <th className="text-left p-3 text-sm font-medium text-muted w-32">Period</th>
                  <th className="text-right p-3 text-sm font-medium text-muted w-28">Completions</th>
                  <th className="text-right p-3 text-sm font-medium text-muted w-28">Revenue</th>
                  <th className="p-3 text-sm font-medium text-muted"></th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period, idx) => {
                  const data = periodData[idx];
                  const barWidth = maxRevenue > 0 ? (data.revenue / maxRevenue) * 100 : 0;
                  return (
                    <tr
                      key={period.label}
                      className={`border-b border-t-border/50 transition-colors ${
                        period.isCurrent
                          ? "bg-surface-2/40"
                          : period.isPast
                            ? "opacity-60"
                            : ""
                      }`}
                    >
                      <td className="p-3 text-sm text-foreground/80">
                        <span className={period.isCurrent ? "font-semibold text-green-400" : ""}>
                          {period.label}
                          {period.isCurrent && (
                            <span className="ml-1.5 text-[10px] text-green-500 font-normal">
                              current
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="p-3 text-sm text-right text-foreground/80 font-medium">
                        {data.completions || "-"}
                      </td>
                      <td className="p-3 text-sm text-right text-foreground/80 font-medium">
                        {data.revenue > 0 ? formatRevenueShort(data.revenue) : "-"}
                      </td>
                      <td className="p-3 pr-4">
                        {data.revenue > 0 && (
                          <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${config.barColor} transition-all duration-300`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {/* Total row */}
                <tr className="bg-surface/70 border-t border-t-border">
                  <td className="p-3 text-sm font-semibold text-foreground/90">Total</td>
                  <td className="p-3 text-sm text-right font-semibold text-foreground/90">
                    {totalCompletions}
                  </td>
                  <td className="p-3 text-sm text-right font-semibold text-foreground/90">
                    {totalRevenue > 0 ? formatRevenueShort(totalRevenue) : "-"}
                  </td>
                  <td className="p-3"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function PEDashboardPage() {
  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const [projects, setProjects] = useState<PEProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewType>("overview");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterMilestone, setFilterMilestone] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("pto");
  const [searchQuery, setSearchQuery] = useState("");
  const [revenuePeriod, setRevenuePeriod] = useState<"monthly" | "weekly">("monthly");

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch("/api/projects?context=pe");
        if (!response.ok) throw new Error("Failed to fetch");
        const data: APIResponse = await response.json();
        const transformed = data.projects.map(transformProject);
        setProjects(transformed);
        setError(null);
      } catch (err) {
        console.error("Failed to fetch PE projects:", err);
        setError("Failed to load data. Please refresh.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("pe", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

  // Compute stats
  const stats: Stats = useMemo(() => {
    let installOverdue = 0,
      installSoon = 0,
      installOnTrack = 0;
    let inspectionOverdue = 0,
      inspectionSoon = 0,
      inspectionOnTrack = 0;
    let ptoOverdue = 0,
      ptoSoon = 0,
      ptoOnTrack = 0;
    let totalValue = 0;

    projects.forEach((p) => {
      totalValue += p.amount || 0;

      // Install stats - only if construction not complete
      if (!p.construction_complete) {
        if (p.days_to_install !== null && p.days_to_install < 0)
          installOverdue++;
        else if (p.days_to_install !== null && p.days_to_install <= 14)
          installSoon++;
        else installOnTrack++;
      }

      // Inspection stats - only if inspection not complete
      if (!p.inspection_complete) {
        if (p.days_to_inspection !== null && p.days_to_inspection < 0)
          inspectionOverdue++;
        else if (p.days_to_inspection !== null && p.days_to_inspection <= 14)
          inspectionSoon++;
        else inspectionOnTrack++;
      }

      // PTO stats - only if PTO not granted
      if (!p.pto_granted) {
        if (p.days_to_pto !== null && p.days_to_pto < 0) ptoOverdue++;
        else if (p.days_to_pto !== null && p.days_to_pto <= 30) ptoSoon++;
        else ptoOnTrack++;
      }
    });

    return {
      total: projects.length,
      totalValue,
      install: {
        overdue: installOverdue,
        soon: installSoon,
        onTrack: installOnTrack,
      },
      inspection: {
        overdue: inspectionOverdue,
        soon: inspectionSoon,
        onTrack: inspectionOnTrack,
      },
      pto: { overdue: ptoOverdue, soon: ptoSoon, onTrack: ptoOnTrack },
    };
  }, [projects]);

  // Filter and sort projects
  const filteredProjects = useMemo(() => {
    let filtered = [...projects];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.pb_location.toLowerCase().includes(q) ||
          p.ahj.toLowerCase().includes(q) ||
          p.stage.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (filterStatus !== "all") {
      filtered = filtered.filter((p) => {
        const days =
          filterMilestone === "install"
            ? p.days_to_install
            : filterMilestone === "inspection"
              ? p.days_to_inspection
              : p.days_to_pto;
        if (days === null) return false;
        if (filterStatus === "overdue") return days < 0;
        if (filterStatus === "soon")
          return days >= 0 && days <= (filterMilestone === "pto" ? 30 : 14);
        return days > (filterMilestone === "pto" ? 30 : 14);
      });
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === "install")
        return (a.days_to_install ?? 999) - (b.days_to_install ?? 999);
      if (sortBy === "inspection")
        return (
          (a.days_to_inspection ?? 999) - (b.days_to_inspection ?? 999)
        );
      if (sortBy === "pto")
        return (a.days_to_pto ?? 999) - (b.days_to_pto ?? 999);
      if (sortBy === "amount") return (b.amount || 0) - (a.amount || 0);
      return 0;
    });

    return filtered;
  }, [projects, filterMilestone, filterStatus, sortBy, searchQuery]);

  // 6-month forecast data
  const forecastData: ForecastMonth[] = useMemo(() => {
    const today = new Date();
    const months: ForecastMonth[] = [];

    for (let i = 0; i < 6; i++) {
      const d = new Date(today);
      d.setMonth(d.getMonth() + i);
      const label = d.toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });

      let installs = 0,
        inspections = 0,
        ptos = 0;
      projects.forEach((p) => {
        if (p.forecast_install) {
          const fd = new Date(p.forecast_install);
          if (
            fd.getMonth() === d.getMonth() &&
            fd.getFullYear() === d.getFullYear()
          )
            installs++;
        }
        if (p.forecast_inspection) {
          const fd = new Date(p.forecast_inspection);
          if (
            fd.getMonth() === d.getMonth() &&
            fd.getFullYear() === d.getFullYear()
          )
            inspections++;
        }
        if (p.forecast_pto) {
          const fd = new Date(p.forecast_pto);
          if (
            fd.getMonth() === d.getMonth() &&
            fd.getFullYear() === d.getFullYear()
          )
            ptos++;
        }
      });

      months.push({ label, installs, inspections, ptos });
    }

    return months;
  }, [projects]);

  // Milestone view data
  const inspectionMilestones = useMemo(
    () =>
      projects
        .filter(
          (p) =>
            p.days_to_inspection !== null && p.days_to_inspection <= 30
        )
        .sort(
          (a, b) => (a.days_to_inspection ?? 999) - (b.days_to_inspection ?? 999)
        )
        .slice(0, 20),
    [projects]
  );

  const ptoMilestones = useMemo(
    () =>
      projects
        .filter((p) => p.days_to_pto !== null && p.days_to_pto <= 45)
        .sort((a, b) => (a.days_to_pto ?? 999) - (b.days_to_pto ?? 999))
        .slice(0, 20),
    [projects]
  );

  // Export to clipboard
  const handleExport = useCallback(() => {
    const headers = [
      "Project",
      "Location",
      "Stage",
      "Value",
      "Forecast Install",
      "Days to Install",
      "Forecast Inspection",
      "Days to Inspection",
      "Forecast PTO",
      "Days to PTO",
    ];
    const rows = filteredProjects.map((p) =>
      [
        displayName(p.name),
        p.pb_location,
        p.stage,
        p.amount || 0,
        p.forecast_install || "",
        p.days_to_install ?? "",
        p.forecast_inspection || "",
        p.days_to_inspection ?? "",
        p.forecast_pto || "",
        p.days_to_pto ?? "",
      ].join("\t")
    );
    const csv = [headers.join("\t"), ...rows].join("\n");
    navigator.clipboard.writeText(csv);
  }, [filteredProjects]);

  // Loading
  if (loading) {
    return (
      <DashboardShell title="Participate Energy" subtitle="Project Milestone Tracker" accentColor="green">
        <LoadingSpinner color="green" message="Loading Participate Energy data..." />
      </DashboardShell>
    );
  }

  // Error
  if (error) {
    return (
      <DashboardShell title="Participate Energy" subtitle="Project Milestone Tracker" accentColor="green">
        <ErrorState message={error} onRetry={() => window.location.reload()} color="green" />
      </DashboardShell>
    );
  }

  const today = new Date();

  return (
    <DashboardShell
      title="Participate Energy"
      subtitle="Project Milestone Tracker"
      accentColor="green"
      breadcrumbs={[{ label: "Dashboards", href: "/" }, { label: "PE Dashboard" }]}
      lastUpdated={today.toLocaleDateString()}
      headerRight={
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-green-400">
            {stats.total} Projects
          </span>
          <button
            onClick={handleExport}
            className="px-3 py-1.5 text-xs bg-surface-2 hover:bg-surface-2 text-foreground/80 rounded border border-t-border transition-colors"
          >
            Export CSV
          </button>
        </div>
      }
    >
      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 bg-surface border border-t-border rounded-lg p-1 w-fit">
        {(["overview", "projects", "milestones", "revenue"] as ViewType[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              view === v
                ? "bg-green-600 text-white"
                : "text-muted hover:text-foreground/90 hover:bg-surface-2"
            }`}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* OVERVIEW VIEW                                                    */}
      {/* ================================================================ */}
      {view === "overview" && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Total Pipeline Value"
              value={formatCurrency(stats.totalValue)}
              accent="blue"
            />
            <StatCard
              label="Overdue (PTO)"
              value={stats.pto.overdue}
              accent="red"
            />
            <StatCard
              label="PTO Next 30 Days"
              value={stats.pto.soon}
              accent="yellow"
            />
            <StatCard
              label="On Track"
              value={stats.pto.onTrack}
              accent="green"
            />
          </div>

          {/* Milestone Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <MilestoneSummaryCard
              title="Forecasted Installation"
              dotColor="bg-blue-500"
              stats={stats.install}
              soonLabel="Next 14d"
            />
            <MilestoneSummaryCard
              title="Forecasted Inspection"
              dotColor="bg-yellow-500"
              stats={stats.inspection}
              soonLabel="Next 14d"
            />
            <MilestoneSummaryCard
              title="Forecasted PTO"
              dotColor="bg-green-500"
              stats={stats.pto}
              soonLabel="Next 30d"
            />
          </div>

          {/* CSS Bar Chart */}
          <CSSBarChart data={forecastData} />
        </>
      )}

      {/* ================================================================ */}
      {/* PROJECTS VIEW                                                    */}
      {/* ================================================================ */}
      {view === "projects" && (
        <>
          {/* Filters */}
          <div className="bg-surface border border-t-border rounded-lg p-4 mb-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">Search:</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Project name, location..."
                className="bg-surface border border-t-border rounded px-3 py-1.5 text-sm text-foreground/90 placeholder-zinc-600 focus:outline-none focus:border-green-600 w-56"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="bg-surface border border-t-border rounded px-3 py-1.5 text-sm text-foreground/90"
              >
                <option value="pto">Days to PTO</option>
                <option value="inspection">Days to Inspection</option>
                <option value="install">Days to Install</option>
                <option value="amount">Deal Value</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">Milestone:</span>
              <select
                value={filterMilestone}
                onChange={(e) => setFilterMilestone(e.target.value)}
                className="bg-surface border border-t-border rounded px-3 py-1.5 text-sm text-foreground/90"
              >
                <option value="all">All</option>
                <option value="install">Install</option>
                <option value="inspection">Inspection</option>
                <option value="pto">PTO</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">Status:</span>
              <select
                value={filterStatus}
                onChange={(e) =>
                  setFilterStatus(e.target.value as FilterStatus)
                }
                className="bg-surface border border-t-border rounded px-3 py-1.5 text-sm text-foreground/90"
              >
                <option value="all">All</option>
                <option value="overdue">Overdue</option>
                <option value="soon">Due Soon</option>
                <option value="ontrack">On Track</option>
              </select>
            </div>
            <div className="ml-auto text-xs text-muted">
              {filteredProjects.length} projects
            </div>
          </div>

          {/* Project Table */}
          <div className="bg-surface border border-t-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-t-border bg-surface/50">
                    <th className="text-left p-3 text-sm font-medium text-muted">
                      Project
                    </th>
                    <th className="text-left p-3 text-sm font-medium text-muted">
                      Location
                    </th>
                    <th className="text-right p-3 text-sm font-medium text-muted">
                      Value
                    </th>
                    <th className="text-center p-3 text-sm font-medium text-muted">
                      Forecasted Install
                    </th>
                    <th className="text-center p-3 text-sm font-medium text-muted">
                      Forecasted Inspection
                    </th>
                    <th className="text-center p-3 text-sm font-medium text-muted">
                      Forecasted PTO
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.slice(0, 50).map((p, idx) => (
                    <tr
                      key={p.id}
                      className={`border-b border-t-border/50 transition-colors hover:bg-surface-2/30 ${
                        idx % 2 === 0 ? "" : "bg-surface/30"
                      }`}
                    >
                      <td className="p-3">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400 hover:text-green-300 hover:underline font-medium"
                        >
                          {displayName(p.name)}
                        </a>
                        <div className="text-xs text-muted">{p.stage}</div>
                      </td>
                      <td className="p-3 text-sm text-muted">
                        {p.pb_location}
                      </td>
                      <td className="p-3 text-right font-medium text-foreground/90">
                        {formatCurrency(p.amount || 0)}
                      </td>
                      <td className="p-3 text-center">
                        <div className="text-xs text-muted mb-1">
                          {p.forecast_install}
                        </div>
                        <StatusBadge days={p.days_to_install} />
                      </td>
                      <td className="p-3 text-center">
                        <div className="text-xs text-muted mb-1">
                          {p.forecast_inspection}
                        </div>
                        <StatusBadge days={p.days_to_inspection} />
                      </td>
                      <td className="p-3 text-center">
                        <div className="text-xs text-muted mb-1">
                          {p.forecast_pto}
                        </div>
                        <StatusBadge days={p.days_to_pto} threshold={30} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredProjects.length > 50 && (
              <div className="p-3 text-center text-sm text-muted border-t border-t-border">
                Showing 50 of {filteredProjects.length} projects
              </div>
            )}
            {filteredProjects.length === 0 && (
              <div className="p-8 text-center text-muted">
                No projects match the current filters
              </div>
            )}
          </div>
        </>
      )}

      {/* ================================================================ */}
      {/* MILESTONES VIEW                                                  */}
      {/* ================================================================ */}
      {view === "milestones" && (
        <div className="space-y-6">
          <MilestoneGroup
            title="Forecasted Inspection Complete (Milestone 1)"
            description="Projects with forecasted inspection dates requiring completion reporting"
            accentBg="bg-yellow-500/10"
            accentTitle="text-yellow-400"
            accentDesc="text-yellow-500/70"
            projects={inspectionMilestones}
            dateField="forecast_inspection"
            daysField="days_to_inspection"
            threshold={14}
          />

          <MilestoneGroup
            title="Forecasted PTO (Milestone 2)"
            description="Projects with forecasted PTO dates requiring completion reporting"
            accentBg="bg-green-500/10"
            accentTitle="text-green-400"
            accentDesc="text-green-500/70"
            projects={ptoMilestones}
            dateField="forecast_pto"
            daysField="days_to_pto"
            threshold={30}
          />
        </div>
      )}

      {/* ================================================================ */}
      {/* REVENUE VIEW                                                     */}
      {/* ================================================================ */}
      {view === "revenue" && (
        <RevenueView
          projects={projects}
          revenuePeriod={revenuePeriod}
          setRevenuePeriod={setRevenuePeriod}
        />
      )}
    </DashboardShell>
  );
}
