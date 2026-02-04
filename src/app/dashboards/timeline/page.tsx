"use client";

import { useState, useMemo } from "react";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { LiveIndicator } from "@/components/ui/LiveIndicator";
import { useProjectData } from "@/hooks/useProjectData";
import { transformProject } from "@/lib/transforms";
import { formatCurrencyCompact } from "@/lib/format";
import { STAGE_COLORS } from "@/lib/constants";
import type { RawProject, TransformedProject } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const MS_PER_DAY = 86_400_000;

function monthsBetween(startDate: Date, endDate: Date): number {
  return (
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth())
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function TimelineViewPage() {
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterStage, setFilterStage] = useState("all");
  const [zoomLevel, setZoomLevel] = useState<"month" | "quarter">("month");

  const { data: projectData, loading, error, lastUpdated, refetch } = useProjectData<TransformedProject[]>({
    params: { context: "executive" },
    transform: (res: unknown) => ((res as { projects: RawProject[] }).projects || []).map(transformProject),
  });

  const allProjects = projectData || [];

  /* ---- derived data ---- */

  const locations = useMemo(
    () => [...new Set(allProjects.map((p) => p.pb_location))].filter((l) => l !== "Unknown").sort(),
    [allProjects]
  );

  const stages = useMemo(
    () => [...new Set(allProjects.map((p) => p.stage))].sort(),
    [allProjects]
  );

  const filteredProjects = useMemo(() => {
    return allProjects.filter((p) => {
      if (filterLocation !== "all" && p.pb_location !== filterLocation) return false;
      if (filterStage !== "all" && p.stage !== filterStage) return false;
      return true;
    });
  }, [allProjects, filterLocation, filterStage]);

  // Timeline range
  const timelineRange = useMemo(() => {
    if (filteredProjects.length === 0) return null;

    const today = new Date();
    let earliest = today;
    let latest = today;

    filteredProjects.forEach((p) => {
      if (p.close_date) {
        const d = new Date(p.close_date);
        if (d < earliest) earliest = d;
      }
      if (p.forecast_pto) {
        const d = new Date(p.forecast_pto);
        if (d > latest) latest = d;
      }
    });

    // Add some padding
    const start = new Date(earliest);
    start.setMonth(start.getMonth() - 1);
    start.setDate(1);
    const end = new Date(latest);
    end.setMonth(end.getMonth() + 2);
    end.setDate(0);

    const totalDays = Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY);
    const months: { label: string; start: Date; end: Date }[] = [];
    const cursor = new Date(start);

    while (cursor < end) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      months.push({
        label: cursor.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        start: new Date(cursor),
        end: monthEnd > end ? end : monthEnd,
      });
      cursor.setMonth(cursor.getMonth() + 1);
      cursor.setDate(1);
    }

    return { start, end, totalDays, months };
  }, [filteredProjects]);

  // Project timeline items
  const timelineItems = useMemo(() => {
    if (!timelineRange) return [];

    return filteredProjects
      .filter((p) => p.close_date)
      .map((p) => {
        const startDate = new Date(p.close_date!);
        const endDate = p.forecast_pto ? new Date(p.forecast_pto) : new Date();

        const startPct = Math.max(
          0,
          ((startDate.getTime() - timelineRange.start.getTime()) / MS_PER_DAY / timelineRange.totalDays) * 100
        );
        const durationPct = Math.max(
          1,
          (((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) / timelineRange.totalDays) * 100
        );

        const stageColor = STAGE_COLORS[p.stage]?.tw || "bg-zinc-500";
        const isOverdue = p.days_to_pto !== null && p.days_to_pto < 0;

        return {
          ...p,
          startPct,
          durationPct: Math.min(durationPct, 100 - startPct),
          stageColor,
          isOverdue,
          displayName: p.name.split("|")[0].trim(),
        };
      })
      .sort((a, b) => a.startPct - b.startPct);
  }, [filteredProjects, timelineRange]);

  /* ---- export data ---- */

  const exportData = useMemo(() => {
    return filteredProjects.map((p) => ({
      name: p.name.split("|")[0].trim(),
      location: p.pb_location,
      stage: p.stage,
      amount: p.amount,
      closeDate: p.close_date || "",
      forecastInstall: p.forecast_install || "",
      forecastInspection: p.forecast_inspection || "",
      forecastPto: p.forecast_pto || "",
    }));
  }, [filteredProjects]);

  /* ---- loading & error ---- */

  if (loading) {
    return (
      <DashboardShell title="Timeline View" subtitle="Gantt-style project timeline" accentColor="purple">
        <LoadingSpinner color="purple" message="Loading timeline data..." />
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Timeline View" subtitle="Gantt-style project timeline" accentColor="purple">
        <ErrorState message={error} onRetry={refetch} color="purple" />
      </DashboardShell>
    );
  }

  /* ---- main render ---- */

  return (
    <DashboardShell
      title="Timeline View"
      subtitle="Gantt-style project timeline"
      accentColor="purple"
      lastUpdated={lastUpdated}
      breadcrumbs={[{ label: "Dashboards", href: "/" }, { label: "Timeline" }]}
      exportData={{ data: exportData, filename: "timeline-view" }}
      headerRight={
        <div className="flex items-center gap-3">
          <LiveIndicator label="Auto-Refresh" />
          <select
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white"
          >
            <option value="all">All Locations</option>
            {locations.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white"
          >
            <option value="all">All Stages</option>
            {stages.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div className="flex bg-zinc-800 border border-zinc-700 rounded overflow-hidden">
            <button
              onClick={() => setZoomLevel("month")}
              className={`px-3 py-1.5 text-xs ${zoomLevel === "month" ? "bg-purple-600 text-white" : "text-zinc-400"}`}
            >
              Month
            </button>
            <button
              onClick={() => setZoomLevel("quarter")}
              className={`px-3 py-1.5 text-xs ${zoomLevel === "quarter" ? "bg-purple-600 text-white" : "text-zinc-400"}`}
            >
              Quarter
            </button>
          </div>
        </div>
      }
    >
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-white">{filteredProjects.length}</div>
          <div className="text-sm text-zinc-400">Total Projects</div>
        </div>
        <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-emerald-400">
            {formatCurrencyCompact(filteredProjects.reduce((s, p) => s + (p.amount || 0), 0))}
          </div>
          <div className="text-sm text-zinc-400">Pipeline Value</div>
        </div>
        <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-400">
            {filteredProjects.filter((p) => p.days_to_pto !== null && p.days_to_pto < 0).length}
          </div>
          <div className="text-sm text-zinc-400">PTO Overdue</div>
        </div>
        <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-purple-400">
            {timelineRange ? timelineRange.months.length : 0}
          </div>
          <div className="text-sm text-zinc-400">Month Span</div>
        </div>
      </div>

      {/* Timeline Chart */}
      {timelineRange && (
        <div className="bg-[#12121a] rounded-xl border border-zinc-800 overflow-hidden mb-6">
          {/* Month headers */}
          <div className="flex border-b border-zinc-800 sticky top-0 bg-[#12121a] z-10">
            <div className="w-48 shrink-0 px-4 py-3 text-xs font-medium text-zinc-400 border-r border-zinc-800">
              Project
            </div>
            <div className="flex-1 flex relative">
              {timelineRange.months.map((month, i) => {
                const isToday = month.start <= new Date() && month.end >= new Date();
                return (
                  <div
                    key={`${month.label}-${i}`}
                    className={`flex-1 px-2 py-3 text-xs text-center font-medium border-r border-zinc-800/50 last:border-0 ${
                      isToday ? "bg-purple-500/10 text-purple-400" : "text-zinc-500"
                    }`}
                  >
                    {month.label}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Project rows */}
          <div className="max-h-[60vh] overflow-y-auto">
            {timelineItems.length === 0 ? (
              <div className="text-center py-12 text-zinc-500 text-sm">
                No projects with timeline data
              </div>
            ) : (
              timelineItems.slice(0, 50).map((item) => (
                <div
                  key={item.id}
                  className="flex border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors group"
                >
                  {/* Project name */}
                  <div className="w-48 shrink-0 px-4 py-2.5 border-r border-zinc-800 flex items-center">
                    <div className="min-w-0">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-blue-400 hover:underline truncate block"
                      >
                        {item.displayName}
                      </a>
                      <div className="text-[10px] text-zinc-500 truncate">
                        {item.pb_location}
                      </div>
                    </div>
                  </div>
                  {/* Timeline bar */}
                  <div className="flex-1 relative py-2 px-1">
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 h-5 rounded-full ${
                        item.isOverdue ? "bg-red-500/80" : item.stageColor
                      } group-hover:opacity-90 transition-opacity`}
                      style={{
                        left: `${item.startPct}%`,
                        width: `${Math.max(item.durationPct, 0.5)}%`,
                      }}
                      title={`${item.displayName} (${item.stage}) - ${formatCurrencyCompact(item.amount)}`}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {timelineItems.length > 50 && (
            <div className="px-4 py-2 text-center text-xs text-zinc-500 border-t border-zinc-800">
              Showing 50 of {timelineItems.length} projects
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-4">
        <div className="text-xs text-zinc-400 mb-3">Stage Legend</div>
        <div className="flex flex-wrap gap-3">
          {Object.entries(STAGE_COLORS).map(([stage, colors]) => (
            <div key={stage} className="flex items-center gap-1.5 text-xs text-zinc-400">
              <div className={`w-3 h-3 rounded-full ${colors.tw}`} />
              {stage}
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            Overdue
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
