"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { queryKeys } from "@/lib/query-keys";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useSort, sortRows } from "@/hooks/useSort";
import { SortHeader } from "@/components/ui/SortHeader";
import { DealLinks } from "@/components/ui/DealLinks";
import { fmtAmount, fmtDateShort } from "@/lib/format-helpers";

// ── Types ──────────────────────────────────────────────────────────────

interface ComputedMetrics {
  count: number;
  avgTurnaround: number | null;
  fpr: number | null;
  fprNotRejected: number | null;
  passCount: number;
  failCount: number;
  firstTimePassCount: number;
  avgCcToInspectionPass: number | null;
}

interface AHJRollupMetrics {
  [key: string]: unknown;
}

interface RollupMetrics {
  [key: string]: unknown;
}

interface DealDetail {
  dealId: string;
  projectNumber: string;
  name: string;
  url: string;
  pbLocation: string;
  ahj: string;
  stage: string;
  amount: number | null;
  constructionCompleteDate: string | null;
  inspectionScheduleDate: string | null;
  inspectionBookedDate: string | null;
  inspectionPassDate: string | null;
  inspectionFailDate: string | null;
  inspectionFailCount: number;
  inspectionFailureReason: string | null;
  isFirstTimePass: boolean;
  inspectionTurnaroundDays: number | null;
  ccToInspectionDays: number | null;
  finalInspectionStatus: string | null;
  zuperJobUid: string | null;
}

interface PipelineDeal {
  dealId: string;
  projectNumber: string;
  name: string;
  url: string;
  pbLocation: string;
  ahj: string;
  stage: string;
  amount: number | null;
  constructionCompleteDate: string | null;
  inspectionScheduleDate: string | null;
  inspectionBookedDate: string | null;
  inspectionFailDate: string | null;
  inspectionFailCount: number;
  inspectionFailureReason: string | null;
  readyForInspection: boolean;
  daysSinceCc: number | null;
  daysSinceLastFail: number | null;
  zuperJobUid: string | null;
}

interface LocationData {
  computed: ComputedMetrics;
  rollup: RollupMetrics | null;
  divergence: Record<string, number> | null;
  deals: DealDetail[];
  ahjBreakdown: Record<string, { computed: ComputedMetrics; deals: DealDetail[] }>;
}

interface AHJData {
  computed: ComputedMetrics;
  rollup: AHJRollupMetrics | null;
  divergence: Record<string, number> | null;
  deals: DealDetail[];
  ahjId: string;
  location: string;
  electricianRequired: boolean;
  fireInspectionRequired: boolean;
  inspectionRequirements: string | null;
  inspectionNotes: string | null;
}

interface InspectionMetricsData {
  byLocation: Record<string, LocationData>;
  byAHJ: Record<string, AHJData>;
  totals: { computed: ComputedMetrics; rollup: RollupMetrics | null; divergence: Record<string, number> | null };
  ccPendingInspection: PipelineDeal[];
  outstandingFailed: PipelineDeal[];
  daysWindow: number;
  lastUpdated: string;
}

// ── Constants ──────────────────────────────────────────────────────────

const DAYS_OPTIONS = [
  { label: "30 Days", value: 30 },
  { label: "60 Days", value: 60 },
  { label: "90 Days", value: 90 },
  { label: "180 Days", value: 180 },
  { label: "365 Days", value: 365 },
  { label: "All Time", value: 0 },
];

const LOCATIONS = ["Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"];

// ── Color thresholds ──────────────────────────────────────────────────

function turnaroundColor(value: number | null): string {
  if (value === null) return "text-muted";
  if (value <= 14) return "text-emerald-400";
  if (value <= 21) return "text-yellow-400";
  if (value <= 30) return "text-orange-400";
  return "text-red-400";
}

function turnaroundStatColor(value: number | null): string {
  if (value === null) return "green";
  if (value <= 14) return "green";
  if (value <= 21) return "yellow";
  if (value <= 30) return "orange";
  return "red";
}

function fprColor(value: number | null): string {
  if (value === null) return "text-muted";
  if (value >= 90) return "text-emerald-400";
  if (value >= 75) return "text-yellow-400";
  if (value >= 60) return "text-orange-400";
  return "text-red-400";
}

