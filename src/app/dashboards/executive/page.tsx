"use client";

import { useState, useEffect, useMemo } from "react";
import DashboardShell from "@/components/DashboardShell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawProject {
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
}

interface TransformedProject {
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

interface LocationData {
  count: number;
  value: number;
  overdue: number;
}

interface StageData {
  count: number;
  value: number;
}

interface MonthData {
  count: number;
  value: number;
}

interface Metrics {
  total: number;
  totalValue: number;
  overdueInstall: number;
  overdueInstallValue: number;
  overdueInspection: number;
  overduePto: number;
  overduePtoValue: number;
  onTrack: number;
  byLocation: Record<string, LocationData>;
  byStage: Record<string, StageData>;
  byMonth: Record<string, MonthData>;
  stageOrder: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGE_ORDER: string[] = [
  "Site Survey",
  "Design & Engineering",
  "Permitting & Interconnection",
  "Ready To Build",
  "RTB - Blocked",
  "Construction",
  "Inspection",
  "Permission To Operate",
];

const STAGE_COLORS: Record<string, string> = {
  "Site Survey": "bg-gray-400",
  "Design & Engineering": "bg-blue-500",
  "Permitting & Interconnection": "bg-purple-500",
  "Ready To Build": "bg-emerald-500",
  "RTB - Blocked": "bg-red-500",
  "Construction": "bg-yellow-500",
  "Inspection": "bg-orange-500",
  "Permission To Operate": "bg-teal-500",
};

const LOCATION_COLORS: string[] = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-yellow-500",
  "bg-red-500",
  "bg-purple-500",
  "bg-zinc-500",
  "bg-pink-500",
  "bg-cyan-500",
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function transformProject(p: RawProject): TransformedProject {
  const now = new Date();
  const closeDate = p.closeDate ? new Date(p.closeDate) : null;
  const daysSinceClose = closeDate
    ? Math.floor((now.getTime() - closeDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const forecastInstall =
    p.forecastedInstallDate ||
    p.constructionScheduleDate ||
    (closeDate
      ? new Date(closeDate.getTime() + 75 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0]
      : null);
  const forecastInspection =
    p.forecastedInspectionDate ||
    (closeDate
      ? new Date(closeDate.getTime() + 114 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0]
      : null);
  const forecastPto =
    p.forecastedPtoDate ||
    (closeDate
      ? new Date(closeDate.getTime() + 139 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0]
      : null);

  const daysToInstall = forecastInstall
    ? Math.floor(
        (new Date(forecastInstall).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;
  const daysToInspection = forecastInspection
    ? Math.floor(
        (new Date(forecastInspection).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;
  const daysToPto = forecastPto
    ? Math.floor(
        (new Date(forecastPto).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  return {
    id: p.id,
    name: p.name,
    pb_location: p.pbLocation || "Unknown",
    ahj: p.ahj || "Unknown",
    utility: p.utility || "Unknown",
    project_type: p.projectType || "Unknown",
    stage: p.stage,
    amount: p.amount || 0,
    url: p.url,
    close_date: p.closeDate,
    permit_submit: p.permitSubmitDate,
    permit_issued: p.permitIssueDate,
    install_scheduled: p.constructionScheduleDate,
    construction_complete: p.constructionCompleteDate,
    inspection_scheduled: p.inspectionScheduleDate,
    inspection_pass: p.inspectionPassDate,
    pto_granted: p.ptoGrantedDate,
    forecast_install: forecastInstall,
    forecast_inspection: forecastInspection,
    forecast_pto: forecastPto,
    days_to_install: daysToInstall,
    days_to_inspection: daysToInspection,
    days_to_pto: daysToPto,
    days_since_close: daysSinceClose,
  };
}

function formatCurrency(val: number): string {
  return "$" + (val / 1_000_000).toFixed(2) + "M";
}

function formatCurrencyK(val: number): string {
  return val >= 1_000_000
    ? "$" + (val / 1_000_000).toFixed(1) + "M"
    : "$" + (val / 1_000).toFixed(0) + "K";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  sub,
  border,
  valueColor,
  subColor,
}: {
  label: string;
  value: string;
  sub: string;
  border?: string;
  valueColor?: string;
  subColor?: string;
}) {
  return (
    <div
      className={`bg-[#12121a] rounded-xl border border-zinc-800 p-5 ${border || ""}`}
    >
      <div className="text-zinc-400 text-sm font-medium">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${valueColor || "text-white"}`}>
        {value}
      </div>
      <div className={`text-sm mt-1 ${subColor || "text-zinc-500"}`}>{sub}</div>
    </div>
  );
}

/** Horizontal bar chart built with divs */
function HorizontalBarChart({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number; color: string }[];
}) {
  const maxValue = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-5">
      <h3 className="text-sm font-semibold text-zinc-300 mb-4">{title}</h3>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-zinc-400 truncate mr-2" title={item.label}>
                {item.label}
              </span>
              <span className="text-zinc-300 font-medium shrink-0">
                {item.value}
              </span>
            </div>
            <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${item.color} transition-all duration-500`}
                style={{
                  width: `${maxValue > 0 ? (item.value / maxValue) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Value distribution with colored segments and legend */
function ValueDistributionChart({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number; color: string }[];
}) {
  const total = items.reduce((s, i) => s + i.value, 0);

  return (
    <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-5">
      <h3 className="text-sm font-semibold text-zinc-300 mb-4">{title}</h3>
      {/* Segmented bar */}
      <div className="h-5 rounded-full overflow-hidden flex bg-zinc-800 mb-5">
        {items.map((item) => {
          const pct = total > 0 ? (item.value / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={item.label}
              className={`${item.color} transition-all duration-500`}
              style={{ width: `${pct}%` }}
              title={`${item.label}: ${formatCurrencyK(item.value)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      {/* Legend */}
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const pct = total > 0 ? (item.value / total) * 100 : 0;
          return (
            <div key={item.label} className="flex items-center gap-2 text-xs">
              <span
                className={`w-3 h-3 rounded-sm shrink-0 ${item.color}`}
              />
              <span className="text-zinc-400 truncate">{item.label}</span>
              <span className="text-zinc-500 ml-auto shrink-0">
                {formatCurrencyK(item.value)} ({pct.toFixed(0)}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** PTO timeline visualization */
function TimelineChart({
  title,
  items,
}: {
  title: string;
  items: { label: string; count: number; value: number }[];
}) {
  const maxCount = Math.max(...items.map((i) => i.count), 1);

  return (
    <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-5">
      <h3 className="text-sm font-semibold text-zinc-300 mb-4">{title}</h3>
      {items.length === 0 ? (
        <p className="text-zinc-500 text-sm">No forecast data available</p>
      ) : (
        <div className="flex items-end gap-2 h-40">
          {items.map((item) => {
            const heightPct = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
            return (
              <div
                key={item.label}
                className="flex-1 flex flex-col items-center justify-end h-full"
              >
                <span className="text-xs text-zinc-300 font-medium mb-1">
                  {item.count}
                </span>
                <div
                  className="w-full bg-emerald-500/80 rounded-t transition-all duration-500"
                  style={{ height: `${heightPct}%`, minHeight: item.count > 0 ? "4px" : "0px" }}
                />
                <span className="text-[10px] text-zinc-500 mt-2 text-center leading-tight">
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function ExecutiveSummaryPage() {
  const [projectData, setProjectData] = useState<TransformedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Fetch data ---------------------------------------------------------------
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const response = await fetch("/api/projects?context=executive");
        if (!response.ok) throw new Error("Failed to fetch data");
        const data = await response.json();
        setProjectData(
          (data.projects as RawProject[]).map(transformProject),
        );
        setLastUpdated(new Date().toLocaleTimeString());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Compute metrics ----------------------------------------------------------
  const metrics: Metrics | null = useMemo(() => {
    if (projectData.length === 0) return null;

    const totalValue = projectData.reduce((sum, p) => sum + (p.amount || 0), 0);

    const overdueInstall = projectData.filter(
      (p) =>
        !p.construction_complete &&
        p.days_to_install !== null &&
        p.days_to_install < 0,
    );
    const overdueInspection = projectData.filter(
      (p) =>
        !p.inspection_pass &&
        p.days_to_inspection !== null &&
        p.days_to_inspection < 0,
    );
    const overduePto = projectData.filter(
      (p) =>
        !p.pto_granted && p.days_to_pto !== null && p.days_to_pto < 0,
    );
    const onTrack = projectData.filter(
      (p) =>
        !p.pto_granted &&
        p.days_to_pto !== null &&
        p.days_to_pto >= 0 &&
        p.days_to_pto <= 30,
    );

    const byLocation: Record<string, LocationData> = {};
    projectData.forEach((p) => {
      const loc = p.pb_location || "Unknown";
      if (!byLocation[loc])
        byLocation[loc] = { count: 0, value: 0, overdue: 0 };
      byLocation[loc].count++;
      byLocation[loc].value += p.amount || 0;
      if (!p.pto_granted && p.days_to_pto !== null && p.days_to_pto < 0)
        byLocation[loc].overdue++;
    });

    const byStage: Record<string, StageData> = {};
    STAGE_ORDER.forEach((s) => (byStage[s] = { count: 0, value: 0 }));
    projectData.forEach((p) => {
      if (byStage[p.stage]) {
        byStage[p.stage].count++;
        byStage[p.stage].value += p.amount || 0;
      }
    });

    const byMonth: Record<string, MonthData> = {};
    projectData.forEach((p) => {
      if (p.forecast_pto) {
        const month = p.forecast_pto.substring(0, 7);
        if (!byMonth[month]) byMonth[month] = { count: 0, value: 0 };
        byMonth[month].count++;
        byMonth[month].value += p.amount || 0;
      }
    });

    return {
      total: projectData.length,
      totalValue,
      overdueInstall: overdueInstall.length,
      overdueInstallValue: overdueInstall.reduce(
        (s, p) => s + (p.amount || 0),
        0,
      ),
      overdueInspection: overdueInspection.length,
      overduePto: overduePto.length,
      overduePtoValue: overduePto.reduce((s, p) => s + (p.amount || 0), 0),
      onTrack: onTrack.length,
      byLocation,
      byStage,
      byMonth,
      stageOrder: STAGE_ORDER,
    };
  }, [projectData]);

  // Derived chart data -------------------------------------------------------
  const stageChartItems = useMemo(() => {
    if (!metrics) return [];
    return STAGE_ORDER.map((s) => ({
      label: s,
      value: metrics.byStage[s]?.count ?? 0,
      color: STAGE_COLORS[s] || "bg-zinc-500",
    }));
  }, [metrics]);

  const locationChartItems = useMemo(() => {
    if (!metrics) return [];
    return Object.entries(metrics.byLocation)
      .sort((a, b) => b[1].value - a[1].value)
      .map(([loc, data], i) => ({
        label: loc,
        value: data.value,
        color: LOCATION_COLORS[i % LOCATION_COLORS.length],
      }));
  }, [metrics]);

  const timelineItems = useMemo(() => {
    if (!metrics) return [];
    return Object.keys(metrics.byMonth)
      .sort()
      .map((m) => {
        const [y, mo] = m.split("-");
        const label = new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString(
          "en-US",
          { month: "short", year: "2-digit" },
        );
        return {
          label,
          count: metrics.byMonth[m].count,
          value: metrics.byMonth[m].value,
        };
      });
  }, [metrics]);

  // Loading state ------------------------------------------------------------
  if (loading) {
    return (
      <DashboardShell
        title="Executive Summary"
        subtitle="Pipeline Overview"
        accentColor="orange"
      >
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4" />
            <p className="text-zinc-500">Loading pipeline data...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  // Error state --------------------------------------------------------------
  if (error) {
    return (
      <DashboardShell
        title="Executive Summary"
        subtitle="Pipeline Overview"
        accentColor="orange"
      >
        <div className="flex items-center justify-center py-32">
          <div className="text-center bg-[#12121a] rounded-xl border border-zinc-800 p-8 max-w-sm">
            <div className="text-red-400 text-4xl mb-4">!</div>
            <h2 className="text-xl font-bold text-white mb-2">
              Failed to Load Data
            </h2>
            <p className="text-zinc-400 mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (!metrics) return null;

  // Render -------------------------------------------------------------------
  return (
    <DashboardShell
      title="Executive Summary"
      subtitle={`Photon Brothers \u2022 ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`}
      accentColor="orange"
      lastUpdated={lastUpdated}
      headerRight={
        <div className="inline-flex items-center px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-xs border border-emerald-500/20">
          <span className="w-2 h-2 bg-emerald-400 rounded-full mr-2 animate-pulse" />
          Live Data
        </div>
      }
    >
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Total Pipeline"
          value={formatCurrency(metrics.totalValue)}
          sub={`${metrics.total} projects`}
          valueColor="text-white"
          subColor="text-zinc-500"
        />
        <MetricCard
          label="PTO Overdue"
          value={String(metrics.overduePto)}
          sub={`${formatCurrencyK(metrics.overduePtoValue)} at risk`}
          border="border-l-4 !border-l-red-500"
          valueColor="text-red-400"
          subColor="text-red-400/60"
        />
        <MetricCard
          label="Install Overdue"
          value={String(metrics.overdueInstall)}
          sub={`${formatCurrencyK(metrics.overdueInstallValue)} delayed`}
          border="border-l-4 !border-l-yellow-500"
          valueColor="text-yellow-400"
          subColor="text-yellow-400/60"
        />
        <MetricCard
          label="On Track"
          value={String(metrics.onTrack)}
          sub={`${metrics.total > 0 ? Math.round((metrics.onTrack / metrics.total) * 100) : 0}% healthy`}
          border="border-l-4 !border-l-emerald-500"
          valueColor="text-emerald-400"
          subColor="text-emerald-400/60"
        />
      </div>

      {/* Charts row */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <HorizontalBarChart title="Projects by Stage" items={stageChartItems} />
        <ValueDistributionChart
          title="Pipeline Value by Location"
          items={locationChartItems}
        />
      </div>

      {/* PTO Timeline */}
      <div className="mb-6">
        <TimelineChart title="Forecasted PTO Timeline" items={timelineItems} />
      </div>

      {/* Location Performance Table */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-5 mb-6">
        <h3 className="text-sm font-semibold text-zinc-300 mb-4">
          Location Performance
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left py-3 text-zinc-400 font-medium">
                  Location
                </th>
                <th className="text-right py-3 text-zinc-400 font-medium">
                  Projects
                </th>
                <th className="text-right py-3 text-zinc-400 font-medium">
                  Value
                </th>
                <th className="text-right py-3 text-zinc-400 font-medium">
                  Overdue
                </th>
                <th className="text-right py-3 text-zinc-400 font-medium">
                  Health
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(metrics.byLocation)
                .sort((a, b) => b[1].value - a[1].value)
                .map(([loc, data]) => {
                  const health =
                    data.count > 0
                      ? Math.round((1 - data.overdue / data.count) * 100)
                      : 100;
                  const healthColor =
                    health >= 80
                      ? "bg-emerald-500/10 text-emerald-400"
                      : health >= 60
                        ? "bg-yellow-500/10 text-yellow-400"
                        : "bg-red-500/10 text-red-400";
                  return (
                    <tr
                      key={loc}
                      className="border-b border-zinc-800/50 last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-3 text-white font-medium">{loc}</td>
                      <td className="py-3 text-right text-zinc-300">
                        {data.count}
                      </td>
                      <td className="py-3 text-right text-zinc-300">
                        {formatCurrencyK(data.value)}
                      </td>
                      <td className="py-3 text-right text-red-400">
                        {data.overdue}
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${healthColor}`}
                        >
                          {health}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-zinc-600">
        Data synced from HubSpot &bull; Auto-refreshes every 5 minutes
      </div>
    </DashboardShell>
  );
}
