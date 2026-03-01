"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { formatMoney, formatDate } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { usePendingApprovalFilters } from "@/stores/dashboard-filters";

// Design Approval (layout) statuses that indicate "pending" — NOT approved/rejected/revision
const PENDING_APPROVAL_STATUSES = [
  "Sent For Approval",
  "Resent For Approval",
  "Sent to Customer",
  "Review In Progress",
  "Draft Complete",
  "Pending Review",
  "Ready For Review",
  "Ready",
  "Draft Created",
];

type SortField = "name" | "layoutStatus" | "daysWaiting" | "amount" | "owner" | "location" | "designStatus" | "designComplete" | "daSent";
type SortDir = "asc" | "desc";

export default function PendingApprovalPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  const [sortField, setSortField] = useState<SortField>("daysWaiting");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Filter state
  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = usePendingApprovalFilters();
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("pending-approval", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // Filter to projects with pending approval statuses
  const pendingProjects = useMemo(() => {
    return safeProjects
      .filter((p) => p.layoutStatus && PENDING_APPROVAL_STATUSES.includes(p.layoutStatus))
      .map((p) => ({
        ...p,
        daysWaiting: p.daysSinceStageMovement ?? 0,
      }));
  }, [safeProjects]);

  // Build filter options from pending projects
  const locationOptions: FilterOption[] = useMemo(() => {
    const locs = [...new Set(pendingProjects.map((p) => p.pbLocation).filter(Boolean))] as string[];
    return locs.sort().map((l) => ({ value: l, label: l }));
  }, [pendingProjects]);

  const ownerOptions: FilterOption[] = useMemo(() => {
    const owners = [...new Set(pendingProjects.map((p) => p.projectManager || "Unknown"))] as string[];
    return owners.sort().map((o) => ({ value: o, label: o }));
  }, [pendingProjects]);

  const hasActiveFilters = persistedFilters.locations.length > 0 || persistedFilters.owners.length > 0 || searchQuery.length > 0;

  // Filtered projects
  const filteredProjects = useMemo(() => {
    let result = pendingProjects;

    if (persistedFilters.locations.length > 0) {
      result = result.filter((p) => persistedFilters.locations.includes(p.pbLocation || ""));
    }
    if (persistedFilters.owners.length > 0) {
      result = result.filter((p) => persistedFilters.owners.includes(p.projectManager || "Unknown"));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.projectManager || "").toLowerCase().includes(q) ||
          (p.pbLocation || "").toLowerCase().includes(q) ||
          (p.layoutStatus || "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [pendingProjects, persistedFilters, searchQuery]);

  // Sort
  const sortedProjects = useMemo(() => {
    const sorted = [...filteredProjects];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "owner": cmp = (a.projectManager || "Unknown").localeCompare(b.projectManager || "Unknown"); break;
        case "location": cmp = (a.pbLocation || "").localeCompare(b.pbLocation || ""); break;
        case "layoutStatus": cmp = (a.layoutStatus || "").localeCompare(b.layoutStatus || ""); break;
        case "designStatus": cmp = (a.designStatus || "").localeCompare(b.designStatus || ""); break;
        case "daysWaiting": cmp = a.daysWaiting - b.daysWaiting; break;
        case "designComplete": cmp = (a.designCompletionDate || "").localeCompare(b.designCompletionDate || ""); break;
        case "daSent": cmp = (a.designApprovalSentDate || "").localeCompare(b.designApprovalSentDate || ""); break;
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

  // Stats (computed from filtered set)
  const stats = useMemo(() => {
    const total = filteredProjects.length;
    const days = filteredProjects.map((p) => p.daysWaiting);
    const avgDays = days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0;
    const longestWait = days.length > 0 ? Math.max(...days) : 0;
    return { total, avgDays, longestWait };
  }, [filteredProjects]);

  // Export
  const exportRows = useMemo(
    () => sortedProjects.map((p) => ({
      name: p.name,
      pm: p.projectManager || "Unknown",
      location: p.pbLocation || "",
      layoutStatus: p.layoutStatus || "",
      designStatus: p.designStatus || "",
      daysWaiting: p.daysWaiting,
      amount: p.amount || 0,
      designCompletionDate: p.designCompletionDate || "",
      designApprovalSentDate: p.designApprovalSentDate || "",
    })),
    [sortedProjects]
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅";

  return (
    <DashboardShell
      title="Pending Design Approval"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "pending-design-approval.csv" }}
      fullWidth
    >
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 stagger-grid mb-6">
        <MiniStat label="Total Pending" value={loading ? null : stats.total} />
        <MiniStat label="Avg Days Waiting" value={loading ? null : `${stats.avgDays}d`} alert={stats.avgDays > 10} />
        <MiniStat label="Longest Wait" value={loading ? null : `${stats.longestWait}d`} alert={stats.longestWait > 21} />
      </div>

      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, PM, location..."
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
          onChange={(locations) => setPersisted({ ...persistedFilters, locations })}
          accentColor="indigo"
        />
        <MultiSelectFilter
          label="PM"
          options={ownerOptions}
          selected={persistedFilters.owners}
          onChange={(owners) => setPersisted({ ...persistedFilters, owners })}
          accentColor="indigo"
        />

        {hasActiveFilters && (
          <button
            onClick={() => { clearFilters(); setSearchQuery(""); }}
            className="text-xs px-3 py-2 rounded-lg border border-t-border text-muted hover:text-foreground hover:border-muted transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden mb-6">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="p-8 text-center text-muted">
            {hasActiveFilters
              ? "No projects match the current filters."
              : "No projects currently pending design approval."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Project{sortIndicator("name")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("owner")}>
                    PM{sortIndicator("owner")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("location")}>
                    Location{sortIndicator("location")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("layoutStatus")}>
                    DA Status{sortIndicator("layoutStatus")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("designStatus")}>
                    Design Status{sortIndicator("designStatus")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("daysWaiting")}>
                    Days Waiting{sortIndicator("daysWaiting")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("daSent")}>
                    DA Sent{sortIndicator("daSent")}
                  </th>
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
                    <td className="p-3 text-muted">{p.projectManager || "Unknown"}</td>
                    <td className="p-3 text-muted">{p.pbLocation || "—"}</td>
                    <td className="p-3">
                      <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                        {p.layoutStatus}
                      </span>
                    </td>
                    <td className="p-3 text-muted">{p.designStatus || "—"}</td>
                    <td className="p-3 text-right">
                      <span className={`font-semibold ${p.daysWaiting > 21 ? "text-red-400" : p.daysWaiting > 10 ? "text-yellow-400" : "text-foreground"}`}>
                        {p.daysWaiting}d
                      </span>
                    </td>
                    <td className="p-3 text-muted">{p.designApprovalSentDate ? formatDate(p.designApprovalSentDate) : "—"}</td>
                    <td className="p-3 text-muted">{formatDate(p.designCompletionDate)}</td>
                    <td className="p-3 text-right text-foreground">{formatMoney(p.amount || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
