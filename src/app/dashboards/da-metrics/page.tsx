"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { queryKeys } from "@/lib/query-keys";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ── Thresholds ──
const TURNAROUND_THRESHOLDS = [5, 10, 20] as const;
const REVISION_THRESHOLDS = [0.5, 1, 2] as const;

function getColor(value: number | null | undefined, thresholds: readonly number[]): string {
  if (value === null || value === undefined) return "text-muted";
  if (value <= thresholds[0]) return "text-emerald-400";
  if (value <= thresholds[1]) return "text-yellow-400";
  if (value <= thresholds[2]) return "text-orange-400";
  return "text-red-400";
}

function getBg(value: number | null | undefined, thresholds: readonly number[]): string {
  if (value === null || value === undefined) return "";
  if (value <= thresholds[0]) return "bg-emerald-500/10";
  if (value <= thresholds[1]) return "bg-yellow-500/10";
  if (value <= thresholds[2]) return "bg-orange-500/10";
  return "bg-red-500/10";
}

function getFirstTryColor(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "text-muted";
  if (rate >= 80) return "text-emerald-400";
  if (rate >= 60) return "text-yellow-400";
  if (rate >= 40) return "text-orange-400";
  return "text-red-400";
}

function getWaitingColor(days: number): string {
  if (days < 0) return "text-muted";
  if (days > 14) return "text-red-400";
  if (days > 7) return "text-orange-400";
  if (days > 3) return "text-yellow-400";
  return "text-emerald-400";
}

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
      className={`px-4 py-3 font-semibold text-foreground cursor-pointer select-none hover:text-purple-300 transition-colors ${className}`}
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

// ── Generic sorter ──
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

// ── Types ──
interface DealDetail {
  dealId: string;
  projectNumber: string;
  name: string;
  url: string;
  pbLocation: string;
  designLead: string;
  siteSurveyor: string;
  designApprovalSentDate: string | null;
  designApprovalDate: string | null;
  siteSurveyScheduleDate: string | null;
  siteSurveyCompletionDate: string | null;
  turnaroundDays: number | null;
  daRevisionCounter: number | null;
}

interface GroupMetrics {
  count: number;
  avgTurnaround: number | null;
  avgRevisions: number | null;
  firstTryRate: number | null;
  totalRevisions: number;
  deals: DealDetail[];
}

interface PendingDeal {
  dealId: string;
  projectNumber: string;
  name: string;
  url: string;
  pbLocation: string;
  designLead: string;
  siteSurveyor: string;
  stage: string;
  layoutStatus: string;
  designApprovalSentDate: string | null;
  siteSurveyScheduleDate: string | null;
  siteSurveyCompletionDate: string | null;
  daysWaiting: number;
  daysSinceSurvey?: number;
}

interface DAMetricsData {
  byLocation: Record<string, GroupMetrics>;
  byDesigner: Record<string, GroupMetrics>;
  totals: GroupMetrics;
  pendingDA: PendingDeal[];
  awaitingDA: (PendingDeal & { daysSinceSurvey: number })[];
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

// ── Sort hook ──
function useSort(defaultKey: string | null = null, defaultDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);
  const toggle = useCallback((key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }, [sortKey]);
  return { sortKey, sortDir, toggle };
}

