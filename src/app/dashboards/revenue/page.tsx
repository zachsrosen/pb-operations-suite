"use client";

import { useState, useMemo } from "react";
import DashboardShell from "@/components/DashboardShell";
import { useExecutiveData } from "@/hooks/useExecutiveData";
import {
  generateMonthlyPeriods,
  generateWeeklyPeriods,
  formatRevenueShort,
  type MilestoneConfig,
} from "@/lib/revenue-utils";
import {
  type ExecProject,
  STAGE_ORDER,
  STAGE_COLORS,
  BACKLOG_STAGES,
  formatCurrencyExec,
} from "@/lib/executive-shared";

// ---- Sub-components ----

function StatCard({
  value,
  label,
  sub,
  variant,
  borderColor,
}: {
  value: string | number;
  label: string;
  sub?: string;
  variant?: "accent" | "pe" | "danger" | "default";
  borderColor?: string;
}) {
  const variantClasses: Record<string, string> = {
    accent: "border-orange-500 bg-orange-500/10",
    pe: "border-emerald-500 bg-emerald-500/10",
    danger: "border-red-500 bg-red-500/10",
    default: "border-t-border bg-surface",
  };
  const cls = variantClasses[variant || "default"];
  const style = borderColor && !variant ? { borderColor } : undefined;

  return (
    <div className={`rounded-xl border p-4 ${cls}`} style={style}>
      <div className="text-3xl font-bold font-mono">{value}</div>
      <div className="text-[0.7rem] text-muted mt-1">{label}</div>
      {sub && <div className="text-[0.65rem] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-md text-xs font-medium cursor-pointer border transition-all
        ${
          active
            ? "bg-orange-500 border-orange-500 text-black"
            : "bg-background border-t-border text-foreground/80 hover:border-orange-500 hover:text-orange-500"
        }`}
    >
      {children}
    </button>
  );
}

// ---- Backlog period type ----

interface BacklogPeriod {
  key: string;
  label: string;
  count: number;
  value: number;
  byLocation: Record<string, number>;
  byStage: Record<string, number>;
}

// ---- Milestone configs ----

const DEAL_MILESTONES: MilestoneConfig[] = [
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
    title: "Inspections Passed",
    dateField: "inspection_pass",
    forecastField: "forecast_inspection",
    borderColor: "border-l-emerald-500",
    barColor: "bg-emerald-500",
    headerBg: "bg-emerald-500/10",
  },
  {
    title: "PTO Granted",
    dateField: "pto_granted",
    forecastField: "forecast_pto",
    borderColor: "border-l-amber-500",
    barColor: "bg-amber-500",
    headerBg: "bg-amber-500/10",
  },
];

// ---- Main component ----

export default function RevenuePage() {
  const { projects, loading, error, lastUpdated, fetchData, accessChecked } =
    useExecutiveData("revenue");

  const [revenueViewMode, setRevenueViewMode] = useState<"weekly" | "monthly">("weekly");
  const [expandedBacklog, setExpandedBacklog] = useState<Record<string, boolean>>({});
  const [expandedTimeline, setExpandedTimeline] = useState<Record<string, boolean>>({});

  const totalValue = projects.reduce((s, p) => s + p.amount, 0);
  const scheduledValue = projects
    .filter((p) => p.forecast_install && !p.construction_complete)
    .reduce((s, p) => s + p.amount, 0);
  const rtbValue = projects.filter((p) => p.is_rtb).reduce((s, p) => s + p.amount, 0);
  const peValue = projects.filter((p) => p.is_participate_energy).reduce((s, p) => s + p.amount, 0);

  // Stage Revenue
  const stageData = useMemo(() => {
    const data: Record<string, { count: number; value: number }> = {};
    let maxVal = 0;
    projects.forEach((p) => {
      if (!data[p.stage]) data[p.stage] = { count: 0, value: 0 };
      data[p.stage].count++;
      data[p.stage].value += p.amount;
      if (data[p.stage].value > maxVal) maxVal = data[p.stage].value;
    });
    const sorted = Object.keys(data).sort((a, b) => {
      const ai = STAGE_ORDER.indexOf(a);
      const bi = STAGE_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return { data, sorted, maxVal };
  }, [projects]);

  // Backlog Revenue
  const backlogData = useMemo(() => {
    const backlogProjects = projects.filter((p) => BACKLOG_STAGES.includes(p.stage));
    const now = new Date();
    const monthlyData: Record<
      string,
      { label: string; count: number; value: number; byLocation: Record<string, number>; byStage: Record<string, number> }
    > = {};

    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = d.toISOString().substring(0, 7);
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      monthlyData[key] = { label, count: 0, value: 0, byLocation: {}, byStage: {} };
    }
    monthlyData["overdue"] = { label: "Overdue", count: 0, value: 0, byLocation: {}, byStage: {} };

    backlogProjects.forEach((p) => {
      if (!p.forecast_install) return;
      const installDate = new Date(p.forecast_install);
      const monthKey = installDate.toISOString().substring(0, 7);
      const location = p.pb_location || "Unknown";
      const stage = p.stage;

      let bucket;
      if (installDate < now) {
        bucket = monthlyData["overdue"];
      } else if (monthlyData[monthKey]) {
        bucket = monthlyData[monthKey];
      } else {
        return;
      }

      bucket.count++;
      bucket.value += p.amount;
      bucket.byLocation[location] = (bucket.byLocation[location] || 0) + p.amount;
      bucket.byStage[stage] = (bucket.byStage[stage] || 0) + p.amount;
    });

    const sortedPeriods: BacklogPeriod[] = Object.entries(monthlyData)
      .filter(([k, data]) => data.count > 0 || k !== "overdue")
      .sort((a, b) => {
        if (a[0] === "overdue") return -1;
        if (b[0] === "overdue") return 1;
        return a[0].localeCompare(b[0]);
      })
      .map(([key, data]) => ({ key, ...data }));

    const totalBacklogValue = backlogProjects.reduce((s, p) => s + p.amount, 0);
    const totalBacklogCount = backlogProjects.length;
    const overdueValue = monthlyData["overdue"]?.value || 0;

    return { sortedPeriods, totalBacklogValue, totalBacklogCount, overdueValue };
  }, [projects]);

  // Location Revenue
  const locationData = useMemo(() => {
    const data: Record<string, { count: number; value: number; rtbValue: number; scheduledValue: number }> = {};
    projects.forEach((p) => {
      const loc = p.pb_location || "Unknown";
      if (!data[loc]) data[loc] = { count: 0, value: 0, rtbValue: 0, scheduledValue: 0 };
      data[loc].count++;
      data[loc].value += p.amount;
      if (p.is_rtb) data[loc].rtbValue += p.amount;
      if (p.forecast_install && !p.construction_complete) data[loc].scheduledValue += p.amount;
    });
    const sorted = Object.keys(data).sort((a, b) => data[b].value - data[a].value);
    return { data, sorted };
  }, [projects]);

  // Timeline
  const timelineData = useMemo(() => {
    const now = new Date();
    const periods: { label: string; start: Date; end: Date }[] = [];

    if (revenueViewMode === "weekly") {
      for (let i = 0; i < 8; i++) {
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + i * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        periods.push({
          label:
            weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
            " - " +
            weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          start: weekStart,
          end: weekEnd,
        });
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
        periods.push({
          label: monthStart.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
          start: monthStart,
          end: monthEnd,
        });
      }
    }

    const locations = [...new Set(projects.map((p) => p.pb_location))]
      .filter((l) => l !== "Unknown")
      .sort();

    return periods.map((period) => {
      const data = {
        label: period.label,
        start: period.start,
        end: period.end,
        total: 0,
        count: 0,
        byLocation: {} as Record<string, { value: number; count: number }>,
      };
      locations.forEach((loc) => (data.byLocation[loc] = { value: 0, count: 0 }));

      projects.forEach((p) => {
        if (p.forecast_install) {
          const installDate = new Date(p.forecast_install);
          if (installDate >= period.start && installDate <= period.end) {
            data.total += p.amount;
            data.count++;
            if (data.byLocation[p.pb_location]) {
              data.byLocation[p.pb_location].value += p.amount;
              data.byLocation[p.pb_location].count++;
            }
          }
        }
      });
      return data;
    });
  }, [projects, revenueViewMode]);

  // Milestone periods + data
  const periods = useMemo(
    () => (revenueViewMode === "monthly" ? generateMonthlyPeriods() : generateWeeklyPeriods()),
    [revenueViewMode]
  );

  const pipelineStrength = useMemo(() => {
    const rtb = projects.filter((p) => p.is_rtb);
    const designApproved = projects.filter((p) => p.design_approval && !p.construction_complete);
    const scheduledConstruction = projects.filter((p) => p.forecast_install && !p.construction_complete);
    const pendingInspection = projects.filter((p) => p.construction_complete && !p.inspection_pass);
    const awaitingPto = projects.filter((p) => p.inspection_pass && !p.pto_granted);
    return [
      { label: "RTB Projects", count: rtb.length, value: rtb.reduce((s, p) => s + p.amount, 0), color: "emerald" },
      { label: "Design Approved", count: designApproved.length, value: designApproved.reduce((s, p) => s + p.amount, 0), color: "purple" },
      { label: "Scheduled Construction", count: scheduledConstruction.length, value: scheduledConstruction.reduce((s, p) => s + p.amount, 0), color: "blue" },
      { label: "Pending Inspection", count: pendingInspection.length, value: pendingInspection.reduce((s, p) => s + p.amount, 0), color: "violet" },
      { label: "Awaiting PTO", count: awaitingPto.length, value: awaitingPto.reduce((s, p) => s + p.amount, 0), color: "amber" },
    ];
  }, [projects]);

  const milestoneData = useMemo(() => {
    return DEAL_MILESTONES.map((config) => {
      const periodData = periods.map((period) => {
        const matching = projects.filter((p) => {
          const dateStr =
            (p[config.dateField as keyof ExecProject] as string | null) ||
            (config.dateField !== config.forecastField
              ? (p[config.forecastField as keyof ExecProject] as string | null)
              : null);
          if (!dateStr) return false;
          const d = new Date(dateStr);
          return d >= period.start && d <= period.end;
        });
        return {
          count: matching.length,
          revenue: matching.reduce((s, p) => s + p.amount, 0),
        };
      });
      const maxRevenue = Math.max(...periodData.map((d) => d.revenue), 1);
      return { config, periodData, maxRevenue };
    });
  }, [projects, periods]);

  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    purple: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    blue: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    violet: "bg-violet-500/20 text-violet-400 border-violet-500/30",
    amber: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  };

  if (!accessChecked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted text-lg">Checking access...</div>
      </div>
    );
  }

  return (
    <DashboardShell
      title="Revenue"
      subtitle={`${formatCurrencyExec(totalValue, "M")} total pipeline`}
      accentColor="orange"
      lastUpdated={lastUpdated}
    >
      {loading && projects.length === 0 ? (
        <div className="bg-surface border border-t-border rounded-xl p-8 text-center">
          <div className="text-lg text-muted">Loading revenue data...</div>
        </div>
      ) : error && projects.length === 0 ? (
        <div className="bg-surface border border-red-500 rounded-xl p-8 text-center">
          <div className="text-lg">Error loading data</div>
          <div className="text-sm text-muted mt-2">{error}</div>
          <button onClick={fetchData} className="mt-4 px-4 py-2 bg-orange-500 border-none rounded-md cursor-pointer text-black font-semibold">Retry</button>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard value={formatCurrencyExec(totalValue, "M")} label="Total Pipeline" sub={`${projects.length} projects`} />
            <StatCard value={formatCurrencyExec(scheduledValue, "M")} label="Scheduled" sub="With install dates" variant="accent" />
            <StatCard value={formatCurrencyExec(rtbValue, "M")} label="Ready to Build" sub={`${projects.filter((p) => p.is_rtb).length} projects`} borderColor="#10b981" />
            <StatCard value={formatCurrencyExec(peValue, "M")} label="Participate Energy" sub={`${projects.filter((p) => p.is_participate_energy).length} projects`} variant="pe" />
          </div>

          {/* Revenue by Stage */}
          <div className="bg-surface border border-t-border rounded-xl p-5 mt-6">
            <h3 className="text-base font-semibold mb-4 text-orange-500">Revenue by Deal Stage</h3>
            <div>
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr] py-3 border-b border-t-border font-semibold text-[0.7rem] text-muted uppercase tracking-wider">
                <div>Stage</div>
                <div className="text-right">Projects</div>
                <div className="text-right">Value</div>
                <div>Distribution</div>
              </div>
              {stageData.sorted.map((stage) => {
                const data = stageData.data[stage];
                const pct = stageData.maxVal > 0 ? (data.value / stageData.maxVal) * 100 : 0;
                const color = STAGE_COLORS[stage] || "#f97316";
                return (
                  <div key={stage} className="grid grid-cols-[2fr_1fr_1fr_1fr] py-3 border-b border-t-border items-center text-sm">
                    <div className="font-medium">{stage}</div>
                    <div className="text-right text-muted text-sm">{data.count}</div>
                    <div className="text-right font-mono font-semibold text-orange-500">{formatCurrencyExec(data.value)}</div>
                    <div>
                      <div className="h-2 bg-background rounded overflow-hidden">
                        <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr] py-3 font-bold bg-background rounded-lg mt-2 px-3">
                <div>Total</div>
                <div className="text-right">{projects.length}</div>
                <div className="text-right font-mono text-orange-500">{formatCurrencyExec(totalValue, "M")}</div>
                <div />
              </div>
            </div>
          </div>

          {/* Backlog Forecasted Revenue */}
          <div className="bg-surface border border-emerald-500 rounded-xl p-5 mt-6">
            <h3 className="text-base font-semibold mb-1 text-emerald-500">Backlog Forecasted Revenue</h3>
            <p className="text-xs text-muted mb-4">Revenue from RTB, RTB-Blocked, and pre-construction stages based on forecasted install dates</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-background p-4 rounded-lg text-center">
                <div className="text-2xl font-bold font-mono text-emerald-500">{formatCurrencyExec(backlogData.totalBacklogValue, "M")}</div>
                <div className="text-[0.7rem] text-muted">Total Backlog Value</div>
              </div>
              <div className="bg-background p-4 rounded-lg text-center">
                <div className="text-2xl font-bold font-mono">{backlogData.totalBacklogCount}</div>
                <div className="text-[0.7rem] text-muted">Backlog Projects</div>
              </div>
              <div className="bg-background p-4 rounded-lg text-center">
                <div className="text-2xl font-bold font-mono text-red-500">{formatCurrencyExec(backlogData.overdueValue, "M")}</div>
                <div className="text-[0.7rem] text-muted">Overdue (Past Forecast)</div>
              </div>
            </div>

            <div className="text-sm">
              <div className="grid grid-cols-[1.2fr_1fr_1fr_80px] py-3 border-b border-t-border font-semibold text-[0.7rem] text-muted">
                <div>Forecasted Month</div>
                <div className="text-right">Projects</div>
                <div className="text-right">Revenue</div>
                <div>Breakdown</div>
              </div>
              {backlogData.sortedPeriods.map((period) => {
                const isOverdue = period.key === "overdue";
                const stageBreakdown = Object.entries(period.byStage)
                  .sort((a, b) => b[1] - a[1])
                  .map(([stage, val]) => `${stage}: ${formatCurrencyExec(val)}`)
                  .join(" | ");
                const locationBreakdown = Object.entries(period.byLocation)
                  .sort((a, b) => b[1] - a[1])
                  .map(([loc, val]) => `${loc}: ${formatCurrencyExec(val)}`)
                  .join(", ");

                return (
                  <div
                    key={period.key}
                    className={`grid grid-cols-[1.2fr_1fr_1fr_80px] py-3 border-b border-t-border items-center text-sm ${isOverdue ? "bg-red-500/10" : ""}`}
                  >
                    <div className={`font-medium ${isOverdue ? "text-red-500" : ""}`}>{period.label}</div>
                    <div className="text-right text-muted">{period.count}</div>
                    <div className={`text-right font-mono font-semibold ${isOverdue ? "text-red-500" : "text-emerald-500"}`}>
                      {formatCurrencyExec(period.value)}
                    </div>
                    <div>
                      <button
                        className="text-[0.6rem] px-1.5 py-0.5 rounded border border-t-border text-foreground/80 hover:border-orange-500 hover:text-orange-500"
                        onClick={() => setExpandedBacklog((prev) => ({ ...prev, [period.key]: !prev[period.key] }))}
                      >
                        {expandedBacklog[period.key] ? "-" : "+"}
                      </button>
                      {expandedBacklog[period.key] && (
                        <div className="text-[0.7rem] text-muted mt-1">
                          <div className="mb-1"><strong>By Stage:</strong> {stageBreakdown || "N/A"}</div>
                          <div><strong>By Location:</strong> {locationBreakdown || "N/A"}</div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Location Revenue + Timeline */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <div className="bg-surface border border-t-border rounded-xl p-5">
              <h3 className="text-base font-semibold mb-4 text-orange-500">Scheduled Revenue by Location</h3>
              <div className="text-sm">
                <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] py-2 font-semibold text-[0.7rem] text-muted uppercase border-b border-t-border">
                  <div>Location</div>
                  <div className="text-right">Projects</div>
                  <div className="text-right">Total</div>
                  <div className="text-right">RTB</div>
                  <div className="text-right">Scheduled</div>
                </div>
                {locationData.sorted.map((loc) => {
                  const data = locationData.data[loc];
                  return (
                    <div key={loc} className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] py-2.5 border-b border-t-border text-sm">
                      <div className="font-medium">{loc}</div>
                      <div className="text-right text-muted">{data.count}</div>
                      <div className="text-right font-mono font-semibold text-orange-500">{formatCurrencyExec(data.value)}</div>
                      <div className="text-right font-mono font-semibold text-emerald-500">{formatCurrencyExec(data.rtbValue)}</div>
                      <div className="text-right font-mono font-semibold text-blue-500">{formatCurrencyExec(data.scheduledValue)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-surface border border-t-border rounded-xl p-5">
              <h3 className="text-base font-semibold mb-4 text-orange-500">Scheduled Revenue Timeline</h3>
              <div className="flex gap-2 mb-4">
                <FilterBtn active={revenueViewMode === "weekly"} onClick={() => setRevenueViewMode("weekly")}>Weekly</FilterBtn>
                <FilterBtn active={revenueViewMode === "monthly"} onClick={() => setRevenueViewMode("monthly")}>Monthly</FilterBtn>
              </div>
              <div className="text-sm max-h-[400px] overflow-y-auto">
                <div className="grid grid-cols-[1.2fr_1fr_1fr_80px] py-3 font-semibold text-[0.7rem] text-muted border-b border-t-border">
                  <div>Period</div>
                  <div className="text-right">Projects</div>
                  <div className="text-right">Revenue</div>
                  <div>Details</div>
                </div>
                {timelineData.map((period, idx) => {
                  const locationBreakdown = Object.entries(period.byLocation)
                    .filter(([, d]) => d.count > 0)
                    .map(([loc, d]) => `${loc}: ${formatCurrencyExec(d.value)} (${d.count})`)
                    .join(", ");
                  return (
                    <div key={idx} className="grid grid-cols-[1.2fr_1fr_1fr_80px] py-3 border-b border-t-border items-center text-sm">
                      <div className="font-medium">{period.label}</div>
                      <div className="text-right text-muted">{period.count}</div>
                      <div className="text-right font-mono font-semibold text-orange-500">{formatCurrencyExec(period.total)}</div>
                      <div>
                        <button
                          className="text-[0.6rem] px-1.5 py-0.5 rounded border border-t-border text-foreground/80 hover:border-orange-500 hover:text-orange-500"
                          onClick={() => setExpandedTimeline((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                        >
                          {expandedTimeline[idx] ? "-" : "+"}
                        </button>
                        {expandedTimeline[idx] && (
                          <div className="text-[0.7rem] text-muted mt-1">{locationBreakdown || "No scheduled installs"}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[1.2fr_1fr_1fr_80px] py-3 font-bold bg-background rounded-lg mt-2 px-3">
                  <div>Total</div>
                  <div className="text-right">{timelineData.reduce((s, p) => s + p.count, 0)}</div>
                  <div className="text-right font-mono text-orange-500">{formatCurrencyExec(timelineData.reduce((s, p) => s + p.total, 0), "M")}</div>
                  <div />
                </div>
              </div>
            </div>
          </div>

          {/* Milestone Revenue Breakdown */}
          <div className="space-y-6 mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">Milestone Revenue Breakdown</h3>
              <div className="flex gap-1 bg-surface-2 rounded-lg p-0.5">
                <button
                  onClick={() => setRevenueViewMode("weekly")}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${revenueViewMode === "weekly" ? "bg-orange-500 text-white" : "text-muted hover:text-foreground/90"}`}
                >Weekly</button>
                <button
                  onClick={() => setRevenueViewMode("monthly")}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${revenueViewMode === "monthly" ? "bg-orange-500 text-white" : "text-muted hover:text-foreground/90"}`}
                >Monthly</button>
              </div>
            </div>

            {/* Pipeline Strength Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {pipelineStrength.map((item) => (
                <div key={item.label} className={`rounded-lg border p-3 ${colorMap[item.color] || "bg-surface-2 border-t-border"}`}>
                  <div className="text-[0.65rem] font-medium opacity-80">{item.label}</div>
                  <div className="text-xl font-bold mt-1">{item.count}</div>
                  <div className="text-[0.7rem] font-mono mt-0.5">{formatRevenueShort(item.value)}</div>
                </div>
              ))}
            </div>

            {/* Milestone Tables */}
            {milestoneData.map(({ config, periodData, maxRevenue }) => (
              <div key={config.title} className={`bg-surface rounded-lg border border-t-border ${config.borderColor} border-l-4 overflow-hidden`}>
                <div className={`${config.headerBg} px-4 py-2.5 flex items-center justify-between`}>
                  <span className="text-sm font-bold">{config.title}</span>
                  <span className="text-xs text-muted">
                    {periodData.reduce((s, d) => s + d.count, 0)} total &middot; {formatRevenueShort(periodData.reduce((s, d) => s + d.revenue, 0))}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <div className="min-w-[600px]">
                    <div className="grid gap-px px-4 py-2 border-b border-t-border" style={{ gridTemplateColumns: `repeat(${periods.length}, 1fr)` }}>
                      {periods.map((p, i) => (
                        <div key={i} className={`text-[0.6rem] text-center ${p.isCurrent ? "text-orange-400 font-bold" : p.isPast ? "text-muted/70" : "text-muted"}`}>
                          {p.label}
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-px px-4 py-1.5" style={{ gridTemplateColumns: `repeat(${periods.length}, 1fr)` }}>
                      {periodData.map((d, i) => (
                        <div key={i} className={`text-center text-sm font-bold ${periods[i].isCurrent ? "text-orange-400" : periods[i].isPast ? "text-muted/70" : "text-foreground/90"}`}>
                          {d.count || "\u2014"}
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-px px-4 py-1" style={{ gridTemplateColumns: `repeat(${periods.length}, 1fr)` }}>
                      {periodData.map((d, i) => (
                        <div key={i} className={`text-center text-[0.6rem] font-mono ${periods[i].isPast ? "text-muted/70" : "text-muted"}`}>
                          {d.revenue > 0 ? formatRevenueShort(d.revenue) : "\u2014"}
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-px px-4 py-2 pb-3" style={{ gridTemplateColumns: `repeat(${periods.length}, 1fr)` }}>
                      {periodData.map((d, i) => (
                        <div key={i} className="flex justify-center">
                          <div className="w-full max-w-[40px] h-6 bg-surface-2 rounded-sm overflow-hidden relative">
                            <div
                              className={`absolute bottom-0 w-full rounded-sm transition-all ${config.barColor} ${periods[i].isPast ? "opacity-40" : ""}`}
                              style={{ height: `${maxRevenue > 0 ? (d.revenue / maxRevenue) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </DashboardShell>
  );
}
