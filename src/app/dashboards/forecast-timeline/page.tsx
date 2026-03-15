"use client";

import { Fragment, useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { ForecastBasisBadge } from "@/components/ui/ForecastBasisBadge";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useSSE } from "@/hooks/useSSE";
import { STAGE_COLORS } from "@/lib/constants";
import type { ForecastBasis } from "@/lib/forecasting";

// ─── Types ────────────────────────────────────────────────────────

interface MilestoneDetail {
  name: string;
  key: string;
  originalForecast: string | null;
  liveForecast: string | null;
  actual: string | null;
  varianceDays: number | null;
  basis: ForecastBasis;
}

interface TimelineProject {
  dealId: string;
  projectNumber: string;
  customerName: string;
  location: string;
  currentStage: string;
  nextMilestone: { name: string; forecastDate: string | null };
  forecastPto: string | null;
  varianceDays: number | null;
  milestones: MilestoneDetail[];
}

interface TimelineData {
  projects: TimelineProject[];
  summary: {
    total: number;
    onTrack: number;
    atRisk: number;
    behind: number;
    noForecast: number;
  };
  lastUpdated: string;
}

// ─── Helpers ──────────────────────────────────────────────────────

function varianceLabel(days: number | null): string {
  if (days === null) return "—";
  if (days <= 0) return days === 0 ? "On Track" : `${days}d`;
  if (days <= 7) return "On Track";
  return `+${days}d`;
}

function varianceColor(days: number | null): string {
  if (days === null) return "text-muted";
  if (days <= 7) return "text-green-500";
  if (days <= 14) return "text-amber-500";
  return "text-red-500";
}

