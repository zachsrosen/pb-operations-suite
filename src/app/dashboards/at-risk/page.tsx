"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { LiveIndicator } from "@/components/ui/LiveIndicator";
import { useProjectData } from "@/hooks/useProjectData";
import { transformProject } from "@/lib/transforms";
import { formatMoney, formatCurrency } from "@/lib/format";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import type { RawProject, TransformedProject, Risk, ProjectWithRisk } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Local types                                                        */
/* ------------------------------------------------------------------ */

interface RiskTypeData {
  count: number;
  value: number;
}

type SortOption = "severity" | "amount" | "days";
type RiskTypeFilter = "all" | "install" | "inspection" | "pto" | "stalled" | "blocked";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AtRiskPage() {
  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const [sortBy, setSortBy] = useState<SortOption>("severity");
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterRiskType, setFilterRiskType] = useState<RiskTypeFilter>("all");

  /* ---- data fetching ---- */

  const { data: projects, loading, error, lastUpdated, refetch } = useProjectData<TransformedProject[]>({
    params: { context: "at-risk" },
    transform: (res: unknown) => ((res as { projects: RawProject[] }).projects || []).map(transformProject),
  });

  const allProjects = useMemo(() => projects || [], [projects]);

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("at-risk", {
        projectCount: allProjects.length,
      });
    }
  }, [loading, allProjects.length, trackDashboardView]);

  /* ---- derived data ---- */

  const locations = useMemo(() => {
    const locs = [...new Set(allProjects.map((p) => p.pb_location))]
      .filter((l) => l !== "Unknown")
      .sort();
    return ["all", ...locs];
  }, [allProjects]);

  const projectsWithRisk: ProjectWithRisk[] = useMemo(() => {
    return allProjects
      .map((p) => {
        const risks: Risk[] = [];
        let riskScore = 0;

        // Install risk - only if construction NOT complete
        if (!p.construction_complete && p.days_to_install !== null) {
          if (p.days_to_install < 0) {
            risks.push({ type: "Install Overdue", days: Math.abs(p.days_to_install), severity: "critical" });
            riskScore += 100 + Math.abs(p.days_to_install);
          } else if (p.days_to_install <= 7) {
            risks.push({ type: "Install Soon", days: p.days_to_install, severity: "warning" });
            riskScore += 50 - p.days_to_install;
          }
        }

        // Inspection risk - only if inspection NOT passed
        if (!p.inspection_pass && p.days_to_inspection !== null) {
          if (p.days_to_inspection < 0) {
            risks.push({ type: "Inspection Overdue", days: Math.abs(p.days_to_inspection), severity: "critical" });
            riskScore += 80 + Math.abs(p.days_to_inspection);
          } else if (p.days_to_inspection <= 14) {
            risks.push({ type: "Inspection Soon", days: p.days_to_inspection, severity: "warning" });
            riskScore += 40 - p.days_to_inspection;
          }
        }

        // PTO risk - only if PTO NOT granted
        if (!p.pto_granted && p.days_to_pto !== null) {
          if (p.days_to_pto < 0) {
            risks.push({ type: "PTO Overdue", days: Math.abs(p.days_to_pto), severity: "critical" });
            riskScore += 60 + Math.abs(p.days_to_pto);
          } else if (p.days_to_pto <= 21) {
            risks.push({ type: "PTO Soon", days: p.days_to_pto, severity: "warning" });
            riskScore += 30 - p.days_to_pto;
          }
        }

        // Stalled projects (long time since close without progress)
        if (p.days_since_close > 60 && !p.construction_complete) {
          risks.push({ type: "Stalled", days: p.days_since_close, severity: "warning" });
          riskScore += 25;
        }

        // Blocked stage
        if (p.stage === "RTB - Blocked") {
          risks.push({ type: "Blocked", days: p.days_since_close, severity: "critical" });
          riskScore += 75;
        }

        // Revenue impact (capped so monetary value doesn't dominate risk urgency)
        riskScore += Math.min((p.amount || 0) / 10000, 50);

        return {
          ...p,
          risks,
          riskScore,
          hasCritical: risks.some((r) => r.severity === "critical"),
          hasWarning: risks.some((r) => r.severity === "warning"),
        };
      })
      .filter((p) => p.risks.length > 0);
  }, [allProjects]);

  const filteredProjects = useMemo(() => {
    let filtered = [...projectsWithRisk];

    if (filterLocation !== "all") {
      filtered = filtered.filter((p) => p.pb_location === filterLocation);
    }

    if (filterRiskType !== "all") {
      filtered = filtered.filter((p) =>
        p.risks.some((r) => r.type.toLowerCase().includes(filterRiskType.toLowerCase()))
      );
    }

    if (sortBy === "severity") {
      filtered.sort((a, b) => b.riskScore - a.riskScore);
    } else if (sortBy === "amount") {
      filtered.sort((a, b) => (b.amount || 0) - (a.amount || 0));
    } else if (sortBy === "days") {
      filtered.sort((a, b) => {
        const aDays = a.risks.length > 0 ? Math.max(...a.risks.map((r) => r.days)) : 0;
        const bDays = b.risks.length > 0 ? Math.max(...b.risks.map((r) => r.days)) : 0;
        return bDays - aDays;
      });
    }

    return filtered;
  }, [projectsWithRisk, filterLocation, filterRiskType, sortBy]);

  /* ---- summary stats ---- */

  const stats = useMemo(() => {
    const critical = filteredProjects.filter((p) => p.hasCritical);
    const warnings = filteredProjects.filter((p) => p.hasWarning && !p.hasCritical);
    const totalValue = filteredProjects.reduce((sum, p) => sum + (p.amount || 0), 0);
    const criticalValue = critical.reduce((sum, p) => sum + (p.amount || 0), 0);

    const byRiskType: Record<string, RiskTypeData> = {};
    filteredProjects.forEach((p) => {
      p.risks.forEach((r) => {
        if (!byRiskType[r.type]) byRiskType[r.type] = { count: 0, value: 0 };
        byRiskType[r.type].count++;
        byRiskType[r.type].value += p.amount || 0;
      });
    });

    return { critical, warnings, totalValue, criticalValue, byRiskType };
  }, [filteredProjects]);

  /* ---- export data ---- */

  const exportData = useMemo(() => {
    return filteredProjects.map((p) => ({
      name: p.name.split("|")[0].trim(),
      location: p.pb_location,
      stage: p.stage,
      amount: p.amount,
      risks: p.risks.map((r) => r.type).join(", "),
      riskScore: Math.round(p.riskScore),
      forecastInstall: p.forecast_install || "",
      forecastInspection: p.forecast_inspection || "",
      forecastPto: p.forecast_pto || "",
    }));
  }, [filteredProjects]);

  /* ---- sub-components ---- */

  const riskTypes: RiskTypeFilter[] = ["all", "install", "inspection", "pto", "stalled", "blocked"];

  const getRiskBadge = useCallback((risk: Risk, index: number) => {
    const colors =
      risk.severity === "critical"
        ? "bg-red-500/20 text-red-400 border-red-500/30"
        : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";

    let daysDisplay: string;
    if (risk.type.includes("Overdue")) {
      daysDisplay = risk.days === 0 ? "due today" : `${risk.days}d overdue`;
    } else if (risk.type.includes("Soon")) {
      daysDisplay = risk.days === 0 ? "due today" : `in ${risk.days}d`;
    } else {
      daysDisplay = `${risk.days}d`;
    }

    const typeDisplay = risk.type.replace(" Overdue", "").replace(" Soon", "");

    return (
      <span key={index} className={`text-xs px-2 py-1 rounded-full border ${colors}`}>
        {typeDisplay}: {daysDisplay}
      </span>
    );
  }, []);

  /* ---- filter bar ---- */

  const filterBar = (
    <div className="flex flex-wrap gap-4 items-center">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">Risk:</span>
        <select
          value={filterRiskType}
          onChange={(e) => setFilterRiskType(e.target.value as RiskTypeFilter)}
          className="bg-background border border-t-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-red-500"
        >
          {riskTypes.map((t) => (
            <option key={t} value={t}>
              {t === "all" ? "All Risks" : t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">Location:</span>
        <select
          value={filterLocation}
          onChange={(e) => setFilterLocation(e.target.value)}
          className="bg-background border border-t-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-red-500"
        >
          {locations.map((loc) => (
            <option key={loc} value={loc}>
              {loc === "all" ? "All Locations" : loc}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">Sort:</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className="bg-background border border-t-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-red-500"
        >
          <option value="severity">By Severity</option>
          <option value="amount">By Value</option>
          <option value="days">By Days Overdue</option>
        </select>
      </div>
    </div>
  );

  /* ---- loading state ---- */

  if (loading && allProjects.length === 0) {
    return (
      <DashboardShell title="At-Risk Projects" subtitle="Projects requiring immediate attention" accentColor="red">
        <LoadingSpinner color="red" message="Loading at-risk projects..." />
      </DashboardShell>
    );
  }

  /* ---- error state ---- */

  if (error && allProjects.length === 0) {
    return (
      <DashboardShell title="At-Risk Projects" subtitle="Projects requiring immediate attention" accentColor="red">
        <ErrorState message={error} onRetry={refetch} color="red" />
      </DashboardShell>
    );
  }

  /* ---- main render ---- */

  return (
    <DashboardShell
      title="At-Risk Projects"
      subtitle="Projects requiring immediate attention"
      accentColor="red"
      lastUpdated={lastUpdated}
      breadcrumbs={[{ label: "Dashboards", href: "/" }, { label: "At-Risk" }]}
      exportData={{ data: exportData, filename: "at-risk-projects" }}
      headerRight={
        <div className="flex items-center gap-3">
          <LiveIndicator label="Auto-Refresh" />
          <button
            onClick={refetch}
            className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-medium text-foreground transition-colors"
          >
            Refresh
          </button>
        </div>
      }
    >
      {/* Filter Bar */}
      <div className="mb-6">{filterBar}</div>

      {/* Alert Banner */}
      {stats.critical.length > 0 && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 mb-6 animate-pulse-red">
          <div className="flex items-center gap-4">
            <div className="text-red-400 font-bold text-lg">ALERT</div>
            <div className="text-red-200">
              {stats.critical.length} critical project{stats.critical.length !== 1 ? "s" : ""} at
              risk totaling {formatCurrency(stats.criticalValue)} in revenue
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-red-900/20 border border-red-800/60 rounded-lg p-4 animate-fadeIn">
          <div className="text-3xl font-bold text-red-400">{stats.critical.length}</div>
          <div className="text-sm text-red-300">Critical</div>
          <div className="text-xs text-red-400/70">{formatMoney(stats.criticalValue)} at risk</div>
        </div>
        <div className="bg-yellow-900/20 border border-yellow-800/60 rounded-lg p-4 animate-fadeIn">
          <div className="text-3xl font-bold text-yellow-400">{stats.warnings.length}</div>
          <div className="text-sm text-yellow-300">Warnings</div>
        </div>
        <div className="bg-surface border border-t-border rounded-lg p-4 animate-fadeIn">
          <div className="text-3xl font-bold text-foreground">{filteredProjects.length}</div>
          <div className="text-sm text-muted">Total At-Risk</div>
        </div>
        <div className="bg-surface border border-t-border rounded-lg p-4 animate-fadeIn">
          <div className="text-3xl font-bold text-purple-400">{formatCurrency(stats.totalValue)}</div>
          <div className="text-sm text-muted">Total Value</div>
        </div>
      </div>

      {/* Risk Type Breakdown */}
      <div className="bg-surface border border-t-border rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-muted mb-3">Risk Breakdown</h3>
        <div className="flex flex-wrap gap-4">
          {Object.entries(stats.byRiskType)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([type, data]) => (
              <div key={type} className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    type.includes("Overdue") || type.includes("Blocked")
                      ? "bg-red-500"
                      : "bg-yellow-500"
                  }`}
                />
                <span className="text-sm text-foreground/80">{type}:</span>
                <span className="text-sm font-medium text-foreground">{data.count}</span>
                <span className="text-xs text-muted">({formatMoney(data.value)})</span>
              </div>
            ))}
        </div>
      </div>

      {/* Project List */}
      <div className="space-y-3">
        {filteredProjects.map((project, idx) => (
          <div
            key={project.id}
            className={`rounded-lg border p-4 transition-colors animate-fadeIn ${
              project.hasCritical
                ? "bg-red-900/15 border-red-800/60 hover:bg-red-900/25"
                : "bg-yellow-900/15 border-yellow-800/60 hover:bg-yellow-900/25"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-muted">#{idx + 1}</span>
                  <a
                    href={project.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-lg font-medium text-blue-400 hover:underline truncate"
                  >
                    {project.name.split("|")[0].trim()}
                  </a>
                </div>
                <div className="text-sm text-muted mb-2">
                  {project.pb_location} | {project.ahj} | {project.utility} | {project.stage}
                </div>
                <div className="flex flex-wrap gap-2">
                  {project.risks.map((risk, i) => getRiskBadge(risk, i))}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-xl font-bold text-foreground">{formatMoney(project.amount)}</div>
                <div className="text-xs text-muted">
                  Risk Score: {project.riskScore.toFixed(0)}
                </div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-t-border/50 grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-muted">Forecast Install</div>
                <div className="text-white">
                  {project.forecast_install
                    ? new Date(project.forecast_install).toLocaleDateString()
                    : "-"}
                </div>
              </div>
              <div>
                <div className="text-muted">Forecast Inspection</div>
                <div className="text-white">
                  {project.forecast_inspection
                    ? new Date(project.forecast_inspection).toLocaleDateString()
                    : "-"}
                </div>
              </div>
              <div>
                <div className="text-muted">Forecast PTO</div>
                <div className="text-white">
                  {project.forecast_pto
                    ? new Date(project.forecast_pto).toLocaleDateString()
                    : "-"}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {filteredProjects.length === 0 && (
        <div className="text-center py-12 text-muted">
          <div className="text-4xl mb-2">&#10003;</div>
          <div>No at-risk projects found with current filters</div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 text-center text-sm text-muted">
        Data synced from HubSpot &middot; Auto-refreshes every 5 minutes
      </div>
    </DashboardShell>
  );
}