function fprStatColor(value: number | null): string {
  if (value === null) return "green";
  if (value >= 90) return "green";
  if (value >= 75) return "yellow";
  if (value >= 60) return "orange";
  return "red";
}

// ── Formatters ────────────────────────────────────────────────────────

function fmtDays(v: number | null | undefined): string {
  if (v === null || v === undefined) return "--";
  return v.toFixed(1);
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "--";
  return `${v.toFixed(1)}%`;
}

// ── Main Page ─────────────────────────────────────────────────────────

export default function InspectionMetricsDashboardPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  // -- State (ALL hooks declared BEFORE any early returns) --
  const [daysWindow, setDaysWindow] = useState(90);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [expandedLocationRow, setExpandedLocationRow] = useState<string | null>(null);
  const [locationDrillMode, setLocationDrillMode] = useState<"deals" | "ahjs">("deals");
  const [expandedAhjRow, setExpandedAhjRow] = useState<string | null>(null);

  // Sort state for performance tables
  const locationSort = useSort("", "asc");
  const ahjSort = useSort("", "asc");

  // Drill-down scroll refs
  const locationDrillRef = useRef<HTMLTableRowElement>(null);
  const ahjDrillRef = useRef<HTMLTableRowElement>(null);

  // Data fetching
  const query = useQuery({
    queryKey: queryKeys.stats.inspectionMetrics(daysWindow),
    queryFn: async () => {
      const url =
        daysWindow > 0
          ? `/api/hubspot/inspection-metrics?days=${daysWindow}`
          : "/api/hubspot/inspection-metrics";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch inspection metrics");
      return res.json() as Promise<InspectionMetricsData>;
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const data = query.data ?? null;
  const loading = query.isLoading;
  const error = query.error ? (query.error as Error).message : null;

  // Activity tracking
  useEffect(() => {
    if (!loading && data && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("inspection-metrics", { projectCount: data.totals.computed.count });
    }
  }, [loading, data, trackDashboardView]);

  // Auto-scroll drill-downs into view
  useEffect(() => {
    if (expandedLocationRow && locationDrillRef.current) {
      locationDrillRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [expandedLocationRow]);

  useEffect(() => {
    if (expandedAhjRow && ahjDrillRef.current) {
      ahjDrillRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [expandedAhjRow]);

  // ── Derived data (all useMemo BEFORE early returns) ─────────────────

  // Filter locations for display
  const displayLocationKeys = useMemo(() => {
    if (!data) return [];
    const locs = Object.keys(data.byLocation).sort();
    if (filterLocations.length > 0) return locs.filter((l) => filterLocations.includes(l));
    return locs;
  }, [data, filterLocations]);

  // Location table rows
  const locationRows = useMemo(() => {
    if (!data) return [];
    return displayLocationKeys.map((loc) => ({
      location: loc,
      count: data.byLocation[loc].computed.count,
      avgTurnaround: data.byLocation[loc].computed.avgTurnaround,
      fpr: data.byLocation[loc].computed.fpr,
      failCount: data.byLocation[loc].computed.failCount,
      avgCcToPass: data.byLocation[loc].computed.avgCcToInspectionPass,
    }));
  }, [data, displayLocationKeys]);

  const sortedLocationRows = useMemo(
    () => sortRows(locationRows, locationSort.sortKey, locationSort.sortDir),
    [locationRows, locationSort.sortKey, locationSort.sortDir],
  );

  // AHJ table rows
  const ahjRows = useMemo(() => {
    if (!data) return [];
    let entries = Object.entries(data.byAHJ);
    if (filterLocations.length > 0) {
      entries = entries.filter(([, v]) => filterLocations.includes(v.location));
    }
    return entries.map(([ahj, v]) => ({
      ahj,
      location: v.location,
      count: v.computed.count,
      avgTurnaround: v.computed.avgTurnaround,
      fpr: v.computed.fpr,
      failCount: v.computed.failCount,
      electricianRequired: v.electricianRequired,
      fireInspectionRequired: v.fireInspectionRequired,
    }));
  }, [data, filterLocations]);

  const sortedAhjRows = useMemo(
    () => sortRows(ahjRows, ahjSort.sortKey, ahjSort.sortDir),
    [ahjRows, ahjSort.sortKey, ahjSort.sortDir],
  );

  // Filtered totals (recompute when location filter active)
  const filteredTotals = useMemo(() => {
    if (!data) return null;
    if (filterLocations.length === 0) return data.totals.computed;
    // Sum from filtered locations
    let totalCount = 0;
    let totalPassCount = 0;
    let totalFailCount = 0;
    let totalFirstTimePass = 0;
    let turnaroundSum = 0;
    let turnaroundCount = 0;
    let ccPassSum = 0;
    let ccPassCount = 0;
    for (const loc of filterLocations) {
      const ld = data.byLocation[loc];
      if (!ld) continue;
      const c = ld.computed;
      totalCount += c.count;
      totalPassCount += c.passCount;
      totalFailCount += c.failCount;
      totalFirstTimePass += c.firstTimePassCount;
      if (c.avgTurnaround !== null) {
        turnaroundSum += c.avgTurnaround * c.count;
        turnaroundCount += c.count;
      }
      if (c.avgCcToInspectionPass !== null) {
        ccPassSum += c.avgCcToInspectionPass * c.passCount;
        ccPassCount += c.passCount;
      }
    }
    return {
      count: totalCount,
      passCount: totalPassCount,
      failCount: totalFailCount,
      firstTimePassCount: totalFirstTimePass,
      avgTurnaround: turnaroundCount > 0 ? turnaroundSum / turnaroundCount : null,
      avgCcToInspectionPass: ccPassCount > 0 ? ccPassSum / ccPassCount : null,
      fpr: totalCount > 0 ? (totalFirstTimePass / totalCount) * 100 : null,
      fprNotRejected: null,
    } satisfies ComputedMetrics;
  }, [data, filterLocations]);

  // Export data
  const exportData = useMemo(() => {
    const rows: Record<string, string | number>[] = [];
    for (const r of locationRows) {
      rows.push({
        Group: r.location,
        Type: "Location",
        Inspections: r.count,
        "Avg Turnaround": r.avgTurnaround !== null ? r.avgTurnaround : "--" as unknown as number,
        "FPR %": r.fpr !== null ? r.fpr : "--" as unknown as number,
        "Fail Count": r.failCount,
        "Avg CC to Pass": r.avgCcToPass !== null ? r.avgCcToPass : "--" as unknown as number,
      });
    }
    for (const r of ahjRows) {
      rows.push({
        Group: r.ahj,
        Type: "AHJ",
        Location: r.location,
        Inspections: r.count,
        "Avg Turnaround": r.avgTurnaround !== null ? r.avgTurnaround : "--" as unknown as number,
        "FPR %": r.fpr !== null ? r.fpr : "--" as unknown as number,
        "Fail Count": r.failCount,
      });
    }
    return rows;
  }, [locationRows, ahjRows]);

  // ── Early returns (AFTER all hooks) ─────────────────────────────────

  if (loading) {
    return (
      <DashboardShell title="Inspection Metrics" accentColor="green">
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
      <DashboardShell title="Inspection Metrics" accentColor="green">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 font-medium">{error}</p>
          <button
            onClick={() => query.refetch()}
            className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-300 text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  if (!data || !filteredTotals) return null;

  // ── Location drill-down data ────────────────────────────────────────

  const locationDrillDeals =
    expandedLocationRow && data.byLocation[expandedLocationRow]
      ? locationDrillMode === "deals"
        ? data.byLocation[expandedLocationRow].deals
        : []
      : [];

  const locationDrillAhjs =
    expandedLocationRow && data.byLocation[expandedLocationRow] && locationDrillMode === "ahjs"
      ? Object.entries(data.byLocation[expandedLocationRow].ahjBreakdown)
      : [];

  // AHJ drill-down data
  const ahjDrillDeals =
    expandedAhjRow && data.byAHJ[expandedAhjRow] ? data.byAHJ[expandedAhjRow].deals : [];

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <DashboardShell
      title="Inspection Metrics"
      accentColor="green"
      lastUpdated={data.lastUpdated}
      exportData={{ data: exportData, filename: `inspection-metrics-${daysWindow || "all"}.csv` }}
      fullWidth
    >
      {/* ── Filter Bar ─────────────────────────────────────────────── */}
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
                  prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc],
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
          {filteredTotals.count.toLocaleString()} inspections &middot;{" "}
          {daysWindow > 0 ? `Last ${daysWindow} days` : "All time"}
        </div>
      </div>

      {/* ── Summary Cards ──────────────────────────────────────────── */}
      {filteredTotals.count === 0 ? (
        <div className="bg-surface border border-t-border rounded-xl p-8 text-center text-muted mb-8">
          No inspections completed in the selected time window.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-grid mb-8">
          <StatCard
            label="Avg CC to Inspection Pass"
            value={filteredTotals.avgCcToInspectionPass !== null ? `${fmtDays(filteredTotals.avgCcToInspectionPass)} days` : "--"}
            subtitle={filteredTotals.avgCcToInspectionPass !== null ? (filteredTotals.avgCcToInspectionPass <= 14 ? "On target" : filteredTotals.avgCcToInspectionPass <= 21 ? "Slightly above target" : "Needs improvement") : null}
            color={turnaroundStatColor(filteredTotals.avgCcToInspectionPass)}
          />
          <StatCard
            label="Inspections Passed"
            value={filteredTotals.passCount.toLocaleString()}
            subtitle={daysWindow > 0 ? `last ${daysWindow} days` : "all time"}
            color="green"
          />
          <StatCard
            label="First-Time Pass Rate"
            value={fmtPct(filteredTotals.fpr)}
            subtitle={filteredTotals.fpr !== null ? (filteredTotals.fpr >= 90 ? "Excellent" : filteredTotals.fpr >= 75 ? "Good" : "Needs improvement") : null}
            color={fprStatColor(filteredTotals.fpr)}
          />
        </div>
      )}

      {/* ── Section 1: Performance by PB Location ──────────────────── */}
      <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-t-border">
          <h2 className="text-lg font-semibold text-foreground">Performance by PB Location</h2>
          <p className="text-sm text-muted mt-0.5">
            Inspection turnaround and pass rates by office &middot; Click a row to drill down
          </p>
        </div>
        {sortedLocationRows.length === 0 ? (
          <div className="p-8 text-center text-muted">
            No inspections completed in the selected time window.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border bg-surface-2/50">
                  <SortHeader label="PB Location" sortKey="location" currentKey={locationSort.sortKey} currentDir={locationSort.sortDir} onSort={locationSort.toggle} compact />
                  <SortHeader label="Inspections" sortKey="count" currentKey={locationSort.sortKey} currentDir={locationSort.sortDir} onSort={locationSort.toggle} compact />
                  <SortHeader label="Avg Turnaround" sortKey="avgTurnaround" currentKey={locationSort.sortKey} currentDir={locationSort.sortDir} onSort={locationSort.toggle} compact />
                  <SortHeader label="FPR %" sortKey="fpr" currentKey={locationSort.sortKey} currentDir={locationSort.sortDir} onSort={locationSort.toggle} compact />
                  <SortHeader label="Fail Count" sortKey="failCount" currentKey={locationSort.sortKey} currentDir={locationSort.sortDir} onSort={locationSort.toggle} compact />
                  <SortHeader label="Avg CC to Pass" sortKey="avgCcToPass" currentKey={locationSort.sortKey} currentDir={locationSort.sortDir} onSort={locationSort.toggle} compact />
                </tr>
              </thead>
              <tbody>
                {sortedLocationRows.map((row, i) => {
                  const isExpanded = expandedLocationRow === row.location;
                  return (
                    <>
                      <tr
                        key={row.location}
                        className={`border-b border-t-border/50 cursor-pointer hover:bg-surface-2/50 transition-colors ${
                          i % 2 === 0 ? "" : "bg-surface-2/20"
                        } ${isExpanded ? "border-l-2 border-l-emerald-500" : ""}`}
                        onClick={() => {
                          setExpandedLocationRow(isExpanded ? null : row.location);
                          setLocationDrillMode("deals");
                        }}
                      >
                        <td className="px-3 py-2.5 font-medium text-foreground">{row.location}</td>
                        <td className="px-3 py-2.5 text-muted">{row.count.toLocaleString()}</td>
                        <td className={`px-3 py-2.5 font-mono font-medium ${turnaroundColor(row.avgTurnaround)}`}>
                          {fmtDays(row.avgTurnaround)}
                        </td>
                        <td className={`px-3 py-2.5 font-mono font-medium ${fprColor(row.fpr)}`}>
                          {fmtPct(row.fpr)}
                        </td>
                        <td className={`px-3 py-2.5 font-mono ${row.failCount > 0 ? "text-red-400" : "text-muted"}`}>
                          {row.failCount}
                        </td>
                        <td className={`px-3 py-2.5 font-mono font-medium ${turnaroundColor(row.avgCcToPass)}`}>
                          {fmtDays(row.avgCcToPass)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${row.location}-drill`} ref={locationDrillRef}>
                          <td colSpan={6} className="p-0">
                            <div className="bg-surface-2/30 border-t border-t-border">
                              {/* Mode toggle */}
                              <div className="px-4 py-3 flex items-center gap-2 border-b border-t-border/50">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setLocationDrillMode("deals"); }}
                                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                                    locationDrillMode === "deals"
                                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                      : "text-muted hover:text-foreground hover:bg-surface-2"
                                  }`}
                                >
                                  Show Deals
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setLocationDrillMode("ahjs"); }}
                                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                                    locationDrillMode === "ahjs"
                                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                      : "text-muted hover:text-foreground hover:bg-surface-2"
                                  }`}
                                >
                                  Show AHJs in {row.location}
                                </button>
                                <span className="ml-auto text-xs text-muted">
                                  {locationDrillMode === "deals"
                                    ? `${locationDrillDeals.length} deals`
                                    : `${locationDrillAhjs.length} AHJs`}
                                </span>
                              </div>

                              {locationDrillMode === "deals" ? (
                                locationDrillDeals.length === 0 ? (
                                  <div className="p-6 text-center text-muted text-sm">
                                    No deals in this group for the selected time window.
                                  </div>
                                ) : (
                                  <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                                    <table className="w-full text-sm">
                                      <thead className="sticky top-0 z-10">
                                        <tr className="border-b border-t-border bg-surface-2/80 backdrop-blur-sm">
                                          <th className="px-3 py-2 text-left text-xs font-medium text-muted">Project</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-muted">Customer</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-muted">AHJ</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-muted">CC Date</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-muted">Pass Date</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-muted">Turnaround</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-muted">FTP</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-muted">Fails</th>
                                          <th className="px-3 py-2 text-center text-xs font-medium text-muted">Links</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {locationDrillDeals.map((d, di) => (
                                          <tr
                                            key={d.dealId}
                                            className={`border-b border-t-border/50 ${di % 2 === 0 ? "" : "bg-surface-2/20"}`}
                                          >
                                            <td className="px-3 py-2 font-mono text-foreground">{d.projectNumber}</td>
                                            <td className="px-3 py-2 text-foreground truncate max-w-[180px]">{d.name}</td>
                                            <td className="px-3 py-2 text-muted">{d.ahj || "--"}</td>
                                            <td className="px-3 py-2 text-muted">{fmtDateShort(d.constructionCompleteDate)}</td>
                                            <td className="px-3 py-2 text-muted">{fmtDateShort(d.inspectionPassDate)}</td>
                                            <td className={`px-3 py-2 font-mono font-medium ${turnaroundColor(d.inspectionTurnaroundDays)}`}>
                                              {fmtDays(d.inspectionTurnaroundDays)}
                                            </td>
                                            <td className="px-3 py-2">
                                              {d.isFirstTimePass ? (
                                                <span className="text-emerald-400 font-medium">Yes</span>
                                              ) : (
                                                <span className="text-red-400 font-medium">No</span>
                                              )}
                                            </td>
                                            <td className={`px-3 py-2 font-mono ${d.inspectionFailCount > 0 ? "text-red-400" : "text-muted"}`}>
                                              {d.inspectionFailCount}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                              <DealLinks dealId={d.dealId} zuperJobUid={d.zuperJobUid} />
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )
                              ) : locationDrillAhjs.length === 0 ? (
                                <div className="p-6 text-center text-muted text-sm">
                                  No AHJ breakdown available for this location.
                                </div>
                              ) : (
                                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                                  <table className="w-full text-sm">
                                    <thead className="sticky top-0 z-10">
                                      <tr className="border-b border-t-border bg-surface-2/80 backdrop-blur-sm">
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">AHJ</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">Inspections</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">Avg Turnaround</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">FPR %</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">Fail Count</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {locationDrillAhjs.map(([ahj, ahjData], ai) => (
                                        <tr
                                          key={ahj}
                                          className={`border-b border-t-border/50 ${ai % 2 === 0 ? "" : "bg-surface-2/20"}`}
                                        >
                                          <td className="px-3 py-2 font-medium text-foreground">{ahj}</td>
                                          <td className="px-3 py-2 text-muted">{ahjData.computed.count}</td>
                                          <td className={`px-3 py-2 font-mono font-medium ${turnaroundColor(ahjData.computed.avgTurnaround)}`}>
                                            {fmtDays(ahjData.computed.avgTurnaround)}
                                          </td>
                                          <td className={`px-3 py-2 font-mono font-medium ${fprColor(ahjData.computed.fpr)}`}>
                                            {fmtPct(ahjData.computed.fpr)}
                                          </td>
                                          <td className={`px-3 py-2 font-mono ${ahjData.computed.failCount > 0 ? "text-red-400" : "text-muted"}`}>
                                            {ahjData.computed.failCount}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
                {/* Totals row */}
                <tr className="border-t-2 border-t-border bg-surface-2/40 font-semibold">
                  <td className="px-3 py-2.5 text-foreground">Report Total</td>
                  <td className="px-3 py-2.5 text-foreground">{filteredTotals.count.toLocaleString()}</td>
                  <td className={`px-3 py-2.5 font-mono ${turnaroundColor(filteredTotals.avgTurnaround)}`}>
                    {fmtDays(filteredTotals.avgTurnaround)}
                  </td>
                  <td className={`px-3 py-2.5 font-mono ${fprColor(filteredTotals.fpr)}`}>
                    {fmtPct(filteredTotals.fpr)}
                  </td>
                  <td className={`px-3 py-2.5 font-mono ${filteredTotals.failCount > 0 ? "text-red-400" : "text-muted"}`}>
                    {filteredTotals.failCount}
                  </td>
                  <td className={`px-3 py-2.5 font-mono ${turnaroundColor(filteredTotals.avgCcToInspectionPass)}`}>
                    {fmtDays(filteredTotals.avgCcToInspectionPass)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 2: Performance by AHJ ──────────────────────────── */}
      <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-t-border">
          <h2 className="text-lg font-semibold text-foreground">Performance by AHJ</h2>
          <p className="text-sm text-muted mt-0.5">
            Authority Having Jurisdiction breakdown &middot; Click a row to see deals
          </p>
        </div>
        {sortedAhjRows.length === 0 ? (
          <div className="p-8 text-center text-muted">
            No inspections completed in the selected time window.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border bg-surface-2/50">
                  <SortHeader label="AHJ" sortKey="ahj" currentKey={ahjSort.sortKey} currentDir={ahjSort.sortDir} onSort={ahjSort.toggle} compact />
                  <SortHeader label="PB Location" sortKey="location" currentKey={ahjSort.sortKey} currentDir={ahjSort.sortDir} onSort={ahjSort.toggle} compact />
                  <SortHeader label="Inspections" sortKey="count" currentKey={ahjSort.sortKey} currentDir={ahjSort.sortDir} onSort={ahjSort.toggle} compact />
                  <SortHeader label="Avg Turnaround" sortKey="avgTurnaround" currentKey={ahjSort.sortKey} currentDir={ahjSort.sortDir} onSort={ahjSort.toggle} compact />
                  <SortHeader label="FPR %" sortKey="fpr" currentKey={ahjSort.sortKey} currentDir={ahjSort.sortDir} onSort={ahjSort.toggle} compact />
                  <SortHeader label="Fail Count" sortKey="failCount" currentKey={ahjSort.sortKey} currentDir={ahjSort.sortDir} onSort={ahjSort.toggle} compact />
                  <SortHeader label="Electrician Req" sortKey="electricianRequired" currentKey={ahjSort.sortKey} currentDir={ahjSort.sortDir} onSort={ahjSort.toggle} compact />
                  <SortHeader label="Fire Insp Req" sortKey="fireInspectionRequired" currentKey={ahjSort.sortKey} currentDir={ahjSort.sortDir} onSort={ahjSort.toggle} compact />
                </tr>
              </thead>
              <tbody>
                {sortedAhjRows.map((row, i) => {
                  const isExpanded = expandedAhjRow === row.ahj;
                  return (
                    <>
                      <tr
                        key={row.ahj}
                        className={`border-b border-t-border/50 cursor-pointer hover:bg-surface-2/50 transition-colors ${
                          i % 2 === 0 ? "" : "bg-surface-2/20"
                        } ${isExpanded ? "border-l-2 border-l-emerald-500" : ""}`}
                        onClick={() => setExpandedAhjRow(isExpanded ? null : row.ahj)}
                      >
                        <td className="px-3 py-2.5 font-medium text-foreground">{row.ahj}</td>
                        <td className="px-3 py-2.5 text-muted">{row.location}</td>
                        <td className="px-3 py-2.5 text-muted">{row.count.toLocaleString()}</td>
                        <td className={`px-3 py-2.5 font-mono font-medium ${turnaroundColor(row.avgTurnaround)}`}>
                          {fmtDays(row.avgTurnaround)}
                        </td>
                        <td className={`px-3 py-2.5 font-mono font-medium ${fprColor(row.fpr)}`}>
                          {fmtPct(row.fpr)}
                        </td>
                        <td className={`px-3 py-2.5 font-mono ${row.failCount > 0 ? "text-red-400" : "text-muted"}`}>
                          {row.failCount}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {row.electricianRequired ? (
                            <span className="text-emerald-400" title="Required">&#10003;</span>
                          ) : (
                            <span className="text-muted" title="Not required">&#10007;</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {row.fireInspectionRequired ? (
                            <span className="text-emerald-400" title="Required">&#10003;</span>
                          ) : (
                            <span className="text-muted" title="Not required">&#10007;</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${row.ahj}-drill`} ref={ahjDrillRef}>
                          <td colSpan={8} className="p-0">
                            <div className="bg-surface-2/30 border-t border-t-border">
                              <div className="px-4 py-3 border-b border-t-border/50 text-xs text-muted">
                                {ahjDrillDeals.length} deals in {row.ahj}
                              </div>
                              {ahjDrillDeals.length === 0 ? (
                                <div className="p-6 text-center text-muted text-sm">
                                  No deals in this group for the selected time window.
                                </div>
                              ) : (
                                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                                  <table className="w-full text-sm">
                                    <thead className="sticky top-0 z-10">
                                      <tr className="border-b border-t-border bg-surface-2/80 backdrop-blur-sm">
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">Project</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">Customer</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">Stage</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">Amount</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">CC Date</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">Pass Date</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">Turnaround</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">FTP</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-muted">Fails</th>
                                        <th className="px-3 py-2 text-center text-xs font-medium text-muted">Links</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {ahjDrillDeals.map((d, di) => (
                                        <tr
                                          key={d.dealId}
                                          className={`border-b border-t-border/50 ${di % 2 === 0 ? "" : "bg-surface-2/20"}`}
                                        >
                                          <td className="px-3 py-2 font-mono text-foreground">{d.projectNumber}</td>
                                          <td className="px-3 py-2 text-foreground truncate max-w-[180px]">{d.name}</td>
                                          <td className="px-3 py-2 text-muted">{d.stage || "--"}</td>
                                          <td className="px-3 py-2 text-muted">{fmtAmount(d.amount)}</td>
                                          <td className="px-3 py-2 text-muted">{fmtDateShort(d.constructionCompleteDate)}</td>
                                          <td className="px-3 py-2 text-muted">{fmtDateShort(d.inspectionPassDate)}</td>
                                          <td className={`px-3 py-2 font-mono font-medium ${turnaroundColor(d.inspectionTurnaroundDays)}`}>
                                            {fmtDays(d.inspectionTurnaroundDays)}
                                          </td>
                                          <td className="px-3 py-2">
                                            {d.isFirstTimePass ? (
                                              <span className="text-emerald-400 font-medium">Yes</span>
                                            ) : (
                                              <span className="text-red-400 font-medium">No</span>
                                            )}
                                          </td>
                                          <td className={`px-3 py-2 font-mono ${d.inspectionFailCount > 0 ? "text-red-400" : "text-muted"}`}>
                                            {d.inspectionFailCount}
                                          </td>
                                          <td className="px-3 py-2 text-center">
                                            <DealLinks dealId={d.dealId} zuperJobUid={d.zuperJobUid} />
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </DashboardShell>
  );
}
