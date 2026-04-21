"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { formatMoney, formatDate } from "@/lib/format";
import { getStatusDisplayName } from "@/lib/hubspot-status-display";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useDesignRevisionsFilters } from "@/stores/dashboard-filters";

// ---- Types ----

interface FullEquipment {
  modules: { brand: string; model: string; count: number; wattage: number };
  inverter: { brand: string; model: string; count: number; sizeKwac: number };
  battery: { brand: string; model: string; count: number; sizeKwh: number; expansionCount: number };
  evCount: number;
  systemSizeKwdc: number;
  systemSizeKwac: number;
}

function isDesignRevisionStatus(designStatus: string): boolean {
  const s = designStatus.toLowerCase();
  return s.includes("revision");
}

function isDesignRevisionQueueStatus(designStatus: string): boolean {
  const s = designStatus.toLowerCase();
  return s.includes("needed") || s.includes("in progress");
}

// Map statuses to a revision category for grouping / badges
function getRevisionCategory(designStatus: string): string {
  if (designStatus.includes("DA") || designStatus.includes("DA Rejected")) return "DA";
  if (designStatus.includes("AHJ") || designStatus.includes("Permit")) return "Permit";
  if (designStatus.includes("Utility")) return "Utility";
  if (designStatus.includes("As-Built")) return "As-Built";
  return "Other";
}