function varianceBucket(days: number | null): "onTrack" | "atRisk" | "behind" | "noForecast" {
  if (days === null) return "noForecast";
  if (days <= 7) return "onTrack";
  if (days <= 14) return "atRisk";
  return "behind";
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  const date = new Date(d + "T12:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function stagePillColor(stage: string): string {
  const entry = STAGE_COLORS[stage];
  return entry?.tw ?? "bg-zinc-500";
}

// ─── Sub-components ───────────────────────────────────────────────

function MilestoneDetailPanel({ milestones }: { milestones: MilestoneDetail[] }) {
  return (
    <div className="bg-surface-2 border border-t-border rounded-lg p-4 mt-1">
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs text-muted font-medium">Milestone Forecast Detail</span>
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="text-muted">Actual</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-muted">Segment</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-violet-500" />
            <span className="text-muted">Location</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-zinc-500" />
            <span className="text-muted">Global</span>
          </span>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted text-[10px] uppercase border-b border-t-border">
            <th className="text-left py-1.5 px-2">Milestone</th>
            <th className="text-center py-1.5 px-2">Basis</th>
            <th className="text-center py-1.5 px-2">Original</th>
            <th className="text-center py-1.5 px-2">Live</th>
            <th className="text-center py-1.5 px-2">Actual</th>
            <th className="text-right py-1.5 px-2">Variance</th>
          </tr>
        </thead>
        <tbody>
          {milestones.map((m) => {
            const isCompleted = m.basis === "actual";
            const isNext = !isCompleted && milestones.findIndex(
              (ms) => ms.basis !== "actual"
            ) === milestones.indexOf(m);

            return (
              <tr
                key={m.key}
                className={`border-b border-t-border/50 ${
                  isNext ? "bg-orange-500/5" : ""
                }`}
              >
                <td className={`py-1.5 px-2 font-medium ${
                  isCompleted ? "text-green-500" : isNext ? "text-orange-400" : "text-muted"
                }`}>
                  {m.name}
                </td>
                <td className="py-1.5 px-2 text-center">
                  <ForecastBasisBadge basis={m.basis} />
                </td>
                <td className="py-1.5 px-2 text-center text-muted">
                  {formatDate(m.originalForecast)}
                </td>
                <td className={`py-1.5 px-2 text-center ${
                  isNext ? "text-orange-400" : "text-muted"
                }`}>
                  {formatDate(m.liveForecast)}
                </td>
                <td className={`py-1.5 px-2 text-center ${
                  m.actual ? "text-green-500" : "text-muted"
                }`}>
                  {formatDate(m.actual)}
                </td>
                <td className={`py-1.5 px-2 text-right font-medium ${varianceColor(m.varianceDays)}`}>
                  {varianceLabel(m.varianceDays)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────

export default function ForecastTimelinePage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data, isLoading, error, refetch } = useQuery<TimelineData>({
    queryKey: ["forecasting", "timeline"],
    queryFn: async () => {
      const res = await fetch("/api/forecasting/timeline");
      if (!res.ok) throw new Error("Failed to fetch forecast timeline");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  useSSE(() => refetch(), {
    url: "/api/stream",
    cacheKeyFilter: "projects",
  });

  useEffect(() => {
    if (!isLoading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("forecast-timeline", {});
    }
  }, [isLoading, trackDashboardView]);

  // ── Filter state ──
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [ptoMonthFilter, setPtoMonthFilter] = useState("all");
  const [varianceFilter, setVarianceFilter] = useState("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [sortField, setSortField] = useState<string>("varianceDays");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // ── Derived filter options ──
  const locations = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.projects.map((p) => p.location))].filter(Boolean).sort();
  }, [data]);

  const stages = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.projects.map((p) => p.currentStage))].filter(Boolean).sort();
  }, [data]);

  const ptoMonths = useMemo(() => {
    if (!data) return [];
    const months = new Set<string>();
    for (const p of data.projects) {
      if (p.forecastPto) months.add(p.forecastPto.substring(0, 7));
    }
    return [...months].sort();
  }, [data]);

  // ── Filtered + sorted projects ──
  const filteredProjects = useMemo(() => {
    if (!data) return [];
    let result = data.projects;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.projectNumber.toLowerCase().includes(q) ||
          p.customerName.toLowerCase().includes(q),
      );
    }
    if (locationFilter !== "all") {
      result = result.filter((p) => p.location === locationFilter);
    }
    if (stageFilter !== "all") {
      result = result.filter((p) => p.currentStage === stageFilter);
    }
    if (ptoMonthFilter !== "all") {
      result = result.filter((p) => p.forecastPto?.startsWith(ptoMonthFilter));
    }
    if (varianceFilter !== "all") {
      result = result.filter((p) => varianceBucket(p.varianceDays) === varianceFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      let aVal: number | string | null = null;
      let bVal: number | string | null = null;

      switch (sortField) {
        case "projectNumber":
          aVal = a.projectNumber;
          bVal = b.projectNumber;
          break;
        case "location":
          aVal = a.location;
          bVal = b.location;
          break;
        case "currentStage":
          aVal = a.currentStage;
          bVal = b.currentStage;
          break;
        case "forecastPto":
          aVal = a.forecastPto ?? "9999";
          bVal = b.forecastPto ?? "9999";
          break;
        case "varianceDays":
        default:
          aVal = a.varianceDays ?? -9999;
          bVal = b.varianceDays ?? -9999;
          break;
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const numA = aVal as number;
      const numB = bVal as number;
      return sortDir === "asc" ? numA - numB : numB - numA;
    });

    return result;
  }, [data, search, locationFilter, stageFilter, ptoMonthFilter, varianceFilter, sortField, sortDir]);

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function sortIndicator(field: string) {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  // ── Export data ──
  const exportData = useMemo(() => {
    return filteredProjects.map((p) => ({
      Project: p.projectNumber,
      Customer: p.customerName,
      Location: p.location,
      Stage: p.currentStage,
      "Next Milestone": p.nextMilestone.name,
      "Next Milestone Date": p.nextMilestone.forecastDate ?? "",
      "Forecast PTO": p.forecastPto ?? "",
      "Variance (days)": p.varianceDays ?? "",
    }));
  }, [filteredProjects]);

  if (isLoading) return <LoadingSpinner message="Computing forecasts for all projects…" />;
  if (error || !data)
    return <ErrorState message={error ? String(error) : "Failed to load forecast data"} />;

  const { summary } = data;

  return (
    <DashboardShell
      title="Forecast Timeline"
      subtitle="Milestone forecasts for all active projects"
      accentColor="blue"
      fullWidth
      lastUpdated={data.lastUpdated}
      exportData={{ data: exportData, filename: "forecast-timeline.csv" }}
    >
      {/* ── Hero Stats ───────────────────────────────────────── */}
      <div className={`grid gap-4 mb-6 stagger-grid ${
        summary.noForecast > 0 ? "grid-cols-2 md:grid-cols-5" : "grid-cols-2 md:grid-cols-4"
      }`}>
        <StatCard
          label="Active Projects"
          value={summary.total}
          subtitle="With close date"
          color="blue"
        />
        <StatCard
          label="On Track"
          value={summary.onTrack}
          subtitle={`${summary.total > 0 ? Math.round((summary.onTrack / summary.total) * 100) : 0}%`}
          color="emerald"
        />
        <StatCard
          label="At Risk"
          value={summary.atRisk}
          subtitle={`${summary.total > 0 ? Math.round((summary.atRisk / summary.total) * 100) : 0}% · 8-14d behind`}
          color="yellow"
        />
        <StatCard
          label="Behind"
          value={summary.behind}
          subtitle={`${summary.total > 0 ? Math.round((summary.behind / summary.total) * 100) : 0}% · >14d`}
          color="red"
        />
        {summary.noForecast > 0 && (
          <StatCard
            label="No Forecast"
            value={summary.noForecast}
            subtitle="Insufficient data"
            color="purple"
          />
        )}
      </div>

      {/* ── Filter Bar ───────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          type="text"
          placeholder="Search projects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-surface border border-t-border rounded-md px-3 py-1.5 text-sm text-foreground placeholder:text-muted w-48 outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="bg-surface border border-t-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none"
        >
          <option value="all">All Locations</option>
          {locations.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="bg-surface border border-t-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none"
        >
          <option value="all">All Stages</option>
          {stages.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={ptoMonthFilter}
          onChange={(e) => setPtoMonthFilter(e.target.value)}
          className="bg-surface border border-t-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none"
        >
          <option value="all">PTO: All Months</option>
          {ptoMonths.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          value={varianceFilter}
          onChange={(e) => setVarianceFilter(e.target.value)}
          className="bg-surface border border-t-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none"
        >
          <option value="all">All Variance</option>
          <option value="onTrack">On Track</option>
          <option value="atRisk">At Risk (8-14d)</option>
          <option value="behind">Behind (14d+)</option>
          <option value="noForecast">No Forecast</option>
        </select>
        <span className="text-xs text-muted ml-auto">
          Showing {filteredProjects.length} of {summary.total}
        </span>
      </div>

      {/* ── Table ─────────────────────────────────────────────── */}
      <div className="bg-surface border border-t-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 text-muted text-xs uppercase tracking-wide">
              <th
                className="text-left py-2.5 px-4 cursor-pointer hover:text-foreground"
                onClick={() => handleSort("projectNumber")}
              >
                Project{sortIndicator("projectNumber")}
              </th>
              <th
                className="text-left py-2.5 px-3 cursor-pointer hover:text-foreground"
                onClick={() => handleSort("location")}
              >
                Location{sortIndicator("location")}
              </th>
              <th
                className="text-left py-2.5 px-3 cursor-pointer hover:text-foreground"
                onClick={() => handleSort("currentStage")}
              >
                Stage{sortIndicator("currentStage")}
              </th>
              <th className="text-center py-2.5 px-3">Next Milestone</th>
              <th
                className="text-center py-2.5 px-3 cursor-pointer hover:text-foreground"
                onClick={() => handleSort("forecastPto")}
              >
                Forecast PTO{sortIndicator("forecastPto")}
              </th>
              <th
                className="text-right py-2.5 px-4 cursor-pointer hover:text-foreground"
                onClick={() => handleSort("varianceDays")}
              >
                Variance{sortIndicator("varianceDays")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredProjects.map((p) => (
              <Fragment key={p.dealId}>
                <tr
                  className={`border-b border-t-border/50 cursor-pointer transition-colors hover:bg-surface-2 ${
                    expandedRow === p.dealId ? "bg-surface-2" : ""
                  }`}
                  onClick={() =>
                    setExpandedRow((prev) => (prev === p.dealId ? null : p.dealId))
                  }
                >
                  <td className="py-2.5 px-4">
                    <div className="text-foreground font-medium">
                      {expandedRow === p.dealId ? "▾ " : "▸ "}
                      {p.projectNumber}
                    </div>
                    <div className="text-xs text-muted">{p.customerName}</div>
                  </td>
                  <td className="py-2.5 px-3 text-foreground/80">{p.location}</td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs text-white ${stagePillColor(p.currentStage)}`}
                    >
                      {p.currentStage}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <div className="text-foreground/80">{p.nextMilestone.name}</div>
                    <div className="text-xs text-muted">
                      {p.nextMilestone.forecastDate ? `~${formatDate(p.nextMilestone.forecastDate)}` : "—"}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center text-foreground/80">
                    {formatDate(p.forecastPto)}
                  </td>
                  <td className={`py-2.5 px-4 text-right font-medium ${varianceColor(p.varianceDays)}`}>
                    {varianceLabel(p.varianceDays)}
                  </td>
                </tr>
                {expandedRow === p.dealId && (
                  <tr key={`${p.dealId}-detail`} className="bg-surface-2">
                    <td colSpan={6} className="px-4 pb-4">
                      <MilestoneDetailPanel milestones={p.milestones} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filteredProjects.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted">
                  No projects match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
