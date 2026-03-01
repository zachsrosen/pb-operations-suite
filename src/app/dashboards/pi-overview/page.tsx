"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { usePIOverviewFilters } from "@/stores/dashboard-filters";
import {
  PERMIT_ACTIVE_STATUSES,
  PERMIT_REVISION_STATUSES,
  IC_ACTIVE_STATUSES,
  IC_REVISION_STATUSES,
  PTO_PIPELINE_STATUSES,
} from "@/lib/pi-statuses";

const PI_LINKS = [
  { href: "/dashboards/pi-metrics", label: "P&I Metrics", desc: "Permit, IC, and PTO KPIs" },
  { href: "/dashboards/pi-action-queue", label: "Action Queue", desc: "Projects needing action" },
  { href: "/dashboards/ahj-tracker", label: "AHJ Tracker", desc: "Per-AHJ permit analytics" },
  { href: "/dashboards/utility-tracker", label: "Utility Tracker", desc: "Per-utility IC analytics" },
  { href: "/dashboards/pi-timeline", label: "Timeline & SLA", desc: "SLA targets & turnaround" },
];

type SortField = "name" | "stage" | "lead" | "days" | "amount" | null;
type SortDirection = "asc" | "desc";

export default function PIOverviewPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("pi-overview", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // Persisted multi-select filters
  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = usePIOverviewFilters();

  // Sort state for stale projects table
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  }, [sortField]);

  const sortIndicator = useCallback((field: SortField) => {
    if (sortField !== field) return " \u21C5";
    return sortDirection === "asc" ? " \u2191" : " \u2193";
  }, [sortField, sortDirection]);

  // Build filter option lists
  const locationOptions: FilterOption[] = useMemo(() => {
    const locs = new Set<string>();
    safeProjects.forEach((p) => { if (p.pbLocation) locs.add(p.pbLocation); });
    return Array.from(locs).sort().map((loc) => ({ value: loc, label: loc }));
  }, [safeProjects]);

  const leadOptions: FilterOption[] = useMemo(() => {
    const names = new Set<string>();
    safeProjects.forEach((p) => {
      if (p.permitLead) names.add(p.permitLead);
      if (p.interconnectionsLead) names.add(p.interconnectionsLead);
    });
    return Array.from(names).sort().map((name) => ({ value: name, label: name }));
  }, [safeProjects]);

  const stageOptions: FilterOption[] = useMemo(() => {
    const s = new Set<string>();
    safeProjects.forEach((p) => { if (p.stage) s.add(p.stage); });
    return Array.from(s).sort().map((stage) => ({ value: stage, label: stage }));
  }, [safeProjects]);

  const hasActiveFilters = persistedFilters.locations.length > 0 ||
    persistedFilters.leads.length > 0 ||
    persistedFilters.stages.length > 0;

  const filteredProjects = useMemo(() => {
    const result: RawProject[] = [];
    for (const p of safeProjects) {
      if (persistedFilters.locations.length > 0 && !persistedFilters.locations.includes(p.pbLocation || "")) continue;
      if (persistedFilters.leads.length > 0 && !persistedFilters.leads.includes(p.permitLead || "Unknown") && !persistedFilters.leads.includes(p.interconnectionsLead || "Unknown")) continue;
      if (persistedFilters.stages.length > 0 && !persistedFilters.stages.includes(p.stage || "")) continue;
      result.push(p);
    }
    return result;
  }, [safeProjects, persistedFilters]);

  // Hero metrics
  const heroMetrics = useMemo(() => {
    const permitsPending = filteredProjects.filter(
      (p) => p.permittingStatus && [...PERMIT_ACTIVE_STATUSES, ...PERMIT_REVISION_STATUSES].includes(p.permittingStatus)
    );
    const icActive = filteredProjects.filter(
      (p) => p.interconnectionStatus && [...IC_ACTIVE_STATUSES, ...IC_REVISION_STATUSES].includes(p.interconnectionStatus)
    );
    const ptoPipeline = filteredProjects.filter(
      (p) => p.ptoStatus && PTO_PIPELINE_STATUSES.includes(p.ptoStatus)
    );

    // Avg permit turnaround (submit -> issue)
    const turnarounds = filteredProjects
      .filter((p) => p.permitSubmitDate && p.permitIssueDate)
      .map((p) => {
        const d1 = new Date(p.permitSubmitDate! + "T12:00:00");
        const d2 = new Date(p.permitIssueDate! + "T12:00:00");
        return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter((d) => d >= 0 && d < 365);
    const avgTurnaround = turnarounds.length > 0
      ? Math.round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length)
      : 0;

    return {
      permitsPending: permitsPending.length,
      icActive: icActive.length,
      ptoPipeline: ptoPipeline.length,
      avgTurnaround,
    };
  }, [filteredProjects]);

  // Status distributions
  const permitBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredProjects.forEach((p) => {
      if (p.permittingStatus) {
        counts[p.permittingStatus] = (counts[p.permittingStatus] || 0) + 1;
      }
    });
    const max = Math.max(1, ...Object.values(counts));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([status, count]) => ({ status, count, pct: (count / max) * 100 }));
  }, [filteredProjects]);

  const icBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredProjects.forEach((p) => {
      if (p.interconnectionStatus) {
        counts[p.interconnectionStatus] = (counts[p.interconnectionStatus] || 0) + 1;
      }
    });
    const max = Math.max(1, ...Object.values(counts));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([status, count]) => ({ status, count, pct: (count / max) * 100 }));
  }, [filteredProjects]);

  // Stale projects (most days in current P&I stage)
  const staleProjects = useMemo(() => {
    const base = filteredProjects
      .filter(
        (p) =>
          (p.stage === "Permitting & Interconnection" || p.stage === "Permission To Operate") &&
          (p.daysSinceStageMovement ?? 0) > 0
      )
      .sort((a, b) => (b.daysSinceStageMovement ?? 0) - (a.daysSinceStageMovement ?? 0))
      .slice(0, 10);

    if (!sortField) return base;

    return [...base].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = (a.name || "").localeCompare(b.name || "");
          break;
        case "stage":
          cmp = (a.stage || "").localeCompare(b.stage || "");
          break;
        case "lead":
          cmp = (a.permitLead || a.interconnectionsLead || "Unknown").localeCompare(b.permitLead || b.interconnectionsLead || "Unknown");
          break;
        case "days":
          cmp = (a.daysSinceStageMovement ?? 0) - (b.daysSinceStageMovement ?? 0);
          break;
        case "amount":
          cmp = (a.amount || 0) - (b.amount || 0);
          break;
      }
      return sortDirection === "desc" ? -cmp : cmp;
    });
  }, [filteredProjects, sortField, sortDirection]);

  return (
    <DashboardShell
      title="P&I Overview"
      accentColor="cyan"
      lastUpdated={lastUpdated}
    >
      {/* Hero Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid mb-6">
        <StatCard
          label="Permits Pending"
          value={loading ? null : heroMetrics.permitsPending}
          color="cyan"
        />
        <StatCard
          label="IC Apps Active"
          value={loading ? null : heroMetrics.icActive}
          color="blue"
        />
        <StatCard
          label="PTO Pipeline"
          value={loading ? null : heroMetrics.ptoPipeline}
          color="emerald"
        />
        <StatCard
          label="Avg Permit Turnaround"
          value={loading ? null : `${heroMetrics.avgTurnaround}d`}
          color="purple"
        />
      </div>

      {/* Status Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Permitting */}
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Permitting Status</h2>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-6 bg-skeleton rounded animate-pulse" />
              ))}
            </div>
          ) : permitBreakdown.length === 0 ? (
            <p className="text-sm text-muted italic">No permitting status data.</p>
          ) : (
            <div className="space-y-2">
              {permitBreakdown.map((s) => (
                <div key={s.status} className="flex items-center gap-3">
                  <div className="w-44 text-xs text-muted truncate" title={s.status}>{s.status}</div>
                  <div className="flex-1 h-5 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                      style={{ width: `${Math.max(s.pct, s.count > 0 ? 8 : 0)}%` }}
                    >
                      {s.count > 0 && <span className="text-xs font-semibold text-white">{s.count}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Interconnection */}
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Interconnection Status</h2>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-6 bg-skeleton rounded animate-pulse" />
              ))}
            </div>
          ) : icBreakdown.length === 0 ? (
            <p className="text-sm text-muted italic">No interconnection status data.</p>
          ) : (
            <div className="space-y-2">
              {icBreakdown.map((s) => (
                <div key={s.status} className="flex items-center gap-3">
                  <div className="w-44 text-xs text-muted truncate" title={s.status}>{s.status}</div>
                  <div className="flex-1 h-5 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                      style={{ width: `${Math.max(s.pct, s.count > 0 ? 8 : 0)}%` }}
                    >
                      {s.count > 0 && <span className="text-xs font-semibold text-white">{s.count}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center mb-6">
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={persistedFilters.locations}
          onChange={(v) => setPersisted({ ...persistedFilters, locations: v })}
          accentColor="cyan"
        />
        <MultiSelectFilter
          label="Lead"
          options={leadOptions}
          selected={persistedFilters.leads}
          onChange={(v) => setPersisted({ ...persistedFilters, leads: v })}
          accentColor="cyan"
        />
        <MultiSelectFilter
          label="Stage"
          options={stageOptions}
          selected={persistedFilters.stages}
          onChange={(v) => setPersisted({ ...persistedFilters, stages: v })}
          accentColor="cyan"
        />
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="px-3 py-2 rounded-lg text-sm text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Stale Projects */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Top 10 Stale P&I Projects</h2>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : staleProjects.length === 0 ? (
          <p className="text-sm text-muted italic">No stale P&I projects.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted">
                  <th
                    className="pb-2 pr-4 cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("name")}
                  >
                    Project{sortIndicator("name")}
                  </th>
                  <th
                    className="pb-2 pr-4 cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("stage")}
                  >
                    Stage{sortIndicator("stage")}
                  </th>
                  <th
                    className="pb-2 pr-4 cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("lead")}
                  >
                    P&I Lead{sortIndicator("lead")}
                  </th>
                  <th className="pb-2 pr-4">AHJ / Utility</th>
                  <th
                    className="pb-2 pr-4 text-right cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("days")}
                  >
                    Days in Stage{sortIndicator("days")}
                  </th>
                  <th
                    className="pb-2 text-right cursor-pointer hover:text-foreground"
                    onClick={() => handleSort("amount")}
                  >
                    Amount{sortIndicator("amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {staleProjects.map((p) => (
                  <tr key={p.id} className="border-b border-t-border/50">
                    <td className="py-2 pr-4">
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 hover:underline">
                          {p.name}
                        </a>
                      ) : (
                        <span className="text-foreground">{p.name}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-muted">{p.stage}</td>
                    <td className="py-2 pr-4 text-muted">{p.permitLead || p.interconnectionsLead || "Unknown"}</td>
                    <td className="py-2 pr-4 text-muted text-xs">{p.ahj || p.utility || "\u2014"}</td>
                    <td className="py-2 pr-4 text-right">
                      <span className={`font-semibold ${(p.daysSinceStageMovement ?? 0) > 21 ? "text-red-400" : (p.daysSinceStageMovement ?? 0) > 10 ? "text-yellow-400" : "text-foreground"}`}>
                        {p.daysSinceStageMovement ?? 0}d
                      </span>
                    </td>
                    <td className="py-2 text-right text-foreground">{formatMoney(p.amount || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-3">P&I Dashboards</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger-grid">
          {PI_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="group bg-surface border border-t-border rounded-lg p-4 shadow-card hover:border-cyan-500/50 transition-colors"
            >
              <div className="font-medium text-foreground group-hover:text-cyan-400 transition-colors">{link.label}</div>
              <div className="text-xs text-muted mt-1">{link.desc}</div>
            </a>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
