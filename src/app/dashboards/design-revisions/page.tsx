"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { formatMoney, formatDate } from "@/lib/format";
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

// Revision-related design statuses (active, not archived)
const REVISION_STATUSES = [
  // DA Revisions
  "Revision Needed - DA Rejected",
  "DA Revision In Progress",
  "DA Revision Completed",
  // Permit/AHJ Revisions
  "Revision Needed - Rejected by AHJ",
  "Permit Revision In Progress",
  "Permit Revision Completed",
  // Utility Revisions
  "Revision Needed - Rejected by Utility",
  "Utility Revision In Progress",
  "Utility Revision Completed",
  // As-Built Revisions
  "Revision Needed - As-Built",
  "As-Built Revision In Progress",
  "As-Built Revision Completed",
];

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

type SortField = "name" | "designLead" | "location" | "category" | "designStatus" | "daysInRevision" | "designComplete" | "amount";
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
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("design-revisions", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // Filter to projects in revision statuses
  const revisionProjects = useMemo(() => {
    return safeProjects
      .filter((p) => p.designStatus && REVISION_STATUSES.includes(p.designStatus))
      .map((p) => {
        const eq = p.equipment as FullEquipment | undefined;
        const eqSummary = eq
          ? `${eq.modules?.count || 0}× ${eq.modules?.wattage || 0}W, ${eq.inverter?.count || 0}× inv`
          : "—";
        return {
          ...p,
          daysInRevision: p.daysSinceStageMovement ?? 0,
          revisionCategory: getRevisionCategory(p.designStatus!),
          eqSummary,
        };
      });
  }, [safeProjects]);

  // ---- Filter option lists ----
  const locationOptions: FilterOption[] = useMemo(
    () => [...new Set(revisionProjects.map((p) => p.pbLocation || ""))].filter(Boolean).sort().map((loc) => ({ value: loc, label: loc })),
    [revisionProjects]
  );
  const ownerOptions: FilterOption[] = useMemo(
    () => [...new Set(revisionProjects.map((p) => p.designLead || "Unknown"))].sort().map((o) => ({ value: o, label: o })),
    [revisionProjects]
  );

  const hasActiveFilters = persistedFilters.locations.length > 0 || persistedFilters.owners.length > 0 || searchQuery.length > 0;

  // ---- Filtered projects ----
  const filteredProjects = useMemo(() => {
    let list = revisionProjects;

    if (persistedFilters.locations.length > 0) {
      list = list.filter((p) => persistedFilters.locations.includes(p.pbLocation || ""));
    }
    if (persistedFilters.owners.length > 0) {
      list = list.filter((p) => persistedFilters.owners.includes(p.designLead || "Unknown"));
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
  }, [revisionProjects, persistedFilters, searchQuery]);

  // Sort
  const sortedProjects = useMemo(() => {
    const sorted = [...filteredProjects];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "designLead": cmp = (a.designLead || "Unknown").localeCompare(b.designLead || "Unknown"); break;
        case "location": cmp = (a.pbLocation || "").localeCompare(b.pbLocation || ""); break;
        case "category": cmp = a.revisionCategory.localeCompare(b.revisionCategory); break;
        case "designStatus": cmp = (a.designStatus || "").localeCompare(b.designStatus || ""); break;
        case "daysInRevision": cmp = a.daysInRevision - b.daysInRevision; break;
        case "designComplete": cmp = (a.designCompletionDate || "").localeCompare(b.designCompletionDate || ""); break;
        case "amount": cmp = (a.amount || 0) - (b.amount || 0); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredProjects, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortField(field); setSortDir("desc"); }
    },
    [sortField]
  );

  // Stats
  const stats = useMemo(() => {
    const total = filteredProjects.length;
    const byCategory: Record<string, number> = {};
    filteredProjects.forEach((p) => {
      byCategory[p.revisionCategory] = (byCategory[p.revisionCategory] || 0) + 1;
    });
    const days = filteredProjects.map((p) => p.daysInRevision);
    const avgDays = days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0;
    const longestWait = days.length > 0 ? Math.max(...days) : 0;
    return { total, byCategory, avgDays, longestWait };
  }, [filteredProjects]);

  // Export
  const exportRows = useMemo(
    () => sortedProjects.map((p) => ({
      name: p.name,
      designLead: p.designLead || "Unknown",
      location: p.pbLocation || "",
      ahj: p.ahj || "",
      designStatus: p.designStatus || "",
      revisionCategory: p.revisionCategory,
      daysInRevision: p.daysInRevision,
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
          label="Design Lead"
          options={ownerOptions}
          selected={persistedFilters.owners}
          onChange={(v) => setPersisted({ ...persistedFilters, owners: v })}
          accentColor="indigo"
        />

        {hasActiveFilters && (
          <button
            onClick={() => { clearFilters(); setSearchQuery(""); }}
            className="px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid">
        <MiniStat label="Total in Revision" value={loading ? null : stats.total} />
        <MiniStat label="Avg Days in Revision" value={loading ? null : `${stats.avgDays}d`} alert={stats.avgDays > 14} />
        <MiniStat label="Longest Wait" value={loading ? null : `${stats.longestWait}d`} alert={stats.longestWait > 21} />
        <MiniStat
          label="DA Revisions"
          value={loading ? null : stats.byCategory["DA"] || 0}
          subtitle={`Permit: ${stats.byCategory["Permit"] || 0} \u00B7 Utility: ${stats.byCategory["Utility"] || 0}`}
        />
      </div>

      {/* Category breakdown */}
      {!loading && filteredProjects.length > 0 && (
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
          <div className="p-8 text-center text-muted">No projects currently in design revision.</div>
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
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("category")}>
                    Category{sortIndicator("category")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("designStatus")}>
                    Design Status{sortIndicator("designStatus")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("daysInRevision")}>
                    Days in Revision{sortIndicator("daysInRevision")}
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
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full border ${CATEGORY_COLORS[p.revisionCategory] || CATEGORY_COLORS.Other}`}>
                        {p.revisionCategory}
                      </span>
                    </td>
                    <td className="p-3 text-muted text-xs">{p.designStatus || "—"}</td>
                    <td className="p-3 text-right">
                      <span className={`font-semibold ${p.daysInRevision > 21 ? "text-red-400" : p.daysInRevision > 10 ? "text-yellow-400" : "text-foreground"}`}>
                        {p.daysInRevision}d
                      </span>
                    </td>
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
          <span className="font-medium text-foreground">Note:</span> Revision count tracking is not currently available — HubSpot stores only the current design status.
          Projects that cycle through multiple revisions will show only their current status and time in that status.
          Future enhancement: track revision history via HubSpot property change events.
        </p>
      </div>
    </DashboardShell>
  );
}
