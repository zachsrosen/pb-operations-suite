"use client";

import { useMemo, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { LiveIndicator } from "@/components/ui/LiveIndicator";
import { MetricCard } from "@/components/ui/MetricCard";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { transformProject } from "@/lib/transforms";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { STAGE_ORDER_ASC, STAGE_COLORS, LOCATION_COLOR_CLASSES } from "@/lib/constants";
import type { RawProject, TransformedProject, StageData } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Local types                                                        */
/* ------------------------------------------------------------------ */

interface LocationData {
  count: number;
  value: number;
  overdue: number;
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
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function HorizontalBarChart({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number; color: string }[];
}) {
  const maxValue = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5">
      <h3 className="text-sm font-semibold text-foreground/80 mb-4">{title}</h3>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted truncate mr-2" title={item.label}>{item.label}</span>
              <span className="text-foreground/80 font-medium shrink-0">{item.value}</span>
            </div>
            <div className="h-3 bg-surface-2 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${item.color} transition-all duration-500`}
                style={{ width: `${maxValue > 0 ? (item.value / maxValue) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ValueDistributionChart({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number; color: string }[];
}) {
  const total = items.reduce((s, i) => s + i.value, 0);

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5">
      <h3 className="text-sm font-semibold text-foreground/80 mb-4">{title}</h3>
      <div className="h-5 rounded-full overflow-hidden flex bg-surface-2 mb-5">
        {items.map((item) => {
          const pct = total > 0 ? (item.value / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={item.label}
              className={`${item.color} transition-all duration-500`}
              style={{ width: `${pct}%` }}
              title={`${item.label}: ${formatCurrencyCompact(item.value)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const pct = total > 0 ? (item.value / total) * 100 : 0;
          return (
            <div key={item.label} className="flex items-center gap-2 text-xs">
              <span className={`w-3 h-3 rounded-sm shrink-0 ${item.color}`} />
              <span className="text-muted truncate">{item.label}</span>
              <span className="text-muted ml-auto shrink-0">
                {formatCurrencyCompact(item.value)} ({pct.toFixed(0)}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineChart({
  title,
  items,
}: {
  title: string;
  items: { label: string; count: number; value: number }[];
}) {
  const maxCount = Math.max(...items.map((i) => i.count), 1);

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5">
      <h3 className="text-sm font-semibold text-foreground/80 mb-4">{title}</h3>
      {items.length === 0 ? (
        <p className="text-muted text-sm">No forecast data available</p>
      ) : (
        <div className="flex items-end gap-2 h-40">
          {items.map((item) => {
            const heightPct = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
            return (
              <div key={item.label} className="flex-1 flex flex-col items-center justify-end h-full">
                <span className="text-xs text-foreground/80 font-medium mb-1">{item.count}</span>
                <div
                  className="w-full bg-emerald-500/80 rounded-t transition-all duration-500"
                  style={{ height: `${heightPct}%`, minHeight: item.count > 0 ? "4px" : "0px" }}
                />
                <span className="text-[10px] text-muted mt-2 text-center leading-tight">{item.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stage order for the executive view                                 */
/* ------------------------------------------------------------------ */

const EXEC_STAGE_ORDER = STAGE_ORDER_ASC.filter(
  (s) => s !== "Close Out" && s !== "Project Rejected - Needs Review"
);

/* ------------------------------------------------------------------ */
/*  Main Page Component                                                */
/* ------------------------------------------------------------------ */

export default function ExecutiveSummaryPage() {
  const { data: projectData, loading, error, lastUpdated, refetch } = useProjectData<TransformedProject[]>({
    params: { context: "executive" },
    transform: (res: unknown) => ((res as { projects: RawProject[] }).projects || []).map(transformProject),
  });

  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const allProjects = useMemo(() => projectData || [], [projectData]);

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("executive", {});
    }
  }, [loading, trackDashboardView]);

  // Compute metrics
  const metrics: Metrics | null = useMemo(() => {
    if (allProjects.length === 0) return null;

    const totalValue = allProjects.reduce((sum, p) => sum + (p.amount || 0), 0);

    const overdueInstall = allProjects.filter(
      (p) => !p.construction_complete && p.days_to_install !== null && p.days_to_install < 0
    );
    const overdueInspection = allProjects.filter(
      (p) => !p.inspection_pass && p.days_to_inspection !== null && p.days_to_inspection < 0
    );
    const overduePto = allProjects.filter(
      (p) => !p.pto_granted && p.days_to_pto !== null && p.days_to_pto < 0
    );
    const onTrack = allProjects.filter(
      (p) => !p.pto_granted && p.days_to_pto !== null && p.days_to_pto >= 0 && p.days_to_pto <= 30
    );

    const byLocation: Record<string, LocationData> = {};
    allProjects.forEach((p) => {
      const loc = p.pb_location || "Unknown";
      if (!byLocation[loc]) byLocation[loc] = { count: 0, value: 0, overdue: 0 };
      byLocation[loc].count++;
      byLocation[loc].value += p.amount || 0;
      if (!p.pto_granted && p.days_to_pto !== null && p.days_to_pto < 0) byLocation[loc].overdue++;
    });

    const byStage: Record<string, StageData> = {};
    EXEC_STAGE_ORDER.forEach((s) => (byStage[s] = { count: 0, value: 0 }));
    allProjects.forEach((p) => {
      if (byStage[p.stage]) {
        byStage[p.stage].count++;
        byStage[p.stage].value += p.amount || 0;
      }
    });

    const byMonth: Record<string, MonthData> = {};
    allProjects.forEach((p) => {
      if (p.forecast_pto) {
        const month = p.forecast_pto.substring(0, 7);
        if (!byMonth[month]) byMonth[month] = { count: 0, value: 0 };
        byMonth[month].count++;
        byMonth[month].value += p.amount || 0;
      }
    });

    return {
      total: allProjects.length,
      totalValue,
      overdueInstall: overdueInstall.length,
      overdueInstallValue: overdueInstall.reduce((s, p) => s + (p.amount || 0), 0),
      overdueInspection: overdueInspection.length,
      overduePto: overduePto.length,
      overduePtoValue: overduePto.reduce((s, p) => s + (p.amount || 0), 0),
      onTrack: onTrack.length,
      byLocation,
      byStage,
      byMonth,
    };
  }, [allProjects]);

  // Derived chart data
  const stageChartItems = useMemo(() => {
    if (!metrics) return [];
    return EXEC_STAGE_ORDER.map((s) => ({
      label: s,
      value: metrics.byStage[s]?.count ?? 0,
      color: STAGE_COLORS[s]?.tw || "bg-zinc-500",
    }));
  }, [metrics]);

  const locationChartItems = useMemo(() => {
    if (!metrics) return [];
    return Object.entries(metrics.byLocation)
      .sort((a, b) => b[1].value - a[1].value)
      .map(([loc, data], i) => ({
        label: loc,
        value: data.value,
        color: LOCATION_COLOR_CLASSES[i % LOCATION_COLOR_CLASSES.length],
      }));
  }, [metrics]);

  const timelineItems = useMemo(() => {
    if (!metrics) return [];
    return Object.keys(metrics.byMonth)
      .sort()
      .map((m) => {
        const [y, mo] = m.split("-");
        const label = new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        });
        return { label, count: metrics.byMonth[m].count, value: metrics.byMonth[m].value };
      });
  }, [metrics]);

  // Export data
  const exportData = useMemo(() => {
    return allProjects.map((p) => ({
      name: p.name.split("|")[0].trim(),
      location: p.pb_location,
      stage: p.stage,
      amount: p.amount,
      forecastInstall: p.forecast_install || "",
      forecastInspection: p.forecast_inspection || "",
      forecastPto: p.forecast_pto || "",
      daysToInstall: p.days_to_install ?? "",
      daysToInspection: p.days_to_inspection ?? "",
      daysToPto: p.days_to_pto ?? "",
    }));
  }, [allProjects]);

  // Loading state
  if (loading) {
    return (
      <DashboardShell title="Executive Summary" subtitle="Pipeline Overview" accentColor="orange">
        <LoadingSpinner color="orange" message="Loading pipeline data..." />
      </DashboardShell>
    );
  }

  // Error state
  if (error) {
    return (
      <DashboardShell title="Executive Summary" subtitle="Pipeline Overview" accentColor="orange">
        <ErrorState message={error} onRetry={() => window.location.reload()} color="orange" />
      </DashboardShell>
    );
  }

  if (!metrics) return null;

  // Render
  return (
    <DashboardShell
      title="Executive Summary"
      subtitle={`Photon Brothers \u2022 ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`}
      accentColor="orange"
      lastUpdated={lastUpdated}
      breadcrumbs={[{ label: "Dashboards", href: "/" }, { label: "Executive Summary" }]}
      exportData={{ data: exportData, filename: "executive-summary" }}
      headerRight={
        <div className="flex items-center gap-3">
          <LiveIndicator label="Auto-Refresh" />
          <button
            onClick={refetch}
            className="bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-lg text-sm font-medium text-foreground transition-colors"
          >
            Refresh
          </button>
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
          subColor="text-muted"
        />
        <MetricCard
          label="PTO Overdue"
          value={String(metrics.overduePto)}
          sub={`${formatCurrencyCompact(metrics.overduePtoValue)} at risk`}
          border="border-l-4 !border-l-red-500"
          valueColor="text-red-400"
          subColor="text-red-400/60"
        />
        <MetricCard
          label="Install Overdue"
          value={String(metrics.overdueInstall)}
          sub={`${formatCurrencyCompact(metrics.overdueInstallValue)} delayed`}
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
        <ValueDistributionChart title="Pipeline Value by Location" items={locationChartItems} />
      </div>

      {/* PTO Timeline */}
      <div className="mb-6">
        <TimelineChart title="Forecasted PTO Timeline" items={timelineItems} />
      </div>

      {/* Location Performance Table */}
      <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
        <h3 className="text-sm font-semibold text-foreground/80 mb-4">Location Performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-t-border">
                <th className="text-left py-3 text-muted font-medium">Location</th>
                <th className="text-right py-3 text-muted font-medium">Projects</th>
                <th className="text-right py-3 text-muted font-medium">Value</th>
                <th className="text-right py-3 text-muted font-medium">Overdue</th>
                <th className="text-right py-3 text-muted font-medium">Health</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(metrics.byLocation)
                .sort((a, b) => b[1].value - a[1].value)
                .map(([loc, data]) => {
                  const health = data.count > 0 ? Math.round((1 - data.overdue / data.count) * 100) : 100;
                  const healthColor =
                    health >= 80
                      ? "bg-emerald-500/10 text-emerald-400"
                      : health >= 60
                        ? "bg-yellow-500/10 text-yellow-400"
                        : "bg-red-500/10 text-red-400";
                  return (
                    <tr key={loc} className="border-b border-t-border/50 last:border-0 hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 text-white font-medium">{loc}</td>
                      <td className="py-3 text-right text-foreground/80">{data.count}</td>
                      <td className="py-3 text-right text-foreground/80">{formatCurrencyCompact(data.value)}</td>
                      <td className="py-3 text-right text-red-400">{data.overdue}</td>
                      <td className="py-3 text-right">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${healthColor}`}>{health}%</span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-muted/70">
        Data synced from HubSpot &bull; Auto-refreshes every 5 minutes
      </div>
    </DashboardShell>
  );
}
