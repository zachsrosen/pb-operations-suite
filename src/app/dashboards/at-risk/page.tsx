"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RawProject {
  id: string;
  name: string;
  pbLocation?: string;
  ahj?: string;
  utility?: string;
  projectType?: string;
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
  daysSinceStageMovement?: number;
  isBlocked?: boolean;
}

interface TransformedProject {
  id: string;
  name: string;
  pb_location: string;
  ahj: string;
  utility: string;
  project_type: string;
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
  days_to_install: number | null;
  days_to_inspection: number | null;
  days_to_pto: number | null;
  days_since_close: number;
}

interface Risk {
  type: string;
  days: number;
  severity: "critical" | "warning";
}

interface ProjectWithRisk extends TransformedProject {
  risks: Risk[];
  riskScore: number;
  hasCritical: boolean;
  hasWarning: boolean;
}

interface RiskTypeData {
  count: number;
  value: number;
}

type SortOption = "severity" | "amount" | "days";
type RiskTypeFilter = "all" | "install" | "inspection" | "pto" | "stalled" | "blocked";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

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
      ? new Date(closeDate.getTime() + 75 * MS_PER_DAY).toISOString().split("T")[0]
      : null);

  const forecastInspection =
    p.forecastedInspectionDate ||
    (closeDate
      ? new Date(closeDate.getTime() + 114 * MS_PER_DAY).toISOString().split("T")[0]
      : null);

  const forecastPto =
    p.forecastedPtoDate ||
    (closeDate
      ? new Date(closeDate.getTime() + 139 * MS_PER_DAY).toISOString().split("T")[0]
      : null);

  const daysToInstall = forecastInstall
    ? Math.floor((new Date(forecastInstall).getTime() - now.getTime()) / MS_PER_DAY)
    : null;

  const daysToInspection = forecastInspection
    ? Math.floor((new Date(forecastInspection).getTime() - now.getTime()) / MS_PER_DAY)
    : null;

  const daysToPto = forecastPto
    ? Math.floor((new Date(forecastPto).getTime() - now.getTime()) / MS_PER_DAY)
    : null;

  return {
    id: p.id,
    name: p.name,
    pb_location: p.pbLocation || "Unknown",
    ahj: p.ahj || "Unknown",
    utility: p.utility || "Unknown",
    project_type: p.projectType || "Unknown",
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
    days_to_install: daysToInstall,
    days_to_inspection: daysToInspection,
    days_to_pto: daysToPto,
    days_since_close: daysSinceClose,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AtRiskPage() {
  const [projects, setProjects] = useState<TransformedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("severity");
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterRiskType, setFilterRiskType] = useState<RiskTypeFilter>("all");

  /* ---- data fetching ---- */

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/projects?context=at-risk");
      if (!response.ok) throw new Error("Failed to fetch data");
      const data = await response.json();
      setProjects(data.projects.map(transformProject));
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  /* ---- derived data ---- */

  const locations = useMemo(() => {
    const locs = [...new Set(projects.map((p) => p.pb_location))]
      .filter((l) => l !== "Unknown")
      .sort();
    return ["all", ...locs];
  }, [projects]);

  const projectsWithRisk: ProjectWithRisk[] = useMemo(() => {
    return projects
      .map((p) => {
        const risks: Risk[] = [];
        let riskScore = 0;

        // Install risk - only if construction NOT complete
        if (!p.construction_complete && p.days_to_install !== null) {
          if (p.days_to_install < 0) {
            risks.push({
              type: "Install Overdue",
              days: Math.abs(p.days_to_install),
              severity: "critical",
            });
            riskScore += 100 + Math.abs(p.days_to_install);
          } else if (p.days_to_install <= 7) {
            risks.push({
              type: "Install Soon",
              days: p.days_to_install,
              severity: "warning",
            });
            riskScore += 50 - p.days_to_install;
          }
        }

        // Inspection risk - only if inspection NOT passed
        if (!p.inspection_pass && p.days_to_inspection !== null) {
          if (p.days_to_inspection < 0) {
            risks.push({
              type: "Inspection Overdue",
              days: Math.abs(p.days_to_inspection),
              severity: "critical",
            });
            riskScore += 80 + Math.abs(p.days_to_inspection);
          } else if (p.days_to_inspection <= 14) {
            risks.push({
              type: "Inspection Soon",
              days: p.days_to_inspection,
              severity: "warning",
            });
            riskScore += 40 - p.days_to_inspection;
          }
        }

        // PTO risk - only if PTO NOT granted
        if (!p.pto_granted && p.days_to_pto !== null) {
          if (p.days_to_pto < 0) {
            risks.push({
              type: "PTO Overdue",
              days: Math.abs(p.days_to_pto),
              severity: "critical",
            });
            riskScore += 60 + Math.abs(p.days_to_pto);
          } else if (p.days_to_pto <= 21) {
            risks.push({
              type: "PTO Soon",
              days: p.days_to_pto,
              severity: "warning",
            });
            riskScore += 30 - p.days_to_pto;
          }
        }

        // Stalled projects (long time since close without progress)
        if (p.days_since_close > 60 && !p.construction_complete) {
          risks.push({
            type: "Stalled",
            days: p.days_since_close,
            severity: "warning",
          });
          riskScore += 25;
        }

        // Blocked stage
        if (p.stage === "RTB - Blocked") {
          risks.push({
            type: "Blocked",
            days: p.days_since_close,
            severity: "critical",
          });
          riskScore += 75;
        }

        // Revenue impact
        riskScore += (p.amount || 0) / 10000;

        return {
          ...p,
          risks,
          riskScore,
          hasCritical: risks.some((r) => r.severity === "critical"),
          hasWarning: risks.some((r) => r.severity === "warning"),
        };
      })
      .filter((p) => p.risks.length > 0);
  }, [projects]);

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
        const aDays = Math.max(...a.risks.map((r) => r.days));
        const bDays = Math.max(...b.risks.map((r) => r.days));
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

  /* ---- sub-components ---- */

  const riskTypes: RiskTypeFilter[] = ["all", "install", "inspection", "pto", "stalled", "blocked"];

  const getRiskBadge = (risk: Risk, index: number) => {
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
  };

  /* ---- filter bar (rendered in headerRight) ---- */

  const filterBar = (
    <div className="flex flex-wrap gap-4 items-center">
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">Risk:</span>
        <select
          value={filterRiskType}
          onChange={(e) => setFilterRiskType(e.target.value as RiskTypeFilter)}
          className="bg-[#0a0a0f] border border-zinc-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-red-500"
        >
          {riskTypes.map((t) => (
            <option key={t} value={t}>
              {t === "all" ? "All Risks" : t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">Location:</span>
        <select
          value={filterLocation}
          onChange={(e) => setFilterLocation(e.target.value)}
          className="bg-[#0a0a0f] border border-zinc-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-red-500"
        >
          {locations.map((loc) => (
            <option key={loc} value={loc}>
              {loc === "all" ? "All Locations" : loc}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">Sort:</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className="bg-[#0a0a0f] border border-zinc-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-red-500"
        >
          <option value="severity">By Severity</option>
          <option value="amount">By Value</option>
          <option value="days">By Days Overdue</option>
        </select>
      </div>
    </div>
  );

  /* ---- loading state ---- */

  if (loading && projects.length === 0) {
    return (
      <DashboardShell title="At-Risk Projects" subtitle="Projects requiring immediate attention" accentColor="red">
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500 mx-auto mb-4" />
            <p className="text-zinc-400">Loading at-risk projects...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  /* ---- error state ---- */

  if (error && projects.length === 0) {
    return (
      <DashboardShell title="At-Risk Projects" subtitle="Projects requiring immediate attention" accentColor="red">
        <div className="flex items-center justify-center py-32">
          <div className="text-center bg-[#12121a] rounded-xl p-8 border border-zinc-800">
            <div className="text-red-500 text-4xl mb-4">!</div>
            <h2 className="text-xl font-bold text-white mb-2">Failed to Load Data</h2>
            <p className="text-zinc-400 mb-4">{error}</p>
            <button
              onClick={() => fetchData()}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
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
      headerRight={
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center px-3 py-1 bg-green-900/50 text-green-400 rounded-full text-sm">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse" />
            Live
          </div>
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
              risk totaling ${(stats.criticalValue / 1_000_000).toFixed(2)}M in revenue
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-red-900/20 border border-red-800/60 rounded-lg p-4">
          <div className="text-3xl font-bold text-red-400">{stats.critical.length}</div>
          <div className="text-sm text-red-300">Critical</div>
          <div className="text-xs text-red-400/70">
            ${(stats.criticalValue / 1000).toFixed(0)}k at risk
          </div>
        </div>
        <div className="bg-yellow-900/20 border border-yellow-800/60 rounded-lg p-4">
          <div className="text-3xl font-bold text-yellow-400">{stats.warnings.length}</div>
          <div className="text-sm text-yellow-300">Warnings</div>
        </div>
        <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
          <div className="text-3xl font-bold text-white">{filteredProjects.length}</div>
          <div className="text-sm text-zinc-400">Total At-Risk</div>
        </div>
        <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4">
          <div className="text-3xl font-bold text-purple-400">
            ${(stats.totalValue / 1_000_000).toFixed(1)}M
          </div>
          <div className="text-sm text-zinc-400">Total Value</div>
        </div>
      </div>

      {/* Risk Type Breakdown */}
      <div className="bg-[#12121a] border border-zinc-800 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-3">Risk Breakdown</h3>
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
                <span className="text-sm text-zinc-300">{type}:</span>
                <span className="text-sm font-medium text-white">{data.count}</span>
                <span className="text-xs text-zinc-500">
                  (${(data.value / 1000).toFixed(0)}k)
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Project List */}
      <div className="space-y-3">
        {filteredProjects.map((project, idx) => (
          <div
            key={project.id}
            className={`rounded-lg border p-4 transition-colors ${
              project.hasCritical
                ? "bg-red-900/15 border-red-800/60 hover:bg-red-900/25"
                : "bg-yellow-900/15 border-yellow-800/60 hover:bg-yellow-900/25"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-zinc-500">#{idx + 1}</span>
                  <a
                    href={project.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-lg font-medium text-blue-400 hover:underline truncate"
                  >
                    {project.name.split("|")[0].trim()}
                  </a>
                </div>
                <div className="text-sm text-zinc-400 mb-2">
                  {project.pb_location} | {project.ahj} | {project.utility} | {project.stage}
                </div>
                <div className="flex flex-wrap gap-2">
                  {project.risks.map((risk, i) => getRiskBadge(risk, i))}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-xl font-bold text-white">
                  ${((project.amount || 0) / 1000).toFixed(0)}k
                </div>
                <div className="text-xs text-zinc-500">
                  Risk Score: {project.riskScore.toFixed(0)}
                </div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-zinc-700/50 grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-zinc-500">Forecast Install</div>
                <div className="text-white">
                  {project.forecast_install
                    ? new Date(project.forecast_install).toLocaleDateString()
                    : "-"}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Forecast Inspection</div>
                <div className="text-white">
                  {project.forecast_inspection
                    ? new Date(project.forecast_inspection).toLocaleDateString()
                    : "-"}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Forecast PTO</div>
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
        <div className="text-center py-12 text-zinc-500">
          <div className="text-4xl mb-2">&#10003;</div>
          <div>No at-risk projects found with current filters</div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 text-center text-sm text-zinc-500">
        Data synced from HubSpot &middot; Auto-refreshes every 5 minutes
      </div>
    </DashboardShell>
  );
}
