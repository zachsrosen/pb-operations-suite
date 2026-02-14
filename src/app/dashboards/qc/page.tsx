"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ── Time metric display configuration ──
const METRIC_COLUMNS = [
  { key: "avg_siteSurveyTurnaroundTime", label: "Site Survey", shortLabel: "Survey", thresholds: [5, 10, 20] },
  { key: "avg_timeDAReadyToSent", label: "DA Ready→Sent", shortLabel: "DA R→S", thresholds: [3, 7, 14] },
  { key: "avg_daTurnaroundTime", label: "DA Turnaround", shortLabel: "DA Turn", thresholds: [5, 10, 20] },
  { key: "avg_timeToSubmitPermit", label: "Permit Submit", shortLabel: "Perm Sub", thresholds: [10, 20, 40] },
  { key: "avg_timeToSubmitInterconnection", label: "IC Submit", shortLabel: "IC Sub", thresholds: [10, 20, 40] },
  { key: "avg_daToRtb", label: "DA→RTB", shortLabel: "DA→RTB", thresholds: [30, 60, 90] },
  { key: "avg_constructionTurnaroundTime", label: "Construction", shortLabel: "Constr", thresholds: [5, 14, 30] },
  { key: "avg_timeCcToPto", label: "CC→PTO", shortLabel: "CC→PTO", thresholds: [20, 40, 60] },
] as const;

const DETAIL_METRICS = [
  { key: "avg_timeToDa", label: "Sale→DA" },
  { key: "avg_timeToRtb", label: "Sale→RTB" },
  { key: "avg_timeToCc", label: "Sale→CC" },
  { key: "avg_timeToPto", label: "Sale→PTO" },
  { key: "avg_designTurnaroundTime", label: "Design Turnaround" },
  { key: "avg_permitTurnaroundTime", label: "Permit Turnaround" },
  { key: "avg_interconnectionTurnaroundTime", label: "IC Turnaround" },
  { key: "avg_timeRtbToConstructionSchedule", label: "RTB→Constr Schedule" },
  { key: "avg_timeRtbToCc", label: "RTB→CC" },
  { key: "avg_daToCc", label: "DA→CC" },
  { key: "avg_daToPermit", label: "DA→Permit" },
  { key: "avg_projectTurnaroundTime", label: "Project Turnaround" },
] as const;

// Color-code cell by threshold: green < t[0], yellow < t[1], orange < t[2], red >= t[2]
function getCellColor(value: number | null | undefined, thresholds: readonly number[]): string {
  if (value === null || value === undefined) return "text-muted";
  if (value <= thresholds[0]) return "text-emerald-400";
  if (value <= thresholds[1]) return "text-yellow-400";
  if (value <= thresholds[2]) return "text-orange-400";
  return "text-red-400";
}

function getCellBg(value: number | null | undefined, thresholds: readonly number[]): string {
  if (value === null || value === undefined) return "";
  if (value <= thresholds[0]) return "bg-emerald-500/10";
  if (value <= thresholds[1]) return "bg-yellow-500/10";
  if (value <= thresholds[2]) return "bg-orange-500/10";
  return "bg-red-500/10";
}

interface MetricAverages {
  count: number;
  [key: string]: number | null;
}

interface QCData {
  byLocation: Record<string, MetricAverages>;
  byUtility: Record<string, MetricAverages>;
  totals: MetricAverages;
  daysWindow: number | string;
  lastUpdated: string;
}

const DAYS_OPTIONS = [
  { label: "60 Days", value: 60 },
  { label: "90 Days", value: 90 },
  { label: "180 Days", value: 180 },
  { label: "365 Days", value: 365 },
  { label: "All Time", value: 0 },
];

const LOCATIONS = ["Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"];

