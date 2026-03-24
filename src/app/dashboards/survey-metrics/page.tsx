"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { queryKeys } from "@/lib/query-keys";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ── Thresholds ──
const THRESHOLDS = [3, 7, 14] as const;

function getCellColor(value: number | null | undefined): string {
  if (value === null || value === undefined) return "text-muted";
  if (value <= THRESHOLDS[0]) return "text-emerald-400";
  if (value <= THRESHOLDS[1]) return "text-yellow-400";
  if (value <= THRESHOLDS[2]) return "text-orange-400";
  return "text-red-400";
}

function getCellBg(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value <= THRESHOLDS[0]) return "bg-emerald-500/10";
  if (value <= THRESHOLDS[1]) return "bg-yellow-500/10";
  if (value <= THRESHOLDS[2]) return "bg-orange-500/10";
  return "bg-red-500/10";
}

function formatMoney(v: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

const ZUPER_BASE_URL = "https://web.zuperpro.com";

// ── Sortable column header ──
type SortDir = "asc" | "desc";

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  className = "",
  title,
}: {
  label: string;
  sortKey: string;
  currentKey: string | null;
  currentDir: SortDir;
  onSort: (key: string) => void;
  className?: string;
  title?: string;
}) {
  const active = currentKey === sortKey;
  return (
    <th
      className={`px-4 py-3 font-semibold text-foreground cursor-pointer select-none hover:text-emerald-300 transition-colors ${className}`}
      onClick={() => onSort(sortKey)}
      title={title}
    >
      {label}
      <span className="ml-1 text-xs">
        {active ? (currentDir === "asc" ? "▲" : "▼") : "⇅"}
      </span>
    </th>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortRows<T extends Record<string, any>>(rows: T[], key: string | null, dir: SortDir): T[] {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === "number" && typeof bv === "number") return dir === "asc" ? av - bv : bv - av;
    return dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}

function useSort(defaultKey: string | null = null, defaultDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);
  const toggle = useCallback((key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }, [sortKey]);
  return { sortKey, sortDir, toggle };
}

// ── Types ──
interface DealDetail {
  dealId: string;
  projectNumber: string;
  name: string;
  url: string;
  pbLocation: string;
  surveyor: string;
  stage: string;
  amount: number;
  siteSurveyScheduleDate: string | null;
  siteSurveyCompletionDate: string | null;
  turnaroundDays: number | null;
  zuperJobUid: string | null;
}

interface GroupData {
  count: number;
  avg: number | null;
  deals?: DealDetail[];
}

interface AwaitingSurveyProject {
  dealId: string;
  projectNumber: string;
  name: string;
  url: string;
  pbLocation: string;
  surveyor: string;
  stage: string;
  amount: number;
  siteSurveyScheduleDate: string;
  daysUntil: number;
  zuperJobUid: string | null;
}

interface SurveyMetricsData {
  byLocation: Record<string, GroupData>;
  bySurveyor: Record<string, GroupData>;
  totals: GroupData;
  upcomingSurveys: AwaitingSurveyProject[];
  pastDueSurveys: AwaitingSurveyProject[];
  daysWindow: number | string;
  lastUpdated: string;
}

const DAYS_OPTIONS = [
  { label: "30 Days", value: 30 },
  { label: "60 Days", value: 60 },
  { label: "90 Days", value: 90 },
  { label: "180 Days", value: 180 },
  { label: "All Time", value: 0 },
];

const LOCATIONS = ["Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"];

export default function SurveyMetricsDashboardPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);
  const drillDownRef = useRef<HTMLDivElement>(null);

  const [daysWindow, setDaysWindow] = useState(60);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [drillDown, setDrillDown] = useState<{
    groupKey: string;
    groupType: "location" | "surveyor";
  } | null>(null);

  // Sort states
  const drillSort = useSort("turnaroundDays", "desc");

  const query = useQuery({
    queryKey: queryKeys.stats.surveyMetrics(daysWindow),
    queryFn: async () => {
      const url =
        daysWindow > 0
          ? `/api/hubspot/survey-metrics?days=${daysWindow}`
          : "/api/hubspot/survey-metrics";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch survey metrics");
      return res.json() as Promise<SurveyMetricsData>;
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const data: SurveyMetricsData | null = query.data ?? null;
  const loading = query.isLoading;
  const error = query.error ? (query.error as Error).message : null;

  useEffect(() => {
    if (!loading && data && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("survey-metrics", { projectCount: data.totals.count });
    }
  }, [loading, data, trackDashboardView]);

  // Auto-scroll to drill-down when it opens
  useEffect(() => {
    if (drillDown && drillDownRef.current) {
      drillDownRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [drillDown]);

  const displayLocations = useMemo(() => {
    if (!data) return [];
    const locs = Object.keys(data.byLocation).sort();
    if (filterLocations.length > 0) return locs.filter((l) => filterLocations.includes(l));
    return locs;
  }, [data, filterLocations]);

  const displaySurveyors = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.bySurveyor)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name]) => name);
  }, [data]);

  const exportData = useMemo(() => {
    if (!data) return [];
    const rows: Record<string, string | number>[] = [];
    for (const loc of displayLocations) {
      const d = data.byLocation[loc];
      rows.push({ Group: loc, Type: "Location", Count: d.count, "Avg Turnaround (days)": d.avg ?? "--" });
    }
    for (const name of displaySurveyors) {
      const d = data.bySurveyor[name];
      rows.push({ Group: name, Type: "Surveyor", Count: d.count, "Avg Turnaround (days)": d.avg ?? "--" });
    }
    return rows;
  }, [data, displayLocations, displaySurveyors]);

  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "--" : v.toFixed(1));

  if (loading) {
    return (
      <DashboardShell title="Site Survey Metrics" accentColor="green">
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
      <DashboardShell title="Site Survey Metrics" accentColor="green">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 font-medium">{error}</p>
          <button onClick={() => query.refetch()} className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-300 text-sm transition-colors">
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  if (!data) return null;

  // Drill-down data
  const drillDownData = drillDown
    ? drillDown.groupType === "location"
      ? data.byLocation[drillDown.groupKey]
      : data.bySurveyor[drillDown.groupKey]
    : null;
  const drillDownDeals = sortRows(
    drillDownData?.deals?.filter((d) => d.turnaroundDays !== null) ?? [],
    drillSort.sortKey,
    drillSort.sortDir
  );

  // Drill-down panel JSX (rendered inline after the relevant table)
  const drillDownPanel = drillDown && drillDownDeals.length > 0 ? (
    <div ref={drillDownRef} className="bg-surface border border-emerald-500/30 rounded-xl overflow-hidden mb-8 animate-value-flash">
      <div className="px-5 py-4 border-b border-t-border flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {drillDown.groupKey} — Survey Turnaround
          </h2>
          <p className="text-sm text-muted mt-0.5">
            {drillDownDeals.length} deals with data &middot; avg {fmt(drillDownData?.avg)} days
          </p>
        </div>
        <button onClick={() => setDrillDown(null)} className="text-muted hover:text-foreground text-xl px-2">✕</button>
      </div>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-t-border bg-surface-2/80 backdrop-blur-sm">
              <SortHeader label="Project" sortKey="projectNumber" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-left" />
              <SortHeader label="Customer" sortKey="name" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-left" />
              {drillDown.groupType === "surveyor" && (
                <SortHeader label="Location" sortKey="pbLocation" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-left" />
              )}
              {drillDown.groupType === "location" && (
                <SortHeader label="Surveyor" sortKey="surveyor" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-left" />
              )}
              <SortHeader label="Stage" sortKey="stage" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-left" />
              <SortHeader label="Amount" sortKey="amount" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-right" />
              <SortHeader label="Scheduled" sortKey="siteSurveyScheduleDate" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-center" />
              <SortHeader label="Completed" sortKey="siteSurveyCompletionDate" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-center" />
              <SortHeader label="Turnaround" sortKey="turnaroundDays" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-center" />
              <th className="text-center px-4 py-2.5 font-semibold text-foreground">Links</th>
            </tr>
          </thead>
          <tbody>
            {drillDownDeals.map((d, i) => (
              <tr key={d.dealId} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                <td className="px-4 py-2.5 font-mono text-foreground">{d.projectNumber}</td>
                <td className="px-4 py-2.5 text-foreground truncate max-w-[200px]">{d.name}</td>
                {drillDown.groupType === "surveyor" && <td className="px-4 py-2.5 text-muted">{d.pbLocation}</td>}
                {drillDown.groupType === "location" && <td className="px-4 py-2.5 text-muted">{d.surveyor}</td>}
                <td className="px-4 py-2.5 text-muted">{d.stage}</td>
                <td className="px-4 py-2.5 text-right text-muted">{formatMoney(d.amount)}</td>
                <td className="text-center px-4 py-2.5 text-muted">{d.siteSurveyScheduleDate || "--"}</td>
                <td className="text-center px-4 py-2.5 text-muted">{d.siteSurveyCompletionDate || "--"}</td>
                <td className={`text-center px-4 py-2.5 font-mono font-medium ${getCellColor(d.turnaroundDays)}`}>
                  {fmt(d.turnaroundDays)}
                </td>
                <td className="text-center px-4 py-2.5">
                  <div className="flex items-center justify-center gap-2">
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 underline text-xs">HubSpot ↗</a>
                    {d.zuperJobUid && (
                      <a href={`${ZUPER_BASE_URL}/jobs/${d.zuperJobUid}/details`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline text-xs">Zuper ↗</a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ) : null;

  return (
    <DashboardShell
      title="Site Survey Metrics"
      accentColor="green"
      lastUpdated={data.lastUpdated}
      exportData={{ data: exportData, filename: `survey-metrics-${daysWindow || "all"}.csv` }}
      fullWidth
    >
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-1 bg-surface border border-t-border rounded-lg p-1">
          {DAYS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDaysWindow(opt.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                daysWindow === opt.value
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "text-muted hover:text-foreground hover:bg-surface-2"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-surface border border-t-border rounded-lg p-1">
          <button
            onClick={() => setFilterLocations([])}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filterLocations.length === 0
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "text-muted hover:text-foreground hover:bg-surface-2"
            }`}
          >
            All Offices
          </button>
          {LOCATIONS.map((loc) => (
            <button
              key={loc}
              onClick={() =>
                setFilterLocations((prev) =>
                  prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
                )
              }
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                filterLocations.includes(loc)
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "text-muted hover:text-foreground hover:bg-surface-2"
              }`}
            >
              {loc.replace("Colorado Springs", "CO Springs").replace("San Luis Obispo", "SLO")}
            </button>
          ))}
        </div>

        <div className="ml-auto text-sm text-muted">
          {data.totals.count.toLocaleString()} surveys &middot;{" "}
          {daysWindow > 0 ? `Completed in last ${daysWindow} days` : "All time"}
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface border border-emerald-500/30 rounded-xl p-5 text-center">
          <p className="text-sm text-muted mb-1">Avg Turnaround</p>
          <p className={`text-3xl font-mono font-bold ${getCellColor(data.totals.avg)}`}>
            {fmt(data.totals.avg)}
          </p>
          <p className="text-xs text-muted mt-1">days</p>
        </div>
        <div className="bg-surface border border-t-border rounded-xl p-5 text-center">
          <p className="text-sm text-muted mb-1">Surveys Completed</p>
          <p className="text-3xl font-mono font-bold text-foreground">
            {data.totals.count.toLocaleString()}
          </p>
          <p className="text-xs text-muted mt-1">
            {daysWindow > 0 ? `last ${daysWindow} days` : "all time"}
          </p>
        </div>
        <div className="bg-surface border border-t-border rounded-xl p-5 text-center">
          <p className="text-sm text-muted mb-1">Upcoming Surveys</p>
          <p className="text-3xl font-mono font-bold text-cyan-400">
            {data?.upcomingSurveys?.length ?? 0}
          </p>
          <p className="text-xs text-muted mt-1">scheduled ahead</p>
        </div>
        <div className="bg-surface border border-t-border rounded-xl p-5 text-center">
          <p className="text-sm text-muted mb-1">Past Due</p>
          <p className={`text-3xl font-mono font-bold ${(data?.pastDueSurveys?.length ?? 0) > 0 ? "text-red-400" : "text-emerald-400"}`}>
            {data?.pastDueSurveys?.length ?? 0}
          </p>
          <p className="text-xs text-muted mt-1">overdue surveys</p>
        </div>
      </div>

      {/* ── By Location Table ── */}
      <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-t-border">
          <h2 className="text-lg font-semibold text-foreground">Turnaround by Office</h2>
          <p className="text-sm text-muted mt-0.5">
            Average days from survey scheduled to survey completed &middot; Click turnaround cells to drill into deals
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-t-border bg-surface-2/50">
                <th className="text-left px-4 py-3 font-semibold text-foreground min-w-[160px]">Location</th>
                <th className="text-center px-4 py-3 font-semibold text-foreground min-w-[80px]">Count</th>
                <th className="text-center px-4 py-3 font-semibold text-foreground min-w-[120px]" title="Average days from survey scheduled date to survey completed date">Avg Turnaround</th>
              </tr>
            </thead>
            <tbody>
              {displayLocations.map((loc, i) => {
                const row = data.byLocation[loc];
                return (
                  <tr key={loc} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-4 py-3 font-medium text-foreground">{loc}</td>
                    <td className="text-center px-4 py-3 text-muted">{row.count.toLocaleString()}</td>
                    <td
                      className={`text-center px-4 py-3 font-mono font-medium cursor-pointer hover:ring-1 hover:ring-emerald-500/40 transition-shadow ${getCellColor(row.avg)} ${getCellBg(row.avg)}`}
                      onClick={() => row.avg !== null && setDrillDown({ groupKey: loc, groupType: "location" })}
                      title={row.avg !== null ? `Click to see survey deals for ${loc}` : undefined}
                    >
                      {fmt(row.avg)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-t-border bg-surface-2/40 font-semibold">
                <td className="px-4 py-3 text-foreground">Report Total</td>
                <td className="text-center px-4 py-3 text-foreground">{data.totals.count.toLocaleString()}</td>
                <td className={`text-center px-4 py-3 font-mono ${getCellColor(data.totals.avg)}`}>{fmt(data.totals.avg)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down after location table */}
      {drillDown?.groupType === "location" && drillDownPanel}

      {/* ── By Surveyor Table ── */}
      <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-t-border">
          <h2 className="text-lg font-semibold text-foreground">Turnaround by Surveyor</h2>
          <p className="text-sm text-muted mt-0.5">
            Per-surveyor performance &middot; Click turnaround cells to drill into deals
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-t-border bg-surface-2/50">
                <th className="text-left px-4 py-3 font-semibold text-foreground min-w-[160px]">Surveyor</th>
                <th className="text-center px-4 py-3 font-semibold text-foreground min-w-[80px]">Count</th>
                <th className="text-center px-4 py-3 font-semibold text-foreground min-w-[120px]" title="Average days from survey scheduled date to survey completed date">Avg Turnaround</th>
              </tr>
            </thead>
            <tbody>
              {displaySurveyors.map((name, i) => {
                const row = data.bySurveyor[name];
                return (
                  <tr key={name} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-4 py-3 font-medium text-foreground">{name}</td>
                    <td className="text-center px-4 py-3 text-muted">{row.count.toLocaleString()}</td>
                    <td
                      className={`text-center px-4 py-3 font-mono font-medium cursor-pointer hover:ring-1 hover:ring-emerald-500/40 transition-shadow ${getCellColor(row.avg)} ${getCellBg(row.avg)}`}
                      onClick={() => row.avg !== null && setDrillDown({ groupKey: name, groupType: "surveyor" })}
                      title={row.avg !== null ? `Click to see survey deals for ${name}` : undefined}
                    >
                      {fmt(row.avg)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-t-border bg-surface-2/40 font-semibold">
                <td className="px-4 py-3 text-foreground">Report Total</td>
                <td className="text-center px-4 py-3 text-foreground">{data.totals.count.toLocaleString()}</td>
                <td className={`text-center px-4 py-3 font-mono ${getCellColor(data.totals.avg)}`}>{fmt(data.totals.avg)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down after surveyor table */}
      {drillDown?.groupType === "surveyor" && drillDownPanel}
    </DashboardShell>
  );
}
