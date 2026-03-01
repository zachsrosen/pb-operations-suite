"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { MonthlyBarChart, aggregateMonthly } from "@/components/ui/MonthlyBarChart";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useClippingAnalyticsFilters } from "@/stores/dashboard-filters";
import {
  ClippingAnalysis,
  analyzeClipping,
  getSeasonalTSRF,
  DEFAULT_TSRF,
} from "@/lib/clipping";

// ============== COMPONENT ==============

const RISK_COLORS = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  moderate: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  none: "bg-green-500/20 text-green-400 border-green-500/30",
};

export default function ClippingAnalyticsPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  // Toggle state for system performance review
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [localOverrides, setLocalOverrides] = useState<Record<string, boolean>>({});

  // ---- Filter state ----
  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = useClippingAnalyticsFilters();

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("clipping-analytics", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // ---- Filter option lists (built from full project set) ----
  const stageOptions: FilterOption[] = useMemo(
    () => [...new Set(safeProjects.map((p) => p.stage || ""))].filter(Boolean).sort().map((s) => ({ value: s, label: s })),
    [safeProjects]
  );
  const locationOptions: FilterOption[] = useMemo(
    () => [...new Set(safeProjects.map((p) => p.pbLocation || ""))].filter(Boolean).sort().map((s) => ({ value: s, label: s })),
    [safeProjects]
  );

  const hasActiveFilters =
    persistedFilters.locations.length > 0 ||
    persistedFilters.stages.length > 0;

  // ---- Filtered projects ----
  const filteredProjects = useMemo(() => {
    let list = safeProjects;
    if (persistedFilters.locations.length > 0) {
      list = list.filter((p) => persistedFilters.locations.includes(p.pbLocation || ""));
    }
    if (persistedFilters.stages.length > 0) {
      list = list.filter((p) => persistedFilters.stages.includes(p.stage || ""));
    }
    return list;
  }, [safeProjects, persistedFilters]);

  const handleTogglePerformanceReview = useCallback(
    async (project: RawProject) => {
      const current = localOverrides[project.id] ?? project.systemPerformanceReview ?? false;
      const newValue = !current;
      setTogglingIds((prev) => new Set(prev).add(project.id));
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            properties: { system_performance_review: newValue ? "true" : "false" },
          }),
        });
        if (res.ok) {
          setLocalOverrides((prev) => ({ ...prev, [project.id]: newValue }));
        }
      } catch (err) {
        console.error("Failed to update system performance review:", err);
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(project.id);
          return next;
        });
      }
    },
    [localOverrides]
  );

  // Clipping analysis across filtered projects with equipment data
  const clippingAnalyses = useMemo(() => {
    const analyses = filteredProjects
      .map((p) => analyzeClipping(p))
      .filter((a): a is ClippingAnalysis => a !== null);

    const atRisk = analyses.filter((a) => a.riskLevel !== "none");
    const high = analyses.filter((a) => a.riskLevel === "high");
    const moderate = analyses.filter((a) => a.riskLevel === "moderate");
    const low = analyses.filter((a) => a.riskLevel === "low");
    const withBattery = atRisk.filter((a) => a.batteryKwh > 0);

    return { all: analyses, atRisk, high, moderate, low, withBattery };
  }, [filteredProjects]);

  // Historical trend: flagged projects by month (closeDate)
  const flaggedTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects
        .filter((p) => {
          const flagged = localOverrides[p.id] ?? p.systemPerformanceReview;
          return flagged && p.closeDate;
        })
        .map((p) => ({ date: p.closeDate!, amount: p.amount || 0 })),
      6
    ),
    [filteredProjects, localOverrides]
  );

  // Equipment performance aggregations
  const equipmentStats = useMemo(() => {
    const byInverterModel: Record<string, { count: number; atRisk: number; avgRatio: number; ratios: number[] }> = {};
    const byPanelWattage: Record<string, { count: number; atRisk: number; avgRatio: number; ratios: number[] }> = {};
    let withBattery = 0;
    let withBatteryMitigated = 0;
    let withoutBattery = 0;

    clippingAnalyses.all.forEach((a) => {
      // By inverter model
      const invKey = a.inverterModel || "Unknown";
      if (!byInverterModel[invKey]) byInverterModel[invKey] = { count: 0, atRisk: 0, avgRatio: 0, ratios: [] };
      byInverterModel[invKey].count += 1;
      byInverterModel[invKey].ratios.push(a.nameplateDcAcRatio);
      if (a.riskLevel !== "none") byInverterModel[invKey].atRisk += 1;

      // By panel wattage
      const wattKey = `${a.panelWattage}W`;
      if (!byPanelWattage[wattKey]) byPanelWattage[wattKey] = { count: 0, atRisk: 0, avgRatio: 0, ratios: [] };
      byPanelWattage[wattKey].count += 1;
      byPanelWattage[wattKey].ratios.push(a.nameplateDcAcRatio);
      if (a.riskLevel !== "none") byPanelWattage[wattKey].atRisk += 1;

      // Battery stats
      if (a.batteryKwh > 0) {
        withBattery += 1;
        // Check if battery mitigated the risk (risk was downgraded)
        if (a.riskLevel === "none" || a.riskLevel === "low") withBatteryMitigated += 1;
      } else {
        withoutBattery += 1;
      }
    });

    // Calculate averages
    Object.values(byInverterModel).forEach((v) => {
      v.avgRatio = v.ratios.length > 0 ? v.ratios.reduce((a, b) => a + b, 0) / v.ratios.length : 0;
    });
    Object.values(byPanelWattage).forEach((v) => {
      v.avgRatio = v.ratios.length > 0 ? v.ratios.reduce((a, b) => a + b, 0) / v.ratios.length : 0;
    });

    return {
      byInverterModel: Object.entries(byInverterModel).sort((a, b) => b[1].count - a[1].count).slice(0, 10),
      byPanelWattage: Object.entries(byPanelWattage).sort((a, b) => b[1].count - a[1].count).slice(0, 10),
      withBattery,
      withBatteryMitigated,
      withoutBattery,
    };
  }, [clippingAnalyses]);

  // Export
  const exportRows = useMemo(
    () => clippingAnalyses.all.map((a) => {
      const proj = filteredProjects.find((p) => p.id === a.projectId);
      return {
      project: a.projectName,
      location: proj?.pbLocation || "",
      stage: a.stage,
      designStatus: a.designStatus || "",
      panelCount: a.panelCount,
      panelWattage: a.panelWattage,
      dcCapacityKw: a.dcCapacityKw.toFixed(2),
      acCapacityKw: a.acCapacityKw.toFixed(2),
      nameplateDcAc: a.nameplateDcAcRatio.toFixed(3),
      summerDcAc: a.estimatedSummerDcAcRatio.toFixed(3),
      batteryKwh: a.batteryKwh.toFixed(0),
      riskLevel: a.riskLevel,
      inverterModel: a.inverterModel,
    };
    }),
    [clippingAnalyses, filteredProjects]
  );

  return (
    <DashboardShell
      title="Clipping & System Analytics"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "clipping-analytics.csv" }}
      fullWidth
    >
      {/* Filter Row */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={persistedFilters.locations}
          onChange={(v) => setPersisted({ ...persistedFilters, locations: v })}
          accentColor="indigo"
        />
        <MultiSelectFilter
          label="Deal Stage"
          options={stageOptions}
          selected={persistedFilters.stages}
          onChange={(v) => setPersisted({ ...persistedFilters, stages: v })}
          accentColor="indigo"
        />
        {hasActiveFilters && (
          <button
            onClick={() => clearFilters()}
            className="px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-grid">
        <MiniStat label="Analyzed" value={loading ? null : clippingAnalyses.all.length} />
        <MiniStat label="High Risk" value={loading ? null : clippingAnalyses.high.length} alert={clippingAnalyses.high.length > 0} />
        <MiniStat label="Moderate Risk" value={loading ? null : clippingAnalyses.moderate.length} alert={clippingAnalyses.moderate.length > 3} />
        <MiniStat label="Low Risk" value={loading ? null : clippingAnalyses.low.length} />
        <MiniStat label="Battery Mitigated" value={loading ? null : equipmentStats.withBatteryMitigated} />
      </div>

      {/* Explanation */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
        <p className="text-sm text-muted leading-relaxed">
          <span className="text-amber-400 font-medium">How it works:</span> Without EVIA 30-min shade profiles,
          annual-average TSRF suppresses summer peaks. This tool decomposes TSRF seasonally — summer TSRF is ~{Math.round(getSeasonalTSRF(DEFAULT_TSRF) * 100)}%
          vs annual avg ~{Math.round(DEFAULT_TSRF * 100)}% — revealing systems where summer DC output exceeds inverter AC capacity.
          DC-coupled batteries (PW3) can absorb ~5kW DC excess before true clipping occurs.
        </p>
      </div>

      {/* At-Risk Projects Table */}
      <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden">
        <div className="p-4 border-b border-t-border">
          <h2 className="text-lg font-semibold text-amber-400">
            At-Risk Projects ({clippingAnalyses.atRisk.length})
          </h2>
        </div>
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : clippingAnalyses.atRisk.length === 0 ? (
          <div className="p-8 text-center text-muted">
            {clippingAnalyses.all.length === 0
              ? "No projects with equipment data available for clipping analysis."
              : "No clipping risk detected across analyzed projects."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                  <th className="p-3">Project</th>
                  <th className="p-3">Deal Stage</th>
                  <th className="p-3">Equipment</th>
                  <th className="p-3 text-center">DC kW</th>
                  <th className="p-3 text-center">AC kW</th>
                  <th className="p-3 text-center">Nameplate DC/AC</th>
                  <th className="p-3 text-center">Summer DC/AC</th>
                  <th className="p-3 text-center">Battery</th>
                  <th className="p-3 text-center">Risk</th>
                  <th className="p-3 text-center">Flag for Review</th>
                </tr>
              </thead>
              <tbody>
                {clippingAnalyses.atRisk
                  .sort((a, b) => b.nameplateDcAcRatio - a.nameplateDcAcRatio)
                  .map((analysis) => {
                    const project = safeProjects.find((p) => p.id === analysis.projectId);
                    const isToggling = project ? togglingIds.has(project.id) : false;
                    const sprValue = project
                      ? (localOverrides[project.id] ?? project.systemPerformanceReview ?? false)
                      : false;
                    return (
                      <tr key={analysis.projectId} className="border-b border-t-border/50 hover:bg-surface-2/50">
                        <td className="p-3">
                          <a
                            href={analysis.projectUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-foreground hover:text-amber-400"
                          >
                            {analysis.projectName.split("|")[0].trim()}
                          </a>
                        </td>
                        <td className="p-3 text-muted text-xs">{analysis.stage || "\u2014"}</td>
                        <td className="p-3 text-xs text-muted">
                          {analysis.panelCount}× {analysis.panelWattage}W
                          <div>{analysis.inverterCount}× inv</div>
                        </td>
                        <td className="p-3 text-center font-mono text-foreground/80">
                          {analysis.dcCapacityKw.toFixed(1)}
                        </td>
                        <td className="p-3 text-center font-mono text-foreground/80">
                          {analysis.acCapacityKw.toFixed(1)}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`font-mono font-bold ${
                            analysis.nameplateDcAcRatio > 1.3 ? "text-red-400" :
                            analysis.nameplateDcAcRatio > 1.15 ? "text-amber-400" :
                            analysis.nameplateDcAcRatio > 1.0 ? "text-yellow-400" : "text-green-400"
                          }`}>
                            {analysis.nameplateDcAcRatio.toFixed(2)}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`font-mono font-bold ${
                            analysis.estimatedSummerDcAcRatio > 1.15 ? "text-red-400" :
                            analysis.estimatedSummerDcAcRatio > 1.0 ? "text-amber-400" : "text-green-400"
                          }`}>
                            {analysis.estimatedSummerDcAcRatio.toFixed(2)}
                          </span>
                          <div className="text-[10px] text-muted">~{Math.round(analysis.estimatedSummerTsrf * 100)}% TSRF</div>
                        </td>
                        <td className="p-3 text-center text-xs">
                          {analysis.batteryKwh > 0 ? (
                            <span className="text-cyan-400">{analysis.batteryKwh.toFixed(0)} kWh</span>
                          ) : (
                            <span className="text-muted/70">None</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${RISK_COLORS[analysis.riskLevel]}`}>
                            {analysis.riskLevel}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          {project ? (
                            <button
                              onClick={() => handleTogglePerformanceReview(project)}
                              disabled={isToggling}
                              title={sprValue ? "Flagged for review" : "Flag for review"}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                                isToggling
                                  ? "opacity-50 cursor-wait"
                                  : sprValue
                                    ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30"
                                    : "bg-surface-2 text-muted hover:bg-surface-2/80 hover:text-foreground"
                              }`}
                            >
                              {isToggling ? (
                                <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                              ) : sprValue ? (
                                <>⚠ Review</>
                              ) : (
                                "Flag"
                              )}
                            </button>
                          ) : (
                            <span className="text-muted/70 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Historical Trends */}
      <MonthlyBarChart
        title="Flagged Projects by Month (6 months)"
        data={flaggedTrend}
        months={6}
        accentColor="orange"
        primaryLabel="flagged"
      />

      {/* Equipment Performance Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By Inverter Model */}
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">By Inverter Model</h2>
          {equipmentStats.byInverterModel.length === 0 ? (
            <p className="text-sm text-muted italic">No inverter data.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border text-left text-muted">
                    <th className="pb-2 pr-4">Model</th>
                    <th className="pb-2 pr-4 text-right">Count</th>
                    <th className="pb-2 pr-4 text-right">Avg DC/AC</th>
                    <th className="pb-2 text-right">At Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {equipmentStats.byInverterModel.map(([model, data]) => (
                    <tr key={model} className="border-b border-t-border/50">
                      <td className="py-2 pr-4 text-foreground">{model}</td>
                      <td className="py-2 pr-4 text-right text-muted">{data.count}</td>
                      <td className="py-2 pr-4 text-right font-mono text-foreground">
                        {data.avgRatio.toFixed(2)}
                      </td>
                      <td className="py-2 text-right">
                        <span className={data.atRisk > 0 ? "text-amber-400 font-semibold" : "text-muted"}>
                          {data.atRisk}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* By Panel Wattage */}
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">By Panel Wattage</h2>
          {equipmentStats.byPanelWattage.length === 0 ? (
            <p className="text-sm text-muted italic">No panel data.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border text-left text-muted">
                    <th className="pb-2 pr-4">Wattage</th>
                    <th className="pb-2 pr-4 text-right">Count</th>
                    <th className="pb-2 pr-4 text-right">Avg DC/AC</th>
                    <th className="pb-2 text-right">At Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {equipmentStats.byPanelWattage.map(([watt, data]) => (
                    <tr key={watt} className="border-b border-t-border/50">
                      <td className="py-2 pr-4 text-foreground">{watt}</td>
                      <td className="py-2 pr-4 text-right text-muted">{data.count}</td>
                      <td className="py-2 pr-4 text-right font-mono text-foreground">
                        {data.avgRatio.toFixed(2)}
                      </td>
                      <td className="py-2 text-right">
                        <span className={data.atRisk > 0 ? "text-amber-400 font-semibold" : "text-muted"}>
                          {data.atRisk}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Battery Mitigation Summary */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">Battery Configuration Impact</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-surface-2/50 rounded-lg">
            <div className="text-2xl font-bold text-cyan-400">{equipmentStats.withBattery}</div>
            <div className="text-xs text-muted mt-1">With Battery</div>
          </div>
          <div className="text-center p-4 bg-surface-2/50 rounded-lg">
            <div className="text-2xl font-bold text-emerald-400">{equipmentStats.withBatteryMitigated}</div>
            <div className="text-xs text-muted mt-1">Battery Mitigated</div>
          </div>
          <div className="text-center p-4 bg-surface-2/50 rounded-lg">
            <div className="text-2xl font-bold text-foreground">{equipmentStats.withoutBattery}</div>
            <div className="text-xs text-muted mt-1">Without Battery</div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
