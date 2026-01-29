"use client";

import { useState, useEffect, useMemo } from "react";
import DashboardShell from "@/components/DashboardShell";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RawProject {
  id: string;
  name: string;
  pbLocation?: string;
  stage: string;
  amount?: number;
  url?: string;
  closeDate?: string;
  constructionScheduleDate?: string;
  constructionCompleteDate?: string;
  forecastedInstallDate?: string;
  forecastedInspectionDate?: string;
  forecastedPtoDate?: string;
  inspectionPassDate?: string;
  ptoGrantedDate?: string;
}

interface TransformedProject {
  id: string;
  name: string;
  pb_location: string;
  stage: string;
  amount: number;
  url?: string;
  close_date?: string;
  construction_complete?: string;
  inspection_pass?: string;
  pto_granted?: string;
  forecast_install: string | null;
  forecast_inspection: string | null;
  forecast_pto: string | null;
  days_since_close: number;
}

interface TimelineMarker {
  date: Date;
  label: string;
}

interface TimelineRange {
  start: Date;
  end: Date;
}

interface Stats {
  thisMonth: number;
  thisMonthValue: number;
  nextMonth: number;
  nextMonthValue: number;
  overdue: number;
}

type ViewMode = "week" | "month" | "quarter";
type Milestone = "install" | "inspection" | "pto";
type SortOption = "date" | "amount" | "location";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const LOCATION_COLORS: Record<string, string> = {
  Westminster: "#3B82F6",
  Centennial: "#10B981",
  "Colorado Springs": "#F59E0B",
  "San Luis Obispo": "#8B5CF6",
  Camarillo: "#EC4899",
  Unknown: "#6B7280",
};