export default function DAMetricsDashboardPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const [daysWindow, setDaysWindow] = useState(60);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [drillDown, setDrillDown] = useState<{ groupKey: string; groupType: "location" } | null>(null);

  // Sort state per table
  const locSort = useSort(null, "desc");
  const drillSort = useSort("turnaroundDays", "desc");
  const awaitingSort = useSort("daysSinceSurvey", "desc");
  const pendingSort = useSort("daysWaiting", "desc");

  const query = useQuery({
    queryKey: queryKeys.stats.daMetrics(daysWindow),
    queryFn: async () => {
      const url =
        daysWindow > 0
          ? `/api/hubspot/da-metrics?days=${daysWindow}`
          : "/api/hubspot/da-metrics";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch DA metrics");
      return res.json() as Promise<DAMetricsData>;
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const data: DAMetricsData | null = query.data ?? null;
  const loading = query.isLoading;
  const error = query.error ? (query.error as Error).message : null;

  useEffect(() => {
    if (!loading && data && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("da-metrics", { projectCount: data.totals.count });
    }
  }, [loading, data, trackDashboardView]);

  const displayLocations = useMemo(() => {
    if (!data) return [];
    const locs = Object.keys(data.byLocation).sort();
    if (filterLocations.length > 0) return locs.filter((l) => filterLocations.includes(l));
    return locs;
  }, [data, filterLocations]);

  // Filter pipeline tables by location
  const filteredAwaitingDA = useMemo(() => {
    if (!data) return [];
    if (filterLocations.length === 0) return data.awaitingDA;
    return data.awaitingDA.filter((p) => filterLocations.includes(p.pbLocation));
  }, [data, filterLocations]);

  const filteredPendingDA = useMemo(() => {
    if (!data) return [];
    if (filterLocations.length === 0) return data.pendingDA;
    return data.pendingDA.filter((p) => filterLocations.includes(p.pbLocation));
  }, [data, filterLocations]);

  const exportData = useMemo(() => {
    if (!data) return [];
    return displayLocations.map((loc) => {
      const d = data.byLocation[loc];
      return {
        Location: loc, Count: d.count,
        "Avg Turnaround": d.avgTurnaround ?? "--",
        "Avg Revisions": d.avgRevisions ?? "--",
        "First-Try %": d.firstTryRate ?? "--",
      };
    });
  }, [data, displayLocations]);

  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "--" : v.toFixed(1));
  const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "--" : `${v}%`);

  if (loading) {
    return (
      <DashboardShell title="Design Approval Metrics" accentColor="purple">
        <div className="grid grid-cols-1 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-40 bg-skeleton rounded-xl animate-pulse" />
          ))}
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Design Approval Metrics" accentColor="purple">
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
  const drillDownGroup = drillDown ? data.byLocation[drillDown.groupKey] : null;
  const drillDownDeals = sortRows(
    drillDownGroup?.deals?.filter((d) => d.turnaroundDays !== null) ?? [],
    drillSort.sortKey,
    drillSort.sortDir
  );

  // Sorted pipeline tables
  const sortedAwaiting = sortRows(filteredAwaitingDA, awaitingSort.sortKey, awaitingSort.sortDir);
  const sortedPending = sortRows(filteredPendingDA, pendingSort.sortKey, pendingSort.sortDir);

  // Sorted location rows for the grid
  const locationRows = useMemo(() => {
    if (!locSort.sortKey) return displayLocations;
    const mapped = displayLocations.map((loc) => ({ loc, ...data.byLocation[loc] }));
    return sortRows(mapped, locSort.sortKey, locSort.sortDir).map((r) => r.loc);
  }, [displayLocations, data, locSort.sortKey, locSort.sortDir]);

  return (
    <DashboardShell
      title="Design Approval Metrics"
      accentColor="purple"
      lastUpdated={data.lastUpdated}
      exportData={{ data: exportData, filename: `da-metrics-${daysWindow || "all"}.csv` }}
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
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
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
                ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
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
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                  : "text-muted hover:text-foreground hover:bg-surface-2"
              }`}
            >
              {loc.replace("Colorado Springs", "CO Springs").replace("San Luis Obispo", "SLO")}
            </button>
          ))}
        </div>

        <div className="ml-auto text-sm text-muted">
          {data.totals.count.toLocaleString()} DAs &middot;{" "}
          {daysWindow > 0 ? `Approved in last ${daysWindow} days` : "All time"}
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface border border-purple-500/30 rounded-xl p-5 text-center">
          <p className="text-sm text-muted mb-1">Avg Turnaround</p>
          <p className={`text-3xl font-mono font-bold ${getColor(data.totals.avgTurnaround, TURNAROUND_THRESHOLDS)}`}>
            {fmt(data.totals.avgTurnaround)}
          </p>
          <p className="text-xs text-muted mt-1">days (sent → approved)</p>
        </div>
        <div className="bg-surface border border-t-border rounded-xl p-5 text-center">
          <p className="text-sm text-muted mb-1">DAs Approved</p>
          <p className="text-3xl font-mono font-bold text-foreground">
            {data.totals.count.toLocaleString()}
          </p>
          <p className="text-xs text-muted mt-1">
            {daysWindow > 0 ? `last ${daysWindow} days` : "all time"}
          </p>
        </div>
        <div className="bg-surface border border-t-border rounded-xl p-5 text-center">
          <p className="text-sm text-muted mb-1">First-Try Approval</p>
          <p className={`text-3xl font-mono font-bold ${getFirstTryColor(data.totals.firstTryRate)}`}>
            {fmtPct(data.totals.firstTryRate)}
          </p>
          <p className="text-xs text-muted mt-1">0 revisions needed</p>
        </div>
        <div className="bg-surface border border-t-border rounded-xl p-5 text-center">
          <p className="text-sm text-muted mb-1">Avg Revisions</p>
          <p className={`text-3xl font-mono font-bold ${getColor(data.totals.avgRevisions, REVISION_THRESHOLDS)}`}>
            {fmt(data.totals.avgRevisions)}
          </p>
          <p className="text-xs text-muted mt-1">per DA</p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════
          SECTION 1: By Location Table
          ═══════════════════════════════════════════════ */}
      <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-t-border">
          <h2 className="text-lg font-semibold text-foreground">DA Performance by Office</h2>
          <p className="text-sm text-muted mt-0.5">
            Turnaround and revision stats &middot; Click turnaround cells to drill into deals
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-t-border bg-surface-2/50">
                <SortHeader label="Location" sortKey="loc" currentKey={locSort.sortKey} currentDir={locSort.sortDir} onSort={locSort.toggle} className="text-left min-w-[160px]" />
                <SortHeader label="Count" sortKey="count" currentKey={locSort.sortKey} currentDir={locSort.sortDir} onSort={locSort.toggle} className="text-center min-w-[70px]" />
                <SortHeader label="Avg Turnaround" sortKey="avgTurnaround" currentKey={locSort.sortKey} currentDir={locSort.sortDir} onSort={locSort.toggle} className="text-center min-w-[110px]" title="Average days from DA sent to DA approved" />
                <SortHeader label="Avg Revisions" sortKey="avgRevisions" currentKey={locSort.sortKey} currentDir={locSort.sortDir} onSort={locSort.toggle} className="text-center min-w-[100px]" title="Average DA revision count" />
                <SortHeader label="First-Try %" sortKey="firstTryRate" currentKey={locSort.sortKey} currentDir={locSort.sortDir} onSort={locSort.toggle} className="text-center min-w-[100px]" title="Percentage approved with 0 revisions" />
              </tr>
            </thead>
            <tbody>
              {locationRows.map((loc, i) => {
                const row = data.byLocation[loc];
                return (
                  <tr key={loc} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-4 py-3 font-medium text-foreground">{loc}</td>
                    <td className="text-center px-4 py-3 text-muted">{row.count.toLocaleString()}</td>
                    <td
                      className={`text-center px-4 py-3 font-mono font-medium cursor-pointer hover:ring-1 hover:ring-purple-500/40 transition-shadow ${getColor(row.avgTurnaround, TURNAROUND_THRESHOLDS)} ${getBg(row.avgTurnaround, TURNAROUND_THRESHOLDS)}`}
                      onClick={() => row.avgTurnaround !== null && setDrillDown({ groupKey: loc, groupType: "location" })}
                      title={row.avgTurnaround !== null ? `Click to see DA deals for ${loc}` : undefined}
                    >
                      {fmt(row.avgTurnaround)}
                    </td>
                    <td className={`text-center px-4 py-3 font-mono font-medium ${getColor(row.avgRevisions, REVISION_THRESHOLDS)}`}>
                      {fmt(row.avgRevisions)}
                    </td>
                    <td className={`text-center px-4 py-3 font-mono font-medium ${getFirstTryColor(row.firstTryRate)}`}>
                      {fmtPct(row.firstTryRate)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-t-border bg-surface-2/40 font-semibold">
                <td className="px-4 py-3 text-foreground">Report Total</td>
                <td className="text-center px-4 py-3 text-foreground">{data.totals.count.toLocaleString()}</td>
                <td className={`text-center px-4 py-3 font-mono ${getColor(data.totals.avgTurnaround, TURNAROUND_THRESHOLDS)}`}>{fmt(data.totals.avgTurnaround)}</td>
                <td className={`text-center px-4 py-3 font-mono ${getColor(data.totals.avgRevisions, REVISION_THRESHOLDS)}`}>{fmt(data.totals.avgRevisions)}</td>
                <td className={`text-center px-4 py-3 font-mono ${getFirstTryColor(data.totals.firstTryRate)}`}>{fmtPct(data.totals.firstTryRate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Drill-Down Panel ── */}
      {drillDown && drillDownDeals.length > 0 && (
        <div className="bg-surface border border-purple-500/30 rounded-xl overflow-hidden mb-8 animate-value-flash">
          <div className="px-5 py-4 border-b border-t-border flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {drillDown.groupKey} — DA Turnaround
              </h2>
              <p className="text-sm text-muted mt-0.5">
                {drillDownDeals.length} deals &middot; avg {fmt(drillDownGroup?.avgTurnaround)} days
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
                  <SortHeader label="Surveyor" sortKey="siteSurveyor" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-left" />
                  <SortHeader label="Survey Sched" sortKey="siteSurveyScheduleDate" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-center" />
                  <SortHeader label="Survey Done" sortKey="siteSurveyCompletionDate" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-center" />
                  <SortHeader label="DA Sent" sortKey="designApprovalSentDate" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-center" />
                  <SortHeader label="DA Approved" sortKey="designApprovalDate" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-center" />
                  <SortHeader label="Turnaround" sortKey="turnaroundDays" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-center" />
                  <SortHeader label="Revisions" sortKey="daRevisionCounter" currentKey={drillSort.sortKey} currentDir={drillSort.sortDir} onSort={drillSort.toggle} className="text-center" />
                  <th className="text-center px-4 py-2.5 font-semibold text-foreground">Link</th>
                </tr>
              </thead>
              <tbody>
                {drillDownDeals.map((d, i) => (
                  <tr key={d.dealId} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-4 py-2.5 font-mono text-foreground">{d.projectNumber}</td>
                    <td className="px-4 py-2.5 text-foreground truncate max-w-[180px]">{d.name}</td>
                    <td className="px-4 py-2.5 text-muted">{d.siteSurveyor}</td>
                    <td className="text-center px-4 py-2.5 text-muted text-xs">{d.siteSurveyScheduleDate || "--"}</td>
                    <td className="text-center px-4 py-2.5 text-muted text-xs">{d.siteSurveyCompletionDate || "--"}</td>
                    <td className="text-center px-4 py-2.5 text-muted text-xs">{d.designApprovalSentDate || "--"}</td>
                    <td className="text-center px-4 py-2.5 text-muted text-xs">{d.designApprovalDate || "--"}</td>
                    <td className={`text-center px-4 py-2.5 font-mono font-medium ${getColor(d.turnaroundDays, TURNAROUND_THRESHOLDS)}`}>
                      {fmt(d.turnaroundDays)}
                    </td>
                    <td className={`text-center px-4 py-2.5 font-mono font-medium ${getColor(d.daRevisionCounter, [0, 1, 2])}`}>
                      {d.daRevisionCounter ?? "--"}
                    </td>
                    <td className="text-center px-4 py-2.5">
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 underline text-xs">
                        HubSpot ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════
          SECTION 2: Survey Complete → DA Not Sent
          ═══════════════════════════════════════════════ */}
      {sortedAwaiting.length > 0 && (
        <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
          <div className="px-5 py-4 border-b border-t-border">
            <h2 className="text-lg font-semibold text-foreground">Survey Complete — DA Not Sent</h2>
            <p className="text-sm text-muted mt-0.5">
              {sortedAwaiting.length} projects with completed survey but DA not yet sent
            </p>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-t-border bg-surface-2/50">
                  <SortHeader label="Project" sortKey="projectNumber" currentKey={awaitingSort.sortKey} currentDir={awaitingSort.sortDir} onSort={awaitingSort.toggle} className="text-left" />
                  <SortHeader label="Customer" sortKey="name" currentKey={awaitingSort.sortKey} currentDir={awaitingSort.sortDir} onSort={awaitingSort.toggle} className="text-left" />
                  <SortHeader label="Location" sortKey="pbLocation" currentKey={awaitingSort.sortKey} currentDir={awaitingSort.sortDir} onSort={awaitingSort.toggle} className="text-left" />
                  <SortHeader label="Designer" sortKey="designLead" currentKey={awaitingSort.sortKey} currentDir={awaitingSort.sortDir} onSort={awaitingSort.toggle} className="text-left" />
                  <SortHeader label="Surveyor" sortKey="siteSurveyor" currentKey={awaitingSort.sortKey} currentDir={awaitingSort.sortDir} onSort={awaitingSort.toggle} className="text-left" />
                  <SortHeader label="Stage" sortKey="stage" currentKey={awaitingSort.sortKey} currentDir={awaitingSort.sortDir} onSort={awaitingSort.toggle} className="text-left" />
                  <SortHeader label="Survey Done" sortKey="siteSurveyCompletionDate" currentKey={awaitingSort.sortKey} currentDir={awaitingSort.sortDir} onSort={awaitingSort.toggle} className="text-center" />
                  <SortHeader label="DA Status" sortKey="layoutStatus" currentKey={awaitingSort.sortKey} currentDir={awaitingSort.sortDir} onSort={awaitingSort.toggle} className="text-center" />
                  <SortHeader label="Days Since Survey" sortKey="daysSinceSurvey" currentKey={awaitingSort.sortKey} currentDir={awaitingSort.sortDir} onSort={awaitingSort.toggle} className="text-center" />
                  <th className="text-center px-4 py-3 font-semibold text-foreground">Link</th>
                </tr>
              </thead>
              <tbody>
                {sortedAwaiting.map((p, i) => (
                  <tr key={p.dealId} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-4 py-3 font-mono text-foreground">{p.projectNumber}</td>
                    <td className="px-4 py-3 text-foreground truncate max-w-[180px]">{p.name}</td>
                    <td className="px-4 py-3 text-muted">{p.pbLocation}</td>
                    <td className="px-4 py-3 text-muted">{p.designLead}</td>
                    <td className="px-4 py-3 text-muted">{p.siteSurveyor}</td>
                    <td className="px-4 py-3 text-muted">{p.stage}</td>
                    <td className="text-center px-4 py-3 text-muted">{p.siteSurveyCompletionDate}</td>
                    <td className="text-center px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs bg-surface-2 text-muted">{p.layoutStatus}</span>
                    </td>
                    <td className={`text-center px-4 py-3 font-mono font-medium ${getWaitingColor(p.daysSinceSurvey)}`}>
                      {p.daysSinceSurvey}
                    </td>
                    <td className="text-center px-4 py-3">
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 underline text-xs">
                        HubSpot ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════
          SECTION 3: DA Sent — Pending Approval
          ═══════════════════════════════════════════════ */}
      {sortedPending.length > 0 && (
        <div className="mb-8">
          <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-t-border">
              <h2 className="text-lg font-semibold text-foreground">DA Sent — Pending Approval</h2>
              <p className="text-sm text-muted mt-0.5">
                {sortedPending.length} DAs sent but not yet approved
              </p>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-t-border bg-surface-2/50">
                    <SortHeader label="Project" sortKey="projectNumber" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-left" />
                    <SortHeader label="Customer" sortKey="name" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-left" />
                    <SortHeader label="Location" sortKey="pbLocation" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-left" />
                    <SortHeader label="Designer" sortKey="designLead" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-left" />
                    <SortHeader label="Surveyor" sortKey="siteSurveyor" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-left" />
                    <SortHeader label="Stage" sortKey="stage" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-left" />
                    <SortHeader label="Survey Done" sortKey="siteSurveyCompletionDate" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-center" />
                    <SortHeader label="DA Status" sortKey="layoutStatus" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-center" />
                    <SortHeader label="DA Sent" sortKey="designApprovalSentDate" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-center" />
                    <SortHeader label="Days Waiting" sortKey="daysWaiting" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-center" />
                    <th className="text-center px-4 py-3 font-semibold text-foreground">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPending.map((p, i) => (
                    <tr key={p.dealId} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                      <td className="px-4 py-3 font-mono text-foreground">{p.projectNumber}</td>
                      <td className="px-4 py-3 text-foreground truncate max-w-[180px]">{p.name}</td>
                      <td className="px-4 py-3 text-muted">{p.pbLocation}</td>
                      <td className="px-4 py-3 text-muted">{p.designLead}</td>
                      <td className="px-4 py-3 text-muted">{p.siteSurveyor}</td>
                      <td className="px-4 py-3 text-muted">{p.stage}</td>
                      <td className="text-center px-4 py-3 text-muted text-xs">{p.siteSurveyCompletionDate || "--"}</td>
                      <td className="text-center px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs bg-purple-500/15 text-purple-300">{p.layoutStatus}</span>
                      </td>
                      <td className="text-center px-4 py-3 text-muted text-xs">{p.designApprovalSentDate || "--"}</td>
                      <td className={`text-center px-4 py-3 font-mono font-medium ${getWaitingColor(p.daysWaiting)}`}>
                        {p.daysWaiting}
                      </td>
                      <td className="text-center px-4 py-3">
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 underline text-xs">
                          HubSpot ↗
                        </a>
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
