"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { queryKeys } from "@/lib/query-keys";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ── Construction-specific time metric display configuration ──
const METRIC_COLUMNS = [
  { key: "avg_timeRtbToConstructionSchedule", label: "RTB → Construction Start", shortLabel: "RTB→Const Start", tooltip: "Days from Ready to Build until construction schedule date", thresholds: [7, 14, 30] },
  { key: "avg_constructionTurnaroundTime", label: "Construction Duration", shortLabel: "Constr", tooltip: "Days from construction schedule date to construction complete date", thresholds: [7, 14, 30] },
  { key: "avg_timeRtbToCc", label: "RTB → CC", shortLabel: "RTB→CC", tooltip: "Days from Ready to Build to construction complete", thresholds: [14, 30, 60] },
  { key: "avg_timeCcToInspectionPass", label: "CC → Inspection Passed", shortLabel: "CC→Insp Pass", tooltip: "Days from construction complete to inspection passed", thresholds: [14, 30, 60] },
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

// Metric key without the avg_ prefix (matches TIME_METRICS in the API)
const METRIC_KEY_MAP: Record<string, string> = {
  avg_timeRtbToConstructionSchedule: "timeRtbToConstructionSchedule",
  avg_constructionTurnaroundTime: "constructionTurnaroundTime",
  avg_timeRtbToCc: "timeRtbToCc",
  avg_timeCcToInspectionPass: "timeCcToInspectionPass",
};

interface DealDetail {
  dealId: string;
  projectNumber: string;
  name: string;
  url: string;
  constructionScheduleDate: string | null;
  constructionCompleteDate: string | null;
  inspectionPassDate: string | null;
  zuperJobUid: string | null;
  metrics: Record<string, number | null>;
}

const ZUPER_BASE_URL = "https://web.zuperpro.com";

interface MetricAverages {
  count: number;
  deals?: DealDetail[];
  [key: string]: number | null | DealDetail[] | undefined;
}

interface InConstructionProject {
  projectNumber: string;
  name: string;
  pbLocation: string;
  constructionScheduleDate: string;
  daysInConstruction: number;
}

interface QCData {
  byLocation: Record<string, MetricAverages>;
  byUtility: Record<string, MetricAverages>;
  totals: MetricAverages;
  inConstruction: InConstructionProject[];
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

export default function ConstructionMetricsDashboardPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const [daysWindow, setDaysWindow] = useState(60);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [drillDown, setDrillDown] = useState<{ location: string; metricKey: string; metricLabel: string } | null>(null);

  const qcQuery = useQuery({
    queryKey: queryKeys.stats.qc(daysWindow),
    queryFn: async () => {
      const url = daysWindow > 0
        ? `/api/hubspot/qc-metrics?days=${daysWindow}`
        : "/api/hubspot/qc-metrics";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch construction metrics");
      return res.json() as Promise<QCData>;
    },
    refetchInterval: 15 * 60 * 1000,
  });
  const data: QCData | null = qcQuery.data ?? null;
  const loading = qcQuery.isLoading;
  const error = qcQuery.error ? (qcQuery.error as Error).message : null;

  useEffect(() => {
    if (!loading && data && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("construction-metrics", { projectCount: data.totals.count });
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

  // Build export data for CSV
  const exportData = useMemo(() => {
    if (!data) return [];
    return displayLocations.map((loc) => {
      const row: Record<string, string | number> = { Location: loc, Count: data.byLocation[loc].count };
      for (const col of METRIC_COLUMNS) {
        const val = data.byLocation[loc][col.key] as number | null | undefined;
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
      <DashboardShell title="Construction Completion Metrics" accentColor="orange">
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
      <DashboardShell title="Construction Completion Metrics" accentColor="orange">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 font-medium">{error}</p>
          <button onClick={() => qcQuery.refetch()} className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-300 text-sm transition-colors">
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  if (!data) return null;

  return (
    <DashboardShell
      title="Construction Completion Metrics"
      accentColor="orange"
      lastUpdated={data.lastUpdated}
      exportData={{ data: exportData, filename: `construction-metrics-${daysWindow || "all"}.csv` }}
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
                  ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
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
                ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
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
                  ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                  : "text-muted hover:text-foreground hover:bg-surface-2"
              }`}
            >
              {loc.replace("Colorado Springs", "CO Springs").replace("San Luis Obispo", "SLO")}
            </button>
          ))}
        </div>

        <div className="ml-auto text-sm text-muted">
          {data.totals.count.toLocaleString()} projects &middot; {daysWindow > 0 ? `CC date in last ${daysWindow} days` : "All time"}
        </div>
      </div>

      {/* ── Section 1: Average Times Summary Table ── */}
      <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-t-border">
          <h2 className="text-lg font-semibold text-foreground">Average Times by Office</h2>
          <p className="text-sm text-muted mt-0.5">Average days per milestone · Click any cell to drill into individual deals</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-t-border bg-surface-2/50">
                <th className="text-left px-4 py-3 font-semibold text-foreground sticky left-0 bg-surface-2/50 z-10 min-w-[140px]">Location</th>
                <th className="text-center px-3 py-3 font-semibold text-foreground min-w-[70px]">Count</th>
                {METRIC_COLUMNS.map((col) => (
                  <th key={col.key} className="text-center px-3 py-3 font-semibold text-foreground min-w-[90px]" title={col.tooltip}>
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
                        <td
                          key={col.key}
                          className={`text-center px-3 py-3 font-mono font-medium cursor-pointer hover:ring-1 hover:ring-orange-500/40 transition-shadow ${getCellColor(val, col.thresholds)} ${getCellBg(val, col.thresholds)}`}
                          onClick={() => val !== null && setDrillDown({ location: loc, metricKey: col.key, metricLabel: col.label })}
                          title={val !== null ? `Click to see ${col.label} deals for ${loc}` : undefined}
                        >
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

      {/* ── Drill-Down Panel ── */}
      {drillDown && data.byLocation[drillDown.location]?.deals && (() => {
        const rawKey = METRIC_KEY_MAP[drillDown.metricKey] || drillDown.metricKey.replace("avg_", "");
        const deals = (data.byLocation[drillDown.location].deals as DealDetail[])
          .filter((d) => d.metrics[rawKey] !== null)
          .sort((a, b) => (b.metrics[rawKey] ?? 0) - (a.metrics[rawKey] ?? 0));
        const col = METRIC_COLUMNS.find((c) => c.key === drillDown.metricKey);
        return (
          <div className="bg-surface border border-orange-500/30 rounded-xl overflow-hidden mb-8 animate-value-flash">
            <div className="px-5 py-4 border-b border-t-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{drillDown.location} — {drillDown.metricLabel}</h2>
                <p className="text-sm text-muted mt-0.5">{deals.length} deals with data · avg {fmt(data.byLocation[drillDown.location][drillDown.metricKey] as number | null)} days</p>
              </div>
              <button onClick={() => setDrillDown(null)} className="text-muted hover:text-foreground text-xl px-2">✕</button>
            </div>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-t-border bg-surface-2/80 backdrop-blur-sm">
                    <th className="text-left px-4 py-2.5 font-semibold text-foreground">Project</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-foreground">Customer</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-foreground">Sched Date</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-foreground">CC Date</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-foreground">{drillDown.metricLabel}</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-foreground">Links</th>
                  </tr>
                </thead>
                <tbody>
                  {deals.map((d, i) => {
                    const val = d.metrics[rawKey];
                    return (
                      <tr key={d.dealId} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                        <td className="px-4 py-2.5 font-mono text-foreground">{d.projectNumber}</td>
                        <td className="px-4 py-2.5 text-foreground truncate max-w-[200px]">{d.name}</td>
                        <td className="text-center px-4 py-2.5 text-muted">{d.constructionScheduleDate || "--"}</td>
                        <td className="text-center px-4 py-2.5 text-muted">{d.constructionCompleteDate || "--"}</td>
                        <td className={`text-center px-4 py-2.5 font-mono font-medium ${col ? getCellColor(val, col.thresholds) : "text-foreground"}`}>
                          {fmt(val)}
                        </td>
                        <td className="text-center px-4 py-2.5">
                          <div className="flex items-center justify-center gap-2">
                            <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300 underline text-xs">
                              HubSpot ↗
                            </a>
                            {d.zuperJobUid && (
                              <a href={`${ZUPER_BASE_URL}/jobs/${d.zuperJobUid}/details`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline text-xs">
                                Zuper ↗
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Section 2: Per-Location Metric Cards ── */}
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
          {/* All Locations summary card */}
          <div className="bg-surface border border-orange-500/30 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-orange-400">All Locations</h3>
              <span className="text-xs text-muted bg-surface-2 px-2 py-0.5 rounded">{data.totals.count.toLocaleString()} projects</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {METRIC_COLUMNS.map((col) => {
                const val = data.totals[col.key] as number | null;
                return (
                  <div key={col.key}>
                    <p className="text-xs text-muted mb-0.5">{col.label}</p>
                    <span className={`text-lg font-mono font-semibold ${getCellColor(val, col.thresholds)}`}>
                      {fmt(val)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 4: Jobs Currently In Construction ── */}
      {data.inConstruction && data.inConstruction.length > 0 && (
        <div className="mb-8">
          <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-t-border">
              <h2 className="text-lg font-semibold text-foreground">Currently In Construction</h2>
              <p className="text-sm text-muted mt-0.5">{data.inConstruction.length} jobs in construction — sorted by time since scheduled</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border bg-surface-2/50">
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Project</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Customer</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Location</th>
                    <th className="text-center px-4 py-3 font-semibold text-foreground">Scheduled</th>
                    <th className="text-center px-4 py-3 font-semibold text-foreground">Days In Construction</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inConstruction.map((p, i) => (
                    <tr key={p.projectNumber} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                      <td className="px-4 py-3 font-mono text-foreground">{p.projectNumber}</td>
                      <td className="px-4 py-3 text-foreground">{p.name}</td>
                      <td className="px-4 py-3 text-muted">{p.pbLocation}</td>
                      <td className="text-center px-4 py-3 text-muted">{p.constructionScheduleDate}</td>
                      <td className={`text-center px-4 py-3 font-mono font-medium ${
                        p.daysInConstruction < 0 ? "text-muted" :
                        p.daysInConstruction > 14 ? "text-red-400" :
                        p.daysInConstruction > 7 ? "text-orange-400" :
                        p.daysInConstruction > 3 ? "text-yellow-400" :
                        "text-emerald-400"
                      }`}>
                        {p.daysInConstruction < 0 ? `Starts in ${Math.abs(p.daysInConstruction)}d` : p.daysInConstruction}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
