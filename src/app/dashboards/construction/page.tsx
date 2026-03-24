"use client";

import { useEffect, useMemo, useCallback, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { MultiSelectFilter, ProjectSearchBar, FilterGroup } from "@/components/ui/MultiSelectFilter";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useProjectData } from "@/hooks/useProjectData";
import { useConstructionFilters } from "@/stores/dashboard-filters";
import { StatCard } from "@/components/ui/MetricCard";
import { StatusPillRow } from "@/components/ui/StatusPillRow";
import { useSort, sortRows } from "@/hooks/useSort";
import { SortHeader } from "@/components/ui/SortHeader";
import { DealLinks } from "@/components/ui/DealLinks";
import { fmtAmount, fmtDateShort } from "@/lib/format-helpers";

// Construction Status Groups
const CONSTRUCTION_STATUS_GROUPS: FilterGroup[] = [
  {
    name: "Pre-Construction",
    options: [
      { value: "Rejected", label: "Rejected" },
      { value: "Blocked", label: "Blocked" },
      { value: "Ready to Build", label: "Ready to Build" },
      { value: "Scheduled", label: "Scheduled" },
      { value: "Pending New Construction Design Review", label: "Pending New Construction Design Review" },
    ]
  },
  {
    name: "In Progress",
    options: [
      { value: "On Our Way", label: "On Our Way" },
      { value: "Started", label: "Started" },
      { value: "In Progress", label: "In Progress" },
      { value: "Loose Ends Remaining", label: "Loose Ends Remaining" },
    ]
  },
  {
    name: "Completion",
    options: [
      { value: "Construction Complete", label: "Construction Complete" },
    ]
  },
  {
    name: "Revisions",
    options: [
      { value: "Revisions Needed", label: "Revisions Needed" },
      { value: "In Design For Revisions", label: "In Design For Revisions" },
      { value: "Revisions Complete", label: "Revisions Complete" },
    ]
  },
];

// Flatten groups to get all options
const ALL_CONSTRUCTION_STATUS_OPTIONS = CONSTRUCTION_STATUS_GROUPS.flatMap(g => g.options || []);

