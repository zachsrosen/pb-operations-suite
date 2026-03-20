"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { queryKeys } from "@/lib/query-keys";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ── Thresholds ──
const TURNAROUND_THRESHOLDS = [5, 10, 20] as const;
const REVISION_THRESHOLDS = [0.5, 1, 2] as const;
const WAITING_THRESHOLDS = [3, 7, 14] as const;

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

export default function DAMetricsDashboardPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const [daysWindow, setDaysWindow] = useState(60);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [drillDown, setDrillDown] = useState<{
    groupKey: string;
    groupType: "location" | "designer";
  } | null>(null);

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

  const displayDesigners = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.byDesigner)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name]) => name);
  }, [data]);

  const exportData = useMemo(() => {
    if (!data) return [];
    const rows: Record<string, string | number>[] = [];
    for (const loc of displayLocations) {
      const d = data.byLocation[loc];
      rows.push({
        Group: loc, Type: "Location", Count: d.count,
        "Avg Turnaround": d.avgTurnaround ?? "--",
        "Avg Revisions": d.avgRevisions ?? "--",
        "First-Try %": d.firstTryRate ?? "--",
      });
    }
    for (const name of displayDesigners) {
      const d = data.byDesigner[name];
      rows.push({
        Group: name, Type: "Designer", Count: d.count,
        "Avg Turnaround": d.avgTurnaround ?? "--",
        "Avg Revisions": d.avgRevisions ?? "--",
        "First-Try %": d.firstTryRate ?? "--",
      });
    }
    return rows;
  }, [data, displayLocations, displayDesigners]);

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
  const drillDownGroup = drillDown
    ? drillDown.groupType === "location"
      ? data.byLocation[drillDown.groupKey]
      : data.byDesigner[drillDown.groupKey]
    : null;
  const drillDownDeals = drillDownGroup?.deals
    ?.filter((d) => d.turnaroundDays !== null)
    .sort((a, b) => (b.turnaroundDays ?? 0) - (a.turnaroundDays ?? 0)) ?? [];

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
          SECTION 1: Turnaround & Revision Metrics
          ═══════════════════════════════════════════════ */}

      {/* By Location Table */}
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
                <th className="text-left px-4 py-3 font-semibold text-foreground min-w-[160px]">Location</th>
                <th className="text-center px-4 py-3 font-semibold text-foreground min-w-[70px]">Count</th>
                <th className="text-center px-4 py-3 font-semibold text-foreground min-w-[110px]" title="Average days from DA sent to DA approved">Avg Turnaround</th>
                <th className="text-center px-4 py-3 font-semibold text-foreground min-w-[100px]" title="Average DA revision count">Avg Revisions</th>
                <th className="text-center px-4 py-3 font-semibold text-foreground min-w-[100px]" title="Percentage approved with 0 revisions">First-Try %</th>
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

      {/* By Designer Table */}
      <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-t-border">
          <h2 className="text-lg font-semibold text-foreground">DA Performance by Designer</h2>
          <p className="text-sm text-muted mt-0.5">
            Per-designer turnaround and revision quality &middot; Click turnaround cells to drill into deals
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-t-border bg-surface-2/50">
                <th className="text-left px-4 py-3 font-semibold text-foreground min-w-[160px]">Designer</th>
                <th className="text-center px-4 py-3 font-semibold text-foreground min-w-[70px]">Count</th>
                <th className="text-center px-4 py-3 font-semibold text-foreground min-w-[110px]" title="Average days from DA sent to DA approved">Avg Turnaround</th>
                <th className="text-center px-4 py-3 font-semibold text-foreground min-w-[100px]" title="Average DA revision count">Avg Revisions</th>
                <th className="text-center px-4 py-3 font-semibold text-foreground min-w-[100px]" title="Percentage approved with 0 revisions">First-Try %</th>
              </tr>
            </thead>
            <tbody>
              {displayDesigners.map((name, i) => {
                const row = data.byDesigner[name];
                return (
                  <tr key={name} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-4 py-3 font-medium text-foreground">{name}</td>
                    <td className="text-center px-4 py-3 text-muted">{row.count.toLocaleString()}</td>
                    <td
                      className={`text-center px-4 py-3 font-mono font-medium cursor-pointer hover:ring-1 hover:ring-purple-500/40 transition-shadow ${getColor(row.avgTurnaround, TURNAROUND_THRESHOLDS)} ${getBg(row.avgTurnaround, TURNAROUND_THRESHOLDS)}`}
                      onClick={() => row.avgTurnaround !== null && setDrillDown({ groupKey: name, groupType: "designer" })}
                      title={row.avgTurnaround !== null ? `Click to see DA deals for ${name}` : undefined}
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
                  <th className="text-left px-4 py-2.5 font-semibold text-foreground">Project</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-foreground">Customer</th>
                  {drillDown.groupType === "designer" && (
                    <th className="text-left px-4 py-2.5 font-semibold text-foreground">Location</th>
                  )}
                  {drillDown.groupType === "location" && (
                    <th className="text-left px-4 py-2.5 font-semibold text-foreground">Designer</th>
                  )}
                  <th className="text-left px-4 py-2.5 font-semibold text-foreground">Surveyor</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-foreground">Survey Sched</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-foreground">Survey Done</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-foreground">DA Sent</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-foreground">DA Approved</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-foreground">Turnaround</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-foreground">Revisions</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-foreground">Link</th>
                </tr>
              </thead>
              <tbody>
                {drillDownDeals.map((d, i) => (
                  <tr key={d.dealId} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-4 py-2.5 font-mono text-foreground">{d.projectNumber}</td>
                    <td className="px-4 py-2.5 text-foreground truncate max-w-[180px]">{d.name}</td>
                    {drillDown.groupType === "designer" && (
                      <td className="px-4 py-2.5 text-muted">{d.pbLocation}</td>
                    )}
                    {drillDown.groupType === "location" && (
                      <td className="px-4 py-2.5 text-muted">{d.designLead}</td>
                    )}
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
          SECTION 3A: Survey Complete → DA Not Sent
          ═══════════════════════════════════════════════ */}
      {data.awaitingDA.length > 0 && (
        <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
          <div className="px-5 py-4 border-b border-t-border">
            <h2 className="text-lg font-semibold text-foreground">Survey Complete — DA Not Sent</h2>
            <p className="text-sm text-muted mt-0.5">
              {data.awaitingDA.length} projects with completed survey but DA not yet sent &middot; Sorted by days since survey
            </p>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-t-border bg-surface-2/50">
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Project</th>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Customer</th>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Location</th>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Designer</th>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Surveyor</th>
                  <th className="text-center px-4 py-3 font-semibold text-foreground">Survey Done</th>
                  <th className="text-center px-4 py-3 font-semibold text-foreground">DA Status</th>
                  <th className="text-center px-4 py-3 font-semibold text-foreground">Days Since Survey</th>
                  <th className="text-center px-4 py-3 font-semibold text-foreground">Link</th>
                </tr>
              </thead>
              <tbody>
                {data.awaitingDA.map((p, i) => (
                  <tr key={p.dealId} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-4 py-3 font-mono text-foreground">{p.projectNumber}</td>
                    <td className="px-4 py-3 text-foreground truncate max-w-[180px]">{p.name}</td>
                    <td className="px-4 py-3 text-muted">{p.pbLocation}</td>
                    <td className="px-4 py-3 text-muted">{p.designLead}</td>
                    <td className="px-4 py-3 text-muted">{p.siteSurveyor}</td>
                    <td className="text-center px-4 py-3 text-muted">{p.siteSurveyCompletionDate}</td>
                    <td className="text-center px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs bg-surface-2 text-muted">{p.layoutStatus}</span>
                    </td>
                    <td className={`text-center px-4 py-3 font-mono font-medium ${
                      p.daysSinceSurvey > 14 ? "text-red-400" :
                      p.daysSinceSurvey > 7 ? "text-orange-400" :
                      p.daysSinceSurvey > 3 ? "text-yellow-400" :
                      "text-emerald-400"
                    }`}>
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
          SECTION 3B: DA Sent — Pending Approval
          ═══════════════════════════════════════════════ */}
      {data.pendingDA.length > 0 && (
        <div className="mb-8">
          <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-t-border">
              <h2 className="text-lg font-semibold text-foreground">DA Sent — Pending Approval</h2>
              <p className="text-sm text-muted mt-0.5">
                {data.pendingDA.length} DAs sent but not yet approved &middot; Sorted by days waiting
              </p>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-t-border bg-surface-2/50">
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Project</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Customer</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Location</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Designer</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Surveyor</th>
                    <th className="text-center px-4 py-3 font-semibold text-foreground">Survey Done</th>
                    <th className="text-center px-4 py-3 font-semibold text-foreground">DA Status</th>
                    <th className="text-center px-4 py-3 font-semibold text-foreground">DA Sent</th>
                    <th className="text-center px-4 py-3 font-semibold text-foreground">Days Waiting</th>
                    <th className="text-center px-4 py-3 font-semibold text-foreground">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pendingDA.map((p, i) => (
                    <tr key={p.dealId} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                      <td className="px-4 py-3 font-mono text-foreground">{p.projectNumber}</td>
                      <td className="px-4 py-3 text-foreground truncate max-w-[180px]">{p.name}</td>
                      <td className="px-4 py-3 text-muted">{p.pbLocation}</td>
                      <td className="px-4 py-3 text-muted">{p.designLead}</td>
                      <td className="px-4 py-3 text-muted">{p.siteSurveyor}</td>
                      <td className="text-center px-4 py-3 text-muted text-xs">{p.siteSurveyCompletionDate || "--"}</td>
                      <td className="text-center px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-xs bg-purple-500/15 text-purple-300">{p.layoutStatus}</span>
                      </td>
                      <td className="text-center px-4 py-3 text-muted text-xs">{p.designApprovalSentDate || "--"}</td>
                      <td className={`text-center px-4 py-3 font-mono font-medium ${
                        p.daysWaiting > 14 ? "text-red-400" :
                        p.daysWaiting > 7 ? "text-orange-400" :
                        p.daysWaiting > 3 ? "text-yellow-400" :
                        "text-emerald-400"
                      }`}>
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
