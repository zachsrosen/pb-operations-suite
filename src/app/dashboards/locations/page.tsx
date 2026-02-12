"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { LiveIndicator } from "@/components/ui/LiveIndicator";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { transformProject } from "@/lib/transforms";
import { formatCurrencyCompact } from "@/lib/format";
import { STAGE_ORDER_ASC, STAGE_COLORS, LOCATION_COLORS } from "@/lib/constants";
import type { RawProject, TransformedProject } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Local types                                                        */
/* ------------------------------------------------------------------ */

interface LocationData {
  name: string;
  count: number;
  totalValue: number;
  overdue: number;
  avgDaysInPipeline: number;
  stageCounts: Record<string, number>;
  projects: TransformedProject[];
}

/* ------------------------------------------------------------------ */
/*  Stages used for comparison                                         */
/* ------------------------------------------------------------------ */

const COMPARE_STAGES = STAGE_ORDER_ASC.filter(
  (s) => !["Close Out", "Project Complete", "Project Rejected"].includes(s)
);

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function LocationComparisonPage() {
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);

  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projectData, loading, error, lastUpdated, refetch } = useProjectData<TransformedProject[]>({
    params: { context: "executive" },
    transform: (res: unknown) => ((res as { projects: RawProject[] }).projects || []).map(transformProject),
  });

  const allProjects = useMemo(() => projectData || [], [projectData]);

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("locations", {});
    }
  }, [loading, trackDashboardView]);

  /* ---- derived data ---- */

  const locationStats: LocationData[] = useMemo(() => {
    const grouped: Record<string, TransformedProject[]> = {};
    allProjects.forEach((p) => {
      const loc = p.pb_location || "Unknown";
      if (!grouped[loc]) grouped[loc] = [];
      grouped[loc].push(p);
    });

    return Object.entries(grouped)
      .map(([name, projects]) => {
        const totalValue = projects.reduce((s, p) => s + (p.amount || 0), 0);
        const overdue = projects.filter(
          (p) => !p.pto_granted && p.days_to_pto !== null && p.days_to_pto < 0
        ).length;
        const avgDays =
          projects.reduce((s, p) => s + p.days_since_close, 0) / (projects.length || 1);
        const stageCounts: Record<string, number> = {};
        COMPARE_STAGES.forEach((s) => (stageCounts[s] = 0));
        projects.forEach((p) => {
          if (stageCounts[p.stage] !== undefined) stageCounts[p.stage]++;
        });

        return {
          name,
          count: projects.length,
          totalValue,
          overdue,
          avgDaysInPipeline: Math.round(avgDays),
          stageCounts,
          projects,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [allProjects]);

  const selectedData = useMemo(
    () => locationStats.find((l) => l.name === selectedLocation) || null,
    [locationStats, selectedLocation]
  );

  /* ---- export data ---- */

  const exportData = useMemo(() => {
    return locationStats.map((loc) => ({
      location: loc.name,
      projects: loc.count,
      totalValue: loc.totalValue,
      overdue: loc.overdue,
      avgDaysInPipeline: loc.avgDaysInPipeline,
      ...loc.stageCounts,
    }));
  }, [locationStats]);

  /* ---- loading & error ---- */

  if (loading) {
    return (
      <DashboardShell title="Location Comparison" subtitle="Compare performance across locations" accentColor="blue">
        <LoadingSpinner color="blue" message="Loading location data..." />
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Location Comparison" subtitle="Compare performance across locations" accentColor="blue">
        <ErrorState message={error} onRetry={refetch} color="blue" />
      </DashboardShell>
    );
  }

  /* ---- main render ---- */

  return (
    <DashboardShell
      title="Location Comparison"
      subtitle="Compare performance across all Photon Brothers locations"
      accentColor="blue"
      lastUpdated={lastUpdated}
      breadcrumbs={[{ label: "Dashboards", href: "/" }, { label: "Locations" }]}
      exportData={{ data: exportData, filename: "location-comparison" }}
      headerRight={
        <div className="flex items-center gap-3">
          <LiveIndicator label="Auto-Refresh" />
          <button
            onClick={refetch}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium text-foreground transition-colors"
          >
            Refresh
          </button>
        </div>
      }
    >
      {/* Location Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
        {locationStats.map((loc) => {
          const color = LOCATION_COLORS[loc.name] || { hex: "#71717a" };
          const isSelected = selectedLocation === loc.name;
          const healthPct = loc.count > 0 ? Math.round((1 - loc.overdue / loc.count) * 100) : 100;

          return (
            <button
              key={loc.name}
              onClick={() => setSelectedLocation(isSelected ? null : loc.name)}
              className={`text-left bg-surface border rounded-lg p-4 transition-all hover:bg-skeleton ${
                isSelected ? "border-blue-500 ring-1 ring-blue-500/30" : "border-t-border"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: color.hex }}
                />
                <span className="font-semibold text-foreground text-sm truncate">{loc.name}</span>
              </div>
              <div className="text-2xl font-bold text-foreground mb-1">{loc.count}</div>
              <div className="text-xs text-muted mb-2">{formatCurrencyCompact(loc.totalValue)}</div>
              <div className="flex items-center justify-between text-xs">
                <span className={`${loc.overdue > 0 ? "text-red-400" : "text-muted"}`}>
                  {loc.overdue} overdue
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded ${
                    healthPct >= 80
                      ? "bg-emerald-500/10 text-emerald-400"
                      : healthPct >= 60
                        ? "bg-yellow-500/10 text-yellow-400"
                        : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {healthPct}%
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Stage Comparison Table */}
      <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
        <h3 className="text-sm font-semibold text-foreground/80 mb-4">Stage Distribution by Location</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-t-border">
                <th className="text-left py-3 text-muted font-medium sticky left-0 bg-surface z-10">
                  Location
                </th>
                {COMPARE_STAGES.map((stage) => (
                  <th key={stage} className="text-center py-3 text-muted font-medium px-2 min-w-[80px]">
                    <span className="text-[10px] leading-tight block">{stage}</span>
                  </th>
                ))}
                <th className="text-right py-3 text-muted font-medium px-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {locationStats.map((loc) => (
                <tr
                  key={loc.name}
                  className={`border-b border-t-border/50 last:border-0 hover:bg-white/[0.02] transition-colors ${
                    selectedLocation === loc.name ? "bg-blue-500/5" : ""
                  }`}
                >
                  <td className="py-3 text-white font-medium sticky left-0 bg-surface z-10">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: (LOCATION_COLORS[loc.name] || { hex: "#71717a" }).hex }}
                      />
                      {loc.name}
                    </div>
                  </td>
                  {COMPARE_STAGES.map((stage) => {
                    const count = loc.stageCounts[stage] || 0;
                    const stageColor = STAGE_COLORS[stage];
                    return (
                      <td key={stage} className="py-3 text-center px-2">
                        {count > 0 ? (
                          <span
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-bold ${
                              stageColor ? `${stageColor.tw} bg-opacity-20` : "bg-surface-2"
                            } text-white`}
                          >
                            {count}
                          </span>
                        ) : (
                          <span className="text-muted/50">-</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-3 text-right text-foreground/80 font-bold px-2">{loc.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Location Detail */}
      {selectedData && (
        <div className="bg-surface rounded-xl border border-blue-800/40 p-5 mb-6 animate-fadeIn">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: (LOCATION_COLORS[selectedData.name] || { hex: "#71717a" }).hex }}
            />
            {selectedData.name} Detail
          </h3>

          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <div className="bg-skeleton rounded-lg p-3">
              <div className="text-2xl font-bold text-foreground">{selectedData.count}</div>
              <div className="text-xs text-muted">Total Projects</div>
            </div>
            <div className="bg-skeleton rounded-lg p-3">
              <div className="text-2xl font-bold text-emerald-400">{formatCurrencyCompact(selectedData.totalValue)}</div>
              <div className="text-xs text-muted">Pipeline Value</div>
            </div>
            <div className="bg-skeleton rounded-lg p-3">
              <div className="text-2xl font-bold text-red-400">{selectedData.overdue}</div>
              <div className="text-xs text-muted">Overdue</div>
            </div>
            <div className="bg-skeleton rounded-lg p-3">
              <div className="text-2xl font-bold text-blue-400">{selectedData.avgDaysInPipeline}d</div>
              <div className="text-xs text-muted">Avg Days in Pipeline</div>
            </div>
          </div>

          {/* Stage breakdown bar */}
          <div className="mb-5">
            <div className="text-xs text-muted mb-2">Stage Breakdown</div>
            <div className="h-6 rounded-full overflow-hidden flex bg-surface-2">
              {COMPARE_STAGES.map((stage) => {
                const count = selectedData.stageCounts[stage] || 0;
                const pct = selectedData.count > 0 ? (count / selectedData.count) * 100 : 0;
                if (pct === 0) return null;
                const color = STAGE_COLORS[stage]?.tw || "bg-zinc-600";
                return (
                  <div
                    key={stage}
                    className={`${color} transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                    title={`${stage}: ${count} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-3 mt-2">
              {COMPARE_STAGES.filter((s) => (selectedData.stageCounts[s] || 0) > 0).map((stage) => (
                <div key={stage} className="flex items-center gap-1 text-xs text-muted">
                  <div className={`w-2 h-2 rounded-full ${STAGE_COLORS[stage]?.tw || "bg-zinc-600"}`} />
                  {stage}: <span className="text-white font-medium">{selectedData.stageCounts[stage]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Projects list */}
          <div className="text-xs text-muted mb-2">Projects ({selectedData.projects.length})</div>
          <div className="max-h-80 overflow-y-auto space-y-1">
            {selectedData.projects
              .sort((a, b) => (b.amount || 0) - (a.amount || 0))
              .map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2 px-3 bg-surface-2/30 rounded hover:bg-skeleton transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline text-sm font-medium truncate block"
                    >
                      {p.name.split("|")[0].trim()}
                    </a>
                    <div className="text-xs text-muted">{p.stage}</div>
                  </div>
                  <div className="text-sm text-foreground/80 font-medium ml-2 shrink-0">
                    {formatCurrencyCompact(p.amount)}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-muted/70">
        Data synced from HubSpot &bull; Auto-refreshes every 5 minutes
      </div>
    </DashboardShell>
  );
}