export default function ConstructionDashboardPage() {
  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, error, refetch, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  // Persisted multi-select filters (survive navigation)
  const { filters, setFilters, clearFilters: clearStore } = useConstructionFilters();
  const filterLocations = filters.locations;
  const filterStages = filters.stages;
  const filterConstructionStatuses = filters.constructionStatuses;
  const searchQuery = filters.search;
  const setFilterLocations = useCallback((v: string[]) => setFilters({ ...filters, locations: v }), [filters, setFilters]);
  const setFilterStages = useCallback((v: string[]) => setFilters({ ...filters, stages: v }), [filters, setFilters]);
  const setFilterConstructionStatuses = useCallback((v: string[]) => setFilters({ ...filters, constructionStatuses: v }), [filters, setFilters]);
  const setSearchQuery = useCallback((v: string) => setFilters({ ...filters, search: v }), [filters, setFilters]);

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("construction", {
        projectCount: safeProjects.length,
      });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // Check if project is in construction phase
  const isInConstructionPhase = useCallback((p: RawProject) => {
    return p.stage === 'Construction' ||
           p.stage === 'Ready To Build' ||
           p.stage === 'RTB - Blocked' ||
           p.constructionStatus ||
           p.constructionScheduleDate ||
           p.constructionCompleteDate;
  }, []);

  const filteredProjects = useMemo(() => {
    return safeProjects.filter(p => {
      if (!isInConstructionPhase(p)) return false;

      // Exclude completed construction (have completion date)
      if (p.constructionCompleteDate) return false;

      // Location filter (multi-select)
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || '')) return false;

      // Stage filter (multi-select)
      if (filterStages.length > 0 && !filterStages.includes(p.stage || '')) return false;

      // Construction Status filter (multi-select)
      if (filterConstructionStatuses.length > 0 && !filterConstructionStatuses.includes(p.constructionStatus || '')) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const name = (p.name || '').toLowerCase();
        const location = (p.pbLocation || '').toLowerCase();
        const projMatch = name.includes(query) || location.includes(query);
        if (!projMatch) return false;
      }

      return true;
    });
  }, [safeProjects, filterLocations, filterStages, filterConstructionStatuses, searchQuery, isInConstructionPhase]);

  const stats = useMemo(() => {
    const inConstruction = filteredProjects.filter(p => p.stage === 'Construction');
    const readyToBuild = filteredProjects.filter(p => p.stage === 'Ready To Build' || p.stage === 'RTB - Blocked');

    // Blocked/Rejected by constructionStatus (not stage) — avoids double-counting RTB - Blocked
    const blockedRejected = filteredProjects.filter(p => {
      const status = (p.constructionStatus || "").toLowerCase();
      return status.includes("blocked") || status.includes("rejected");
    });

    // Calculate construction status breakdown
    const constructionStatusStats: Record<string, number> = {};

    filteredProjects.forEach(p => {
      if (p.constructionStatus) {
        constructionStatusStats[p.constructionStatus] = (constructionStatusStats[p.constructionStatus] || 0) + 1;
      }
    });

    return {
      total: filteredProjects.length,
      totalValue: filteredProjects.reduce((s, p) => s + (p.amount || 0), 0),
      inConstruction,
      readyToBuild,
      blockedRejected,
      constructionStatusStats,
    };
  }, [filteredProjects]);

  // ---- Action table data (use raw safeProjects, not filteredProjects) ----
  const overdueProjects = useMemo(() => {
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    return safeProjects
      .filter((p) => {
        if (!p.constructionScheduleDate || p.constructionCompleteDate) return false;
        const schedDate = new Date(p.constructionScheduleDate + "T00:00:00");
        const daysAgo = Math.floor((todayMidnight.getTime() - schedDate.getTime()) / 86400000);
        return daysAgo >= 3;
      })
      .map((p) => {
        const schedDate = new Date(p.constructionScheduleDate + "T00:00:00");
        const todayMid = new Date();
        todayMid.setHours(0, 0, 0, 0);
        const daysOverdue = Math.floor((todayMid.getTime() - schedDate.getTime()) / 86400000);
        return { ...p, daysOverdue };
      });
  }, [safeProjects]);

  const looseEndsProjects = useMemo(() => {
    return safeProjects.filter(
      (p) => (p.constructionStatus || "").toLowerCase().includes("loose ends")
    );
  }, [safeProjects]);

  // Apply location + search filters only (no stage/status filters) for action tables
  const filteredOverdue = useMemo(() => {
    return overdueProjects.filter((p) => {
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || "")) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!(p.name || "").toLowerCase().includes(q) && !(p.pbLocation || "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [overdueProjects, filterLocations, searchQuery]);

  const filteredLooseEnds = useMemo(() => {
    return looseEndsProjects.filter((p) => {
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || "")) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!(p.name || "").toLowerCase().includes(q) && !(p.pbLocation || "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [looseEndsProjects, filterLocations, searchQuery]);

  const overdueSort = useSort("daysOverdue", "desc");
  const looseEndsSort = useSort("amount", "desc");

  // Get unique values for filters
  const locations = useMemo(() =>
    [...new Set(safeProjects.map(p => p.pbLocation))]
      .filter(l => l && l !== 'Unknown')
      .sort()
      .map(l => ({ value: l!, label: l! })),
    [safeProjects]
  );

  const stages = useMemo(() => {
    const STAGE_ORDER = ['RTB - Blocked', 'Ready To Build', 'Construction', 'Inspection', 'Permission To Operate', 'Close Out'];
    return [...new Set(safeProjects.filter(isInConstructionPhase).map(p => p.stage))]
      .filter(s => s)
      .sort((a, b) => {
        const aIdx = STAGE_ORDER.findIndex(s => s.toLowerCase() === a!.toLowerCase());
        const bIdx = STAGE_ORDER.findIndex(s => s.toLowerCase() === b!.toLowerCase());
        if (aIdx === -1 && bIdx === -1) return a!.localeCompare(b!);
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      })
      .map(s => ({ value: s!, label: s! }));
  }, [safeProjects, isInConstructionPhase]);

  // Get construction statuses that exist in the data
  const existingConstructionStatuses = useMemo(() =>
    new Set(safeProjects.map(p => (p as RawProject).constructionStatus).filter(Boolean)),
    [safeProjects]
  );

  // Filter groups to only include options that exist in the actual data
  const filteredConstructionStatusGroups = useMemo(() => {
    const knownValues = new Set(ALL_CONSTRUCTION_STATUS_OPTIONS.map(o => o.value));
    const uncategorized = [...existingConstructionStatuses].filter(s => !knownValues.has(s as string));

    const filtered = CONSTRUCTION_STATUS_GROUPS.map(group => ({
      ...group,
      options: group.options?.filter(opt => existingConstructionStatuses.has(opt.value)) || []
    })).filter(group => group.options && group.options.length > 0);

    // Add uncategorized values that exist in data but not in predefined groups
    if (uncategorized.length > 0) {
      filtered.push({
        name: "Other",
        options: uncategorized.map(status => ({ value: status as string, label: status as string }))
      });
    }

    return filtered;
  }, [existingConstructionStatuses]);

  // Flatten filtered groups to get all options for the filter component
  const filteredConstructionStatusOptions = useMemo(() =>
    filteredConstructionStatusGroups.flatMap(g => g.options || []),
    [filteredConstructionStatusGroups]
  );

  if (loading) {
    return (
      <DashboardShell title="Construction Execution" accentColor="orange">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500 mx-auto mb-4"></div>
            <p className="text-muted">Loading Construction Data...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Construction Execution" accentColor="orange">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center text-red-500">
            <p className="text-xl mb-2">Error loading data</p>
            <p className="text-sm text-muted">{error}</p>
            <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-orange-600 rounded-lg hover:bg-orange-700">
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const getConstructionStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-muted';
    const lower = status.toLowerCase();
    if (lower.includes('complete') || lower.includes('completed')) return 'bg-green-500/20 text-green-400';
    if (lower.includes('progress') || lower.includes('started')) return 'bg-yellow-500/20 text-yellow-400';
    if (lower.includes('scheduled') || lower.includes('on our way')) return 'bg-blue-500/20 text-blue-400';
    if (lower.includes('ready')) return 'bg-cyan-500/20 text-cyan-400';
    if (lower.includes('revision') || lower.includes('design')) return 'bg-purple-500/20 text-purple-400';
    if (lower.includes('blocked') || lower.includes('rejected')) return 'bg-red-500/20 text-red-400';
    if (lower.includes('loose')) return 'bg-orange-500/20 text-orange-400';
    return 'bg-zinc-500/20 text-muted';
  };

  const clearAllFilters = clearStore;

  const hasActiveFilters = filterLocations.length > 0 || filterStages.length > 0 ||
    filterConstructionStatuses.length > 0 || searchQuery;

  return (
    <DashboardShell title="Construction Execution" accentColor="orange" lastUpdated={lastUpdated}>
      {/* Search and Filters */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Search Bar */}
        <div className="flex items-center gap-3">
          <ProjectSearchBar
            onSearch={setSearchQuery}
            placeholder="Search by PROJ #, name, or address..."
          />
          <button onClick={() => refetch()} className="bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
            Refresh
          </button>
        </div>

        {/* Filter Row */}
        <div className="flex items-center gap-3 flex-wrap">
          <MultiSelectFilter
            label="Location"
            options={locations}
            selected={filterLocations}
            onChange={setFilterLocations}
            placeholder="All Locations"
            accentColor="orange"
          />
          <MultiSelectFilter
            label="Stage"
            options={stages}
            selected={filterStages}
            onChange={setFilterStages}
            placeholder="All Stages"
            accentColor="blue"
          />
          <MultiSelectFilter
            label="Construction Status"
            options={filteredConstructionStatusOptions}
            groups={filteredConstructionStatusGroups}
            selected={filterConstructionStatuses}
            onChange={setFilterConstructionStatuses}
            placeholder="All Statuses"
            accentColor="orange"
          />
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="text-xs text-muted hover:text-foreground px-3 py-2 border border-t-border rounded-lg hover:border-muted transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* StatCards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-grid mb-6">
        <StatCard label="Total Projects" value={stats.total} subtitle={formatMoney(stats.totalValue)} color="orange" />
        <StatCard label="Ready To Build" value={stats.readyToBuild.length} subtitle={formatMoney(stats.readyToBuild.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))} color="cyan" />
        <StatCard label="In Construction" value={stats.inConstruction.length} subtitle={formatMoney(stats.inConstruction.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))} color="yellow" />
        <StatCard label="Blocked / Rejected" value={stats.blockedRejected.length} subtitle="action needed" color="red" />
      </div>

      {/* Status Pill Row */}
      <StatusPillRow
        stats={stats.constructionStatusStats}
        selected={filters.constructionStatuses}
        onToggle={(status) => {
          const current = filters.constructionStatuses;
          setFilters({
            ...filters,
            constructionStatuses: current.includes(status) ? current.filter((s: string) => s !== status) : [...current, status],
          });
        }}
        getStatusColor={getConstructionStatusColor}
        accentColor="orange"
      />

      {/* Construction Overdue */}
      {filteredOverdue.length > 0 && (
        <div className="bg-surface border border-t-border border-l-4 border-l-red-500 rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-t-border">
            <h2 className="text-lg font-semibold text-foreground">Construction Overdue <span className="text-muted font-normal text-sm ml-1">({filteredOverdue.length})</span></h2>
            <p className="text-sm text-muted mt-0.5">Scheduled construction date was 3+ days ago without completion</p>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-t-border bg-surface-2/50">
                  <SortHeader label="Project" sortKey="name" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact className="text-left" />
                  <SortHeader label="Customer" sortKey="name" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact className="text-left" />
                  <SortHeader label="Location" sortKey="pbLocation" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact className="text-left" />
                  <SortHeader label="Stage" sortKey="stage" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact className="text-left" />
                  <SortHeader label="Amount" sortKey="amount" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact className="text-right" />
                  <SortHeader label="Scheduled" sortKey="constructionScheduleDate" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact className="text-center" />
                  <SortHeader label="Days Overdue" sortKey="daysOverdue" currentKey={overdueSort.sortKey} currentDir={overdueSort.sortDir} onSort={overdueSort.toggle} compact className="text-center" />
                  <th className="text-center px-3 py-2 text-xs font-medium text-muted">Links</th>
                </tr>
              </thead>
              <tbody>
                {sortRows(filteredOverdue, overdueSort.sortKey, overdueSort.sortDir).map((p, i) => (
                  <tr key={p.id} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-3 py-2 font-mono text-foreground">{(p.name || "").split("|")[0].trim()}</td>
                    <td className="px-3 py-2 text-foreground truncate max-w-[180px]">{(p.name || "").split("|")[1]?.trim() || ""}</td>
                    <td className="px-3 py-2 text-muted">{p.pbLocation}</td>
                    <td className="px-3 py-2 text-muted">{p.stage}</td>
                    <td className="px-3 py-2 text-right text-muted">{fmtAmount(p.amount)}</td>
                    <td className="text-center px-3 py-2 text-muted">{fmtDateShort(p.constructionScheduleDate)}</td>
                    <td className={`text-center px-3 py-2 font-mono font-medium ${
                      p.daysOverdue > 14 ? "text-red-400" :
                      p.daysOverdue > 7 ? "text-orange-400" : "text-yellow-400"
                    }`}>
                      {p.daysOverdue}d
                    </td>
                    <td className="text-center px-3 py-2">
                      <DealLinks dealId={p.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Loose Ends */}
      {filteredLooseEnds.length > 0 && (
        <div className="bg-surface border border-t-border border-l-4 border-l-orange-500 rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-t-border">
            <h2 className="text-lg font-semibold text-foreground">Loose Ends <span className="text-muted font-normal text-sm ml-1">({filteredLooseEnds.length})</span></h2>
            <p className="text-sm text-muted mt-0.5">Projects with construction status indicating loose ends remaining</p>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-t-border bg-surface-2/50">
                  <SortHeader label="Project" sortKey="name" currentKey={looseEndsSort.sortKey} currentDir={looseEndsSort.sortDir} onSort={looseEndsSort.toggle} compact className="text-left" />
                  <SortHeader label="Customer" sortKey="name" currentKey={looseEndsSort.sortKey} currentDir={looseEndsSort.sortDir} onSort={looseEndsSort.toggle} compact className="text-left" />
                  <SortHeader label="Location" sortKey="pbLocation" currentKey={looseEndsSort.sortKey} currentDir={looseEndsSort.sortDir} onSort={looseEndsSort.toggle} compact className="text-left" />
                  <SortHeader label="Stage" sortKey="stage" currentKey={looseEndsSort.sortKey} currentDir={looseEndsSort.sortDir} onSort={looseEndsSort.toggle} compact className="text-left" />
                  <SortHeader label="Amount" sortKey="amount" currentKey={looseEndsSort.sortKey} currentDir={looseEndsSort.sortDir} onSort={looseEndsSort.toggle} compact className="text-right" />
                  <th className="text-center px-3 py-2 text-xs font-medium text-muted">Links</th>
                </tr>
              </thead>
              <tbody>
                {sortRows(filteredLooseEnds, looseEndsSort.sortKey, looseEndsSort.sortDir).map((p, i) => (
                  <tr key={p.id} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-3 py-2 font-mono text-foreground">{(p.name || "").split("|")[0].trim()}</td>
                    <td className="px-3 py-2 text-foreground truncate max-w-[180px]">{(p.name || "").split("|")[1]?.trim() || ""}</td>
                    <td className="px-3 py-2 text-muted">{p.pbLocation}</td>
                    <td className="px-3 py-2 text-muted">{p.stage}</td>
                    <td className="px-3 py-2 text-right text-muted">{fmtAmount(p.amount)}</td>
                    <td className="text-center px-3 py-2">
                      <DealLinks dealId={p.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Projects Table */}
      <div className="bg-surface rounded-xl border border-t-border overflow-hidden">
        <div className="p-4 border-b border-t-border flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projects ({filteredProjects.length})</h2>
          {hasActiveFilters && (
            <span className="text-xs text-muted">Filtered from {safeProjects.filter(isInConstructionPhase).length} total</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Project</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Construction Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Scheduled</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Completed</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-t-border">
              {filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">No projects found</td>
                </tr>
              ) : (
                filteredProjects
                  .sort((a, b) => {
                    // Sort by stage priority then amount
                    const stagePriority: Record<string, number> = {
                      'Construction': 1,
                      'Ready To Build': 2,
                      'RTB - Blocked': 3,
                    };
                    const aPriority = stagePriority[a.stage || ''] || 99;
                    const bPriority = stagePriority[b.stage || ''] || 99;
                    if (aPriority !== bPriority) return aPriority - bPriority;
                    return (b.amount || 0) - (a.amount || 0);
                  })
                  .slice(0, 100)
                  .map(project => (
                    <tr key={project.id} className="hover:bg-surface/50">
                      <td className="px-4 py-3">
                        <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-orange-400">
                          {project.name.split('|')[0].trim()}
                        </a>
                        <div className="text-xs text-muted">{project.name.split('|')[1]?.trim() || ''}</div>
                        <div className="text-xs text-muted">{project.pbLocation}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">{project.stage}</td>
                      <td className="px-4 py-3">
                        {project.constructionStatus ? (
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getConstructionStatusColor(project.constructionStatus)}`}>
                            {project.constructionStatus}
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-sm ${project.constructionScheduleDate ? 'text-blue-400' : 'text-muted'}`}>
                        {project.constructionScheduleDate || '-'}
                      </td>
                      <td className={`px-4 py-3 text-sm ${project.constructionCompleteDate ? 'text-green-400' : 'text-muted'}`}>
                        {project.constructionCompleteDate || '-'}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-sm ${(project.amount || 0) > 0 ? 'text-green-400' : 'text-muted'}`}>
                        {formatMoney(project.amount || 0)}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