export default function QCDashboardPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const [data, setData] = useState<QCData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [daysWindow, setDaysWindow] = useState(60);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [showDetailMetrics, setShowDetailMetrics] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const url = daysWindow > 0
        ? `/api/hubspot/qc-metrics?days=${daysWindow}`
        : "/api/hubspot/qc-metrics";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch QC metrics");
      const json = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [daysWindow]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    if (!loading && data && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("qc-metrics", { projectCount: data.totals.count });
    }
  }, [loading, data, trackDashboardView]);

  // Filter locations for display
  const displayLocations = useMemo(() => {
    if (!data) return [];
    const locs = Object.keys(data.byLocation).sort();
    if (filterLocations.length > 0) {
      return locs.filter((l) => filterLocations.includes(l));
    }
    return locs;
  }, [data, filterLocations]);

  // Sorted utilities by IC turnaround (descending)
  const sortedUtilities = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.byUtility)
      .filter(([, v]) => (v.count_avg_interconnectionTurnaroundTime as number) > 0)
      .sort((a, b) => {
        const aVal = (a[1].avg_interconnectionTurnaroundTime as number) || 0;
        const bVal = (b[1].avg_interconnectionTurnaroundTime as number) || 0;
        return bVal - aVal;
      });
  }, [data]);

  // Build export data for CSV
  const exportData = useMemo(() => {
    if (!data) return [];
    return displayLocations.map((loc) => {
      const row: Record<string, string | number> = { Location: loc, Count: data.byLocation[loc].count };
      for (const col of METRIC_COLUMNS) {
        const val = data.byLocation[loc][col.key];
        row[col.label] = val !== null && val !== undefined ? val : "--";
      }
      return row;
    });
  }, [data, displayLocations]);

  const fmt = (v: number | null | undefined) => {
    if (v === null || v === undefined) return "--";
    return v.toFixed(1);
  };

  if (loading) {
    return (
      <DashboardShell title="QC Metrics" accentColor="blue">
        <div className="grid grid-cols-1 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 bg-skeleton rounded-xl animate-pulse" />
          ))}
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="QC Metrics" accentColor="blue">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 font-medium">{error}</p>
          <button onClick={fetchData} className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-300 text-sm transition-colors">
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  if (!data) return null;

  return (
    <DashboardShell
      title="QC Metrics"
      accentColor="blue"
      lastUpdated={data.lastUpdated}
      exportData={{ data: exportData, filename: `qc-metrics-${daysWindow || "all"}.csv` }}
      fullWidth
    >
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Days Window */}
        <div className="flex items-center gap-1 bg-surface border border-t-border rounded-lg p-1">
          {DAYS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDaysWindow(opt.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                daysWindow === opt.value
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "text-muted hover:text-foreground hover:bg-surface-2"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Location Filter */}
        <div className="flex items-center gap-1 bg-surface border border-t-border rounded-lg p-1">
          <button
            onClick={() => setFilterLocations([])}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filterLocations.length === 0
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "text-muted hover:text-foreground hover:bg-surface-2"
            }`}
          >
            All Offices
          </button>
          {LOCATIONS.map((loc) => (
            <button
              key={loc}
              onClick={() => {
                setFilterLocations((prev) =>
                  prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
                );
              }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                filterLocations.includes(loc)
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "text-muted hover:text-foreground hover:bg-surface-2"
              }`}
            >
              {loc.replace("Colorado Springs", "CO Springs").replace("San Luis Obispo", "SLO")}
            </button>
          ))}
        </div>

        <div className="ml-auto text-sm text-muted">
          {data.totals.count.toLocaleString()} projects &middot; {daysWindow > 0 ? `Last ${daysWindow} days` : "All time"}
        </div>
      </div>

      {/* ── Section 1: Average Times Summary Table ── */}
      <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-t-border">
          <h2 className="text-lg font-semibold text-foreground">Average Times by Office</h2>
          <p className="text-sm text-muted mt-0.5">Days between project milestones, averaged per office location</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-t-border bg-surface-2/50">
                <th className="text-left px-4 py-3 font-semibold text-foreground sticky left-0 bg-surface-2/50 z-10 min-w-[140px]">Location</th>
                <th className="text-center px-3 py-3 font-semibold text-foreground min-w-[70px]">Count</th>
                {METRIC_COLUMNS.map((col) => (
                  <th key={col.key} className="text-center px-3 py-3 font-semibold text-foreground min-w-[90px]" title={col.label}>
                    {col.shortLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayLocations.map((loc, i) => {
                const row = data.byLocation[loc];
                return (
                  <tr key={loc} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-4 py-3 font-medium text-foreground sticky left-0 bg-inherit z-10">{loc}</td>
                    <td className="text-center px-3 py-3 text-muted">{row.count.toLocaleString()}</td>
                    {METRIC_COLUMNS.map((col) => {
                      const val = row[col.key] as number | null;
                      return (
                        <td key={col.key} className={`text-center px-3 py-3 font-mono font-medium ${getCellColor(val, col.thresholds)} ${getCellBg(val, col.thresholds)}`}>
                          {fmt(val)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr className="border-t-2 border-t-border bg-surface-2/40 font-semibold">
                <td className="px-4 py-3 text-foreground sticky left-0 bg-surface-2/40 z-10">Report Total</td>
                <td className="text-center px-3 py-3 text-foreground">{data.totals.count.toLocaleString()}</td>
                {METRIC_COLUMNS.map((col) => {
                  const val = data.totals[col.key] as number | null;
                  return (
                    <td key={col.key} className={`text-center px-3 py-3 font-mono ${getCellColor(val, col.thresholds)}`}>
                      {fmt(val)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 2: Detail Time Metric Cards ── */}
      <div className="mb-8">
        <button
          onClick={() => setShowDetailMetrics(!showDetailMetrics)}
          className="flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground transition-colors mb-4"
        >
          <span className={`transition-transform ${showDetailMetrics ? "rotate-90" : ""}`}>&#9654;</span>
          {showDetailMetrics ? "Hide" : "Show"} Additional Metrics ({DETAIL_METRICS.length})
        </button>

        {showDetailMetrics && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 stagger-grid">
            {DETAIL_METRICS.map((metric) => (
              <div key={metric.key} className="bg-surface border border-t-border rounded-xl p-4">
                <p className="text-xs text-muted mb-2 truncate" title={metric.label}>{metric.label}</p>
                <div className="space-y-1.5">
                  {displayLocations.map((loc) => {
                    const val = data.byLocation[loc]?.[metric.key] as number | null;
                    return (
                      <div key={loc} className="flex items-center justify-between">
                        <span className="text-xs text-muted truncate mr-2">
                          {loc.replace("Colorado Springs", "CO Spr").replace("San Luis Obispo", "SLO").replace("Westminster", "West").replace("Centennial", "Cent").replace("Camarillo", "Cam")}
                        </span>
                        <span className="text-sm font-mono font-medium text-foreground">{fmt(val)}</span>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between border-t border-t-border/50 pt-1.5">
                    <span className="text-xs font-semibold text-muted">Total</span>
                    <span className="text-sm font-mono font-semibold text-blue-400">{fmt(data.totals[metric.key] as number | null)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 3: Interconnection by Utility ── */}
      <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-t-border">
          <h2 className="text-lg font-semibold text-foreground">Interconnection Turnaround by Utility</h2>
          <p className="text-sm text-muted mt-0.5">Average interconnection processing time per utility company</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-t-border bg-surface-2/50">
                <th className="text-left px-4 py-3 font-semibold text-foreground">Utility</th>
                <th className="text-center px-3 py-3 font-semibold text-foreground">Projects</th>
                <th className="text-center px-3 py-3 font-semibold text-foreground">Avg IC Turnaround</th>
                <th className="text-center px-3 py-3 font-semibold text-foreground">Avg Permit Turnaround</th>
                <th className="text-center px-3 py-3 font-semibold text-foreground">Avg DA→RTB</th>
              </tr>
            </thead>
            <tbody>
              {sortedUtilities.map(([utility, metrics], i) => (
                <tr key={utility} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                  <td className="px-4 py-3 font-medium text-foreground">{utility}</td>
                  <td className="text-center px-3 py-3 text-muted">{metrics.count.toLocaleString()}</td>
                  <td className={`text-center px-3 py-3 font-mono font-medium ${getCellColor(metrics.avg_interconnectionTurnaroundTime as number | null, [20, 40, 80])}`}>
                    {fmt(metrics.avg_interconnectionTurnaroundTime as number | null)}
                  </td>
                  <td className={`text-center px-3 py-3 font-mono font-medium ${getCellColor(metrics.avg_permitTurnaroundTime as number | null, [20, 40, 80])}`}>
                    {fmt(metrics.avg_permitTurnaroundTime as number | null)}
                  </td>
                  <td className={`text-center px-3 py-3 font-mono font-medium ${getCellColor(metrics.avg_daToRtb as number | null, [30, 60, 90])}`}>
                    {fmt(metrics.avg_daToRtb as number | null)}
                  </td>
                </tr>
              ))}
              {sortedUtilities.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">No interconnection data available for selected filters</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 4: Per-Location Metric Cards ── */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Time Metrics by Location</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-grid">
          {displayLocations.map((loc) => {
            const row = data.byLocation[loc];
            return (
              <div key={loc} className="bg-surface border border-t-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-foreground">{loc}</h3>
                  <span className="text-xs text-muted bg-surface-2 px-2 py-0.5 rounded">{row.count.toLocaleString()} projects</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {METRIC_COLUMNS.map((col) => {
                    const val = row[col.key] as number | null;
                    const totalVal = data.totals[col.key] as number | null;
                    const diff = val !== null && totalVal !== null ? val - totalVal : null;
                    return (
                      <div key={col.key}>
                        <p className="text-xs text-muted mb-0.5">{col.label}</p>
                        <div className="flex items-baseline gap-1.5">
                          <span className={`text-lg font-mono font-semibold ${getCellColor(val, col.thresholds)}`}>
                            {fmt(val)}
                          </span>
                          {diff !== null && (
                            <span className={`text-xs ${diff > 0 ? "text-red-400" : diff < 0 ? "text-emerald-400" : "text-muted"}`}>
                              {diff > 0 ? "+" : ""}{diff.toFixed(1)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardShell>
  );
}