const CATEGORY_COLORS: Record<string, string> = {
  DA: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Permit: "bg-red-500/20 text-red-400 border-red-500/30",
  Utility: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "As-Built": "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  Other: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

function getRevisionQueueState(designStatus: string): "Needed" | "In Progress" | "Completed" {
  const s = designStatus.toLowerCase();
  if (s.includes("in progress")) return "In Progress";
  if (s.includes("needed")) return "Needed";
  return "Completed";
}

type SortField = "name" | "designLead" | "location" | "stage" | "category" | "designStatus" | "daysInRevision" | "totalRevisions" | "designComplete" | "amount";
type SortDir = "asc" | "desc";

export default function DesignRevisionsPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  const [sortField, setSortField] = useState<SortField>("daysInRevision");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ---- Filter state ----
  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = useDesignRevisionsFilters();
  const [revisionTypes, setRevisionTypes] = useState<string[]>([]);
  const [queueStates, setQueueStates] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("design-revisions", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // Include queue + completed statuses for aggregate stats
  const revisionScopeProjects = useMemo(() => {
    return safeProjects
      .filter((p) => p.designStatus && isDesignRevisionStatus(p.designStatus))
      .map((p) => {
        const eq = p.equipment as FullEquipment | undefined;
        const eqSummary = eq
          ? `${eq.modules?.count || 0}× ${eq.modules?.wattage || 0}W, ${eq.inverter?.count || 0}× inv`
          : "—";
        const daRevisionCount = p.daRevisionCounter ?? 0;
        const asBuiltRevisionCount = p.asBuiltRevisionCounter ?? 0;
        const permitRevisionCount = p.permitRevisionCounter ?? 0;
        const interconnectionRevisionCount = p.interconnectionRevisionCounter ?? 0;
        const totalRevisionCount =
          p.totalRevisionCount ??
          (daRevisionCount + asBuiltRevisionCount + permitRevisionCount + interconnectionRevisionCount);
        return {
          ...p,
          daysInRevision: p.daysSinceStageMovement ?? 0,
          revisionCategory: getRevisionCategory(p.designStatus!),
          queueState: getRevisionQueueState(p.designStatus!),
          eqSummary,
          daRevisionCount,
          asBuiltRevisionCount,
          permitRevisionCount,
          interconnectionRevisionCount,
          totalRevisionCount,
        };
      });
  }, [safeProjects]);

  // ---- Filter option lists ----
  const locationOptions: FilterOption[] = useMemo(
    () => [...new Set(revisionScopeProjects.map((p) => p.pbLocation || ""))].filter(Boolean).sort().map((loc) => ({ value: loc, label: loc })),
    [revisionScopeProjects]
  );
  const ownerOptions: FilterOption[] = useMemo(
    () => [...new Set(revisionScopeProjects.map((p) => p.designLead || "Unknown"))].sort().map((o) => ({ value: o, label: o })),
    [revisionScopeProjects]
  );
  const stageOptions: FilterOption[] = useMemo(
    () => [...new Set(revisionScopeProjects.map((p) => p.stage || ""))].filter(Boolean).sort().map((s) => ({ value: s, label: s })),
    [revisionScopeProjects]
  );
  const revisionTypeOptions: FilterOption[] = useMemo(
    () =>
      [...new Set(revisionScopeProjects.map((p) => p.revisionCategory))]
        .sort()
        .map((category) => ({ value: category, label: category })),
    [revisionScopeProjects]
  );
  const queueStateOptions: FilterOption[] = useMemo(
    () => [
      { value: "Needed", label: "Needed" },
      { value: "In Progress", label: "In Progress" },
    ],
    []
  );

  const hasActiveFilters =
    persistedFilters.locations.length > 0 ||
    persistedFilters.stages.length > 0 ||
    persistedFilters.owners.length > 0 ||
    revisionTypes.length > 0 ||
    queueStates.length > 0 ||
    searchQuery.length > 0;

  // ---- Filtered projects for stats context (queue + completed) ----
  const filteredScopeProjects = useMemo(() => {
    let list = revisionScopeProjects;

    if (persistedFilters.locations.length > 0) {
      list = list.filter((p) => persistedFilters.locations.includes(p.pbLocation || ""));
    }
    if (persistedFilters.stages.length > 0) {
      list = list.filter((p) => persistedFilters.stages.includes(p.stage || ""));
    }
    if (persistedFilters.owners.length > 0) {
      list = list.filter((p) => persistedFilters.owners.includes(p.designLead || "Unknown"));
    }
    if (revisionTypes.length > 0) {
      list = list.filter((p) => revisionTypes.includes(p.revisionCategory));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.designStatus || "").toLowerCase().includes(q) ||
          (p.designLead || "").toLowerCase().includes(q) ||
          (p.ahj || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [revisionScopeProjects, persistedFilters, revisionTypes, searchQuery]);

  // Active queue list (exclude completed statuses from table)
  const filteredQueueProjects = useMemo(() => {
    let list = filteredScopeProjects.filter((p) => isDesignRevisionQueueStatus(p.designStatus || ""));
    if (queueStates.length > 0) {
      list = list.filter((p) => queueStates.includes(p.queueState));
    }
    return list;
  },
    [filteredScopeProjects, queueStates]
  );

  // Sort
  const sortedProjects = useMemo(() => {
    const sorted = [...filteredQueueProjects];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "designLead": cmp = (a.designLead || "Unknown").localeCompare(b.designLead || "Unknown"); break;
        case "location": cmp = (a.pbLocation || "").localeCompare(b.pbLocation || ""); break;
        case "stage": cmp = (a.stage || "").localeCompare(b.stage || ""); break;
        case "category": cmp = a.revisionCategory.localeCompare(b.revisionCategory); break;
        case "designStatus": cmp = (a.designStatus || "").localeCompare(b.designStatus || ""); break;
        case "daysInRevision": cmp = a.daysInRevision - b.daysInRevision; break;
        case "totalRevisions": cmp = a.totalRevisionCount - b.totalRevisionCount; break;
        case "designComplete": cmp = (a.designCompletionDate || "").localeCompare(b.designCompletionDate || ""); break;
        case "amount": cmp = (a.amount || 0) - (b.amount || 0); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredQueueProjects, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortField(field); setSortDir("desc"); }
    },
    [sortField]
  );

  // Stats
  const stats = useMemo(() => {
    const queueTotal = filteredQueueProjects.length;
    const completedTotal = filteredScopeProjects.length - filteredQueueProjects.length;
    const byCategory: Record<string, number> = {};
    filteredQueueProjects.forEach((p) => {
      byCategory[p.revisionCategory] = (byCategory[p.revisionCategory] || 0) + 1;
    });
    const days = filteredQueueProjects.map((p) => p.daysInRevision);
    const avgDays = days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0;
    const longestWait = days.length > 0 ? Math.max(...days) : 0;
    const totalRevisionEvents = filteredScopeProjects.reduce((sum, p) => sum + p.totalRevisionCount, 0);
    const avgRevisionsPerProject = filteredScopeProjects.length > 0 ? Math.round((totalRevisionEvents / filteredScopeProjects.length) * 10) / 10 : 0;
    return { queueTotal, completedTotal, byCategory, avgDays, longestWait, totalRevisionEvents, avgRevisionsPerProject };
  }, [filteredQueueProjects, filteredScopeProjects]);

  // Export
  const exportRows = useMemo(
    () => sortedProjects.map((p) => ({
      name: p.name,
      designLead: p.designLead || "Unknown",
      location: p.pbLocation || "",
      stage: p.stage || "",
      ahj: p.ahj || "",
      designStatus: p.designStatus || "",
      revisionCategory: p.revisionCategory,
      daysInRevision: p.daysInRevision,
      daRevisionCounter: p.daRevisionCount,
      asBuiltRevisionCounter: p.asBuiltRevisionCount,
      permitRevisionCounter: p.permitRevisionCount,
      interconnectionRevisionCounter: p.interconnectionRevisionCount,
      totalRevisionCount: p.totalRevisionCount,
      equipment: p.eqSummary,
      designCompletionDate: p.designCompletionDate || "",
      amount: p.amount || 0,
    })),
    [sortedProjects]
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " \u2191" : " \u2193") : " \u21C5";

  return (
    <DashboardShell
      title="Design Revisions"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "design-revisions.csv" }}
      fullWidth
    >
      {/* Filter Row */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by PROJ #, name, or AHJ..."
            className="w-full pl-10 pr-8 py-2 bg-surface-2 border border-t-border rounded-lg text-sm focus:outline-none focus:border-muted focus:ring-1 focus:ring-muted"
          />
          {searchQuery && (
            <button
              aria-label="Clear search"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

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
        <MultiSelectFilter
          label="Design Lead"
          options={ownerOptions}
          selected={persistedFilters.owners}
          onChange={(v) => setPersisted({ ...persistedFilters, owners: v })}
          accentColor="indigo"
        />
        <MultiSelectFilter
          label="Revision Type"
          options={revisionTypeOptions}
          selected={revisionTypes}
          onChange={setRevisionTypes}
          accentColor="indigo"
        />
        <MultiSelectFilter
          label="Queue State"
          options={queueStateOptions}
          selected={queueStates}
          onChange={setQueueStates}
          accentColor="indigo"
        />

        {hasActiveFilters && (
          <button
            onClick={() => {
              clearFilters();
              setRevisionTypes([]);
              setQueueStates([]);
              setSearchQuery("");
            }}
            className="px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid">
        <MiniStat
          label="In Revision Queue"
          value={loading ? null : stats.queueTotal}
          subtitle={`Completed: ${stats.completedTotal}`}
        />
        <MiniStat label="Avg Days in Revision" value={loading ? null : `${stats.avgDays}d`} alert={stats.avgDays > 14} />
        <MiniStat label="Longest Wait" value={loading ? null : `${stats.longestWait}d`} alert={stats.longestWait > 21} />
        <MiniStat
          label="Revision Events Logged"
          value={loading ? null : stats.totalRevisionEvents}
          subtitle={`Avg ${stats.avgRevisionsPerProject}/project`}
        />
      </div>

      {/* Category breakdown */}
      {!loading && filteredQueueProjects.length > 0 && (
        <div className="mb-6 bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Revisions by Category</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(stats.byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, count]) => (
                <div key={cat} className="flex items-center gap-3 p-3 bg-surface-2/50 rounded-lg">
                  <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full border ${CATEGORY_COLORS[cat] || CATEGORY_COLORS.Other}`}>
                    {cat}
                  </span>
                  <span className="text-lg font-bold text-foreground">{count}</span>
                  <span className="text-sm text-muted">projects</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="mb-6 bg-surface border border-t-border rounded-xl shadow-card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="p-8 text-center text-muted">No projects currently in the active revision queue.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Project{sortIndicator("name")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("designLead")}>
                    Design Lead{sortIndicator("designLead")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("location")}>
                    Location / AHJ{sortIndicator("location")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("stage")}>
                    Deal Stage{sortIndicator("stage")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("category")}>
                    Category{sortIndicator("category")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("designStatus")}>
                    Design Status{sortIndicator("designStatus")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("daysInRevision")}>
                    Days in Revision{sortIndicator("daysInRevision")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("totalRevisions")}>
                    Revisions{sortIndicator("totalRevisions")}
                  </th>
                  <th className="p-3">Equipment</th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("designComplete")}>
                    Design Complete{sortIndicator("designComplete")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("amount")}>
                    Amount{sortIndicator("amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedProjects.map((p) => (
                  <tr key={p.id} className="border-b border-t-border/50 hover:bg-surface-2/50">
                    <td className="p-3">
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 hover:underline">
                          {p.name}
                        </a>
                      ) : (
                        <span className="text-foreground">{p.name}</span>
                      )}
                    </td>
                    <td className="p-3 text-muted">{p.designLead || "Unknown"}</td>
                    <td className="p-3">
                      <div className="text-muted">{p.pbLocation || "—"}</div>
                      {p.ahj && <div className="text-xs text-muted/70">{p.ahj}</div>}
                    </td>
                    <td className="p-3 text-muted text-xs">{p.stage || "\u2014"}</td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full border ${CATEGORY_COLORS[p.revisionCategory] || CATEGORY_COLORS.Other}`}>
                        {p.revisionCategory}
                      </span>
                    </td>
                    <td className="p-3 text-muted text-xs">{p.designStatus ? getStatusDisplayName(p.designStatus, "design_status") : "—"}</td>
                    <td className="p-3 text-right">
                      <span className={`font-semibold ${p.daysInRevision > 21 ? "text-red-400" : p.daysInRevision > 10 ? "text-yellow-400" : "text-foreground"}`}>
                        {p.daysInRevision}d
                      </span>
                    </td>
                    <td className="p-3 text-right text-foreground">{p.totalRevisionCount}</td>
                    <td className="p-3 text-muted text-xs">{p.eqSummary}</td>
                    <td className="p-3 text-muted">{formatDate(p.designCompletionDate)}</td>
                    <td className="p-3 text-right text-foreground">{formatMoney(p.amount || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Note about revision tracking */}
      <div className="mb-6 bg-surface/50 border border-t-border rounded-lg p-4">
        <p className="text-xs text-muted">
          <span className="font-medium text-foreground">Note:</span> Revision counts are sourced from HubSpot counter properties
          (DA, As-Built, Permit, Interconnection, and Total). Blank counters are treated as 0.
        </p>
      </div>
    </DashboardShell>
  );
}