const LOCATION_NAMES = [
  "Westminster",
  "Centennial",
  "Colorado Springs",
  "San Luis Obispo",
  "Camarillo",
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function transformProject(p: RawProject): TransformedProject {
  const now = new Date();
  const closeDate = p.closeDate ? new Date(p.closeDate) : null;
  const daysSinceClose = closeDate
    ? Math.floor((now.getTime() - closeDate.getTime()) / MS_PER_DAY)
    : 0;

  const forecastInstall =
    p.forecastedInstallDate ||
    p.constructionScheduleDate ||
    (closeDate
      ? new Date(closeDate.getTime() + 75 * MS_PER_DAY)
          .toISOString()
          .split("T")[0]
      : null);

  const forecastInspection =
    p.forecastedInspectionDate ||
    (closeDate
      ? new Date(closeDate.getTime() + 114 * MS_PER_DAY)
          .toISOString()
          .split("T")[0]
      : null);

  const forecastPto =
    p.forecastedPtoDate ||
    (closeDate
      ? new Date(closeDate.getTime() + 139 * MS_PER_DAY)
          .toISOString()
          .split("T")[0]
      : null);

  return {
    id: p.id,
    name: p.name,
    pb_location: p.pbLocation || "Unknown",
    stage: p.stage,
    amount: p.amount || 0,
    url: p.url,
    close_date: p.closeDate,
    construction_complete: p.constructionCompleteDate,
    inspection_pass: p.inspectionPassDate,
    pto_granted: p.ptoGrantedDate,
    forecast_install: forecastInstall,
    forecast_inspection: forecastInspection,
    forecast_pto: forecastPto,
    days_since_close: daysSinceClose,
  };
}

function getLocationColor(location: string): string {
  return LOCATION_COLORS[location] || "#6B7280";
}

function getForecastDate(
  project: TransformedProject,
  milestone: Milestone
): string | null {
  if (milestone === "install") return project.forecast_install;
  if (milestone === "inspection") return project.forecast_inspection;
  return project.forecast_pto;
}

function getMilestoneLabel(milestone: Milestone): string {
  if (milestone === "install") return "Installation";
  if (milestone === "inspection") return "Inspection";
  return "PTO";
}

function getMilestoneMarkerLetter(milestone: Milestone): string {
  if (milestone === "install") return "I";
  if (milestone === "inspection") return "X";
  return "P";
}

function isMilestoneCompleted(
  project: TransformedProject,
  milestone: Milestone
): boolean {
  if (milestone === "install") return !!project.construction_complete;
  if (milestone === "inspection") return !!project.inspection_pass;
  return !!project.pto_granted;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PipelineTimelinePage() {
  const [projects, setProjects] = useState<TransformedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [selectedLocation, setSelectedLocation] = useState("all");
  const [milestone, setMilestone] = useState<Milestone>("pto");
  const [sortBy, setSortBy] = useState<SortOption>("date");

  const today = useMemo(() => new Date(), []);

  /* ----- Data fetching ----- */

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const response = await fetch("/api/projects?context=executive");
        if (!response.ok) throw new Error("Failed to fetch data");
        const data = await response.json();
        setProjects(
          (data.projects as RawProject[]).map(transformProject)
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

  /* ----- Derived data ----- */

  const locations = useMemo(() => {
    const locs = [...new Set(projects.map((p) => p.pb_location))]
      .filter((l) => l !== "Unknown")
      .sort();
    return ["all", ...locs];
  }, [projects]);

  const filteredProjects = useMemo(() => {
    let filtered = projects.filter((p) => {
      if (selectedLocation !== "all" && p.pb_location !== selectedLocation)
        return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (sortBy === "date") {
        const dateA = getForecastDate(a, milestone);
        const dateB = getForecastDate(b, milestone);
        if (!dateA) return 1;
        if (!dateB) return -1;
        return new Date(dateA).getTime() - new Date(dateB).getTime();
      } else if (sortBy === "amount") {
        return (b.amount || 0) - (a.amount || 0);
      } else {
        return (a.pb_location || "").localeCompare(b.pb_location || "");
      }
    });

    return filtered.slice(0, 100);
  }, [projects, selectedLocation, milestone, sortBy]);

  const timelineRange: TimelineRange = useMemo(() => {
    const dates = filteredProjects
      .map((p) => {
        const d = getForecastDate(p, milestone);
        return d ? new Date(d) : null;
      })
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()));

    if (dates.length === 0) {
      return {
        start: today,
        end: new Date(today.getTime() + 90 * MS_PER_DAY),
      };
    }

    const minDate = new Date(
      Math.min(...dates.map((d) => d.getTime()))
    );
    const maxDate = new Date(
      Math.max(...dates.map((d) => d.getTime()))
    );
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 14);

    return { start: minDate, end: maxDate };
  }, [filteredProjects, milestone, today]);

  const timelineMarkers: TimelineMarker[] = useMemo(() => {
    const markers: TimelineMarker[] = [];
    const { start, end } = timelineRange;
    const current = new Date(start);

    while (current <= end) {
      if (viewMode === "week") {
        markers.push({
          date: new Date(current),
          label: current.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          }),
        });
        current.setDate(current.getDate() + 7);
      } else if (viewMode === "month") {
        markers.push({
          date: new Date(current),
          label: current.toLocaleDateString("en-US", {
            month: "short",
            year: "2-digit",
          }),
        });
        current.setMonth(current.getMonth() + 1);
      } else {
        markers.push({
          date: new Date(current),
          label: `Q${Math.floor(current.getMonth() / 3) + 1} ${current.getFullYear()}`,
        });
        current.setMonth(current.getMonth() + 3);
      }
    }
    return markers;
  }, [timelineRange, viewMode]);

  /* ----- Position & color helpers ----- */

  function getDatePosition(dateStr: string | null | undefined): number {
    if (!dateStr) return 0;
    const date = new Date(dateStr);
    const { start, end } = timelineRange;
    const totalDays =
      (end.getTime() - start.getTime()) / MS_PER_DAY;
    const daysFromStart =
      (date.getTime() - start.getTime()) / MS_PER_DAY;
    return Math.max(0, Math.min(100, (daysFromStart / totalDays) * 100));
  }

  function getStatusColor(project: TransformedProject): string {
    if (isMilestoneCompleted(project, milestone)) return "#10B981";

    const forecastDate = getForecastDate(project, milestone);
    if (!forecastDate) return "#6B7280";

    const daysUntil = Math.ceil(
      (new Date(forecastDate).getTime() - today.getTime()) / MS_PER_DAY
    );
    if (daysUntil < 0) return "#EF4444";
    if (daysUntil <= 14) return "#F59E0B";
    return "#10B981";
  }

  /* ----- Stats ----- */

  const stats: Stats = useMemo(() => {
    const thisMonth = filteredProjects.filter((p) => {
      const d = getForecastDate(p, milestone);
      if (!d) return false;
      const date = new Date(d);
      return (
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear()
      );
    });

    const nextMonthRef = new Date(today);
    nextMonthRef.setMonth(nextMonthRef.getMonth() + 1);

    const nextMonth = filteredProjects.filter((p) => {
      const d = getForecastDate(p, milestone);
      if (!d) return false;
      const date = new Date(d);
      return (
        date.getMonth() === nextMonthRef.getMonth() &&
        date.getFullYear() === nextMonthRef.getFullYear()
      );
    });

    const overdue = filteredProjects.filter((p) => {
      if (isMilestoneCompleted(p, milestone)) return false;
      const d = getForecastDate(p, milestone);
      if (!d) return false;
      return new Date(d) < today;
    });

    return {
      thisMonth: thisMonth.length,
      thisMonthValue: thisMonth.reduce((sum, p) => sum + (p.amount || 0), 0),
      nextMonth: nextMonth.length,
      nextMonthValue: nextMonth.reduce(
        (sum, p) => sum + (p.amount || 0),
        0
      ),
      overdue: overdue.length,
    };
  }, [filteredProjects, milestone, today]);

  const milestoneLabel = getMilestoneLabel(milestone);

  /* ----- Loading state ----- */

  if (loading) {
    return (
      <DashboardShell title="Pipeline Timeline" accentColor="blue">
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
            <p className="text-zinc-400">Loading timeline data...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  /* ----- Error state ----- */

  if (error) {
    return (
      <DashboardShell title="Pipeline Timeline" accentColor="blue">
        <div className="flex items-center justify-center py-32">
          <div className="text-center bg-[#12121a] border border-zinc-800 rounded-xl p-8">
            <div className="text-red-400 text-4xl mb-4">!</div>
            <h2 className="text-xl font-bold text-white mb-2">
              Failed to Load Data
            </h2>
            <p className="text-zinc-400 mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  /* ----- Main render ----- */

  const todayPosition = getDatePosition(today.toISOString());

  return (
    <DashboardShell
      title="Pipeline Timeline"
      subtitle={`Visual timeline of ${milestoneLabel.toLowerCase()} forecasts`}
      accentColor="blue"
      lastUpdated={lastUpdated}
      headerRight={
        <div className="inline-flex items-center px-3 py-1 bg-green-500/10 text-green-400 rounded-full text-sm">
          <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse" />
          Live Data
        </div>
      }
    >
      {/* Controls */}
      <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
          {/* Milestone selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-400">Milestone:</span>
            <select
              value={milestone}
              onChange={(e) => setMilestone(e.target.value as Milestone)}
              className="bg-[#0a0a0f] border border-zinc-700 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="install">Installation</option>
              <option value="inspection">Inspection</option>
              <option value="pto">PTO</option>
            </select>
          </div>

          {/* Location filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-400">Location:</span>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="bg-[#0a0a0f] border border-zinc-700 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc === "all" ? "All Locations" : loc}
                </option>
              ))}
            </select>
          </div>

          {/* View mode toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-400">View:</span>
            <div className="flex border border-zinc-700 rounded overflow-hidden">
              {(["week", "month", "quarter"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    viewMode === mode
                      ? "bg-blue-600 text-white"
                      : "bg-[#0a0a0f] text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Sort selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-400">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="bg-[#0a0a0f] border border-zinc-700 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="date">By Date</option>
              <option value="amount">By Value</option>
              <option value="location">By Location</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-400">
            {stats.thisMonth}
          </div>
          <div className="text-sm text-zinc-400">This Month</div>
          <div className="text-xs text-zinc-600">
            ${(stats.thisMonthValue / 1000).toFixed(0)}k value
          </div>
        </div>
        <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-400">
            {stats.nextMonth}
          </div>
          <div className="text-sm text-zinc-400">Next Month</div>
          <div className="text-xs text-zinc-600">
            ${(stats.nextMonthValue / 1000).toFixed(0)}k value
          </div>
        </div>
        <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-400">
            {stats.overdue}
          </div>
          <div className="text-sm text-zinc-400">Overdue</div>
        </div>
        <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-white">
            {filteredProjects.length}
          </div>
          <div className="text-sm text-zinc-400">Total Projects</div>
        </div>
        <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-purple-400">
            $
            {(
              filteredProjects.reduce((sum, p) => sum + (p.amount || 0), 0) /
              1_000_000
            ).toFixed(1)}
            M
          </div>
          <div className="text-sm text-zinc-400">Pipeline Value</div>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-3 mb-4 flex flex-wrap gap-4 items-center">
        <span className="text-sm font-medium text-zinc-400">Locations:</span>
        {LOCATION_NAMES.map((loc) => (
          <div key={loc} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded"
              style={{ backgroundColor: getLocationColor(loc) }}
            />
            <span className="text-xs text-zinc-400">{loc}</span>
          </div>
        ))}
        <span className="mx-4 text-zinc-700">|</span>
        <span className="text-sm font-medium text-zinc-400">Status:</span>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-red-500" />
          <span className="text-xs text-zinc-400">Overdue</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-yellow-500" />
          <span className="text-xs text-zinc-400">&le;14 days</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-green-500" />
          <span className="text-xs text-zinc-400">On track</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-[#12121a] border border-zinc-800 rounded-lg overflow-x-auto">
        <div className="min-w-[800px]">
        {/* Timeline Header */}
        <div className="flex border-b border-zinc-800 bg-[#0a0a0f] sticky top-[72px] z-10">
          <div className="w-64 flex-shrink-0 px-4 py-2 font-medium text-zinc-300 border-r border-zinc-800 text-sm">
            Project
          </div>
          <div className="flex-1 relative">
            <div className="flex">
              {timelineMarkers.map((marker, i) => (
                <div
                  key={i}
                  className="flex-1 text-center text-xs text-zinc-500 py-2 border-l border-zinc-800 first:border-l-0"
                >
                  {marker.label}
                </div>
              ))}
            </div>
            {/* Today marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
              style={{ left: `${todayPosition}%` }}
            >
              <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[10px] px-1 rounded">
                Today
              </div>
            </div>
          </div>
        </div>

        {/* Timeline Rows */}
        <div className="max-h-[600px] overflow-y-auto">
          {filteredProjects.map((project, idx) => {
            const forecastDate = getForecastDate(project, milestone);
            const closePos = getDatePosition(project.close_date);
            const forecastPos = getDatePosition(forecastDate);
            const barLeft = Math.min(closePos, forecastPos);
            const barWidth = Math.abs(forecastPos - closePos);

            return (
              <div
                key={project.id}
                className={`flex border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${
                  idx % 2 === 0 ? "bg-[#12121a]" : "bg-[#0e0e16]"
                }`}
              >
                {/* Project name */}
                <div className="w-64 flex-shrink-0 px-4 py-2 border-r border-zinc-800">
                  <a
                    href={project.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-400 hover:text-blue-300 hover:underline truncate block transition-colors"
                  >
                    {project.name.split("|")[0].trim()}
                  </a>
                  <div className="text-xs text-zinc-500 truncate">
                    {project.pb_location} - $
                    {(project.amount / 1000).toFixed(0)}k
                  </div>
                </div>

                {/* Timeline bar area */}
                <div className="flex-1 relative py-2 px-2">
                  {/* Close date dot */}
                  <div
                    className="absolute w-2 h-2 rounded-full bg-zinc-500 top-1/2 -translate-y-1/2 z-[5]"
                    style={{ left: `${closePos}%` }}
                    title={`Closed: ${project.close_date ? new Date(project.close_date).toLocaleDateString() : "N/A"}`}
                  />

                  {/* Horizontal bar from close to forecast */}
                  <div
                    className="absolute h-3 rounded top-1/2 -translate-y-1/2 transition-all duration-200 hover:brightness-110 hover:scale-y-[1.2]"
                    style={{
                      left: `${barLeft}%`,
                      width: `${barWidth}%`,
                      backgroundColor: getLocationColor(project.pb_location),
                      opacity: 0.7,
                    }}
                  />

                  {/* Milestone marker */}
                  <div
                    className="absolute w-4 h-4 rounded-full top-1/2 -translate-y-1/2 z-10 flex items-center justify-center text-white text-[10px] font-bold"
                    style={{
                      left: `calc(${forecastPos}% - 8px)`,
                      backgroundColor: getStatusColor(project),
                    }}
                    title={`${milestoneLabel}: ${forecastDate ? new Date(forecastDate).toLocaleDateString() : "N/A"}`}
                  >
                    {getMilestoneMarkerLetter(milestone)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-sm text-zinc-600 mt-4">
        Showing {filteredProjects.length} projects &mdash; Data synced from
        HubSpot &mdash; Auto-refreshes every 5 minutes
      </div>
    </DashboardShell>
  );
}
