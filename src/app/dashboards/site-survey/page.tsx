"use client";

import { useEffect, useMemo, useCallback, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { MultiSelectFilter, ProjectSearchBar, FilterGroup } from "@/components/ui/MultiSelectFilter";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useProjectData } from "@/hooks/useProjectData";
import { useSiteSurveyFilters } from "@/stores/dashboard-filters";
import { useSort, sortRows } from "@/hooks/useSort";
import { SortHeader } from "@/components/ui/SortHeader";
import { DealLinks } from "@/components/ui/DealLinks";
import { fmtAmount, fmtDateShort } from "@/lib/format-helpers";
import { StatCard } from "@/components/ui/MetricCard";
import { StatusPillRow } from "@/components/ui/StatusPillRow";

// Site Survey Status Groups
const SITE_SURVEY_STATUS_GROUPS: FilterGroup[] = [
  {
    name: "Scheduling",
    options: [
      { value: "Ready to Schedule", label: "Ready to Schedule" },
      { value: "Awaiting Reply", label: "Awaiting Reply" },
      { value: "Scheduled", label: "Scheduled" },
      { value: "Needs Revisit", label: "Needs Revisit" },
    ]
  },
  {
    name: "In Progress",
    options: [
      { value: "On Our Way", label: "On Our Way" },
      { value: "Started", label: "Started" },
      { value: "In Progress", label: "In Progress" },
    ]
  },
  {
    name: "Completion",
    options: [
      { value: "Completed", label: "Completed" },
    ]
  },
  {
    name: "On Hold",
    options: [
      { value: "Scheduling On-Hold", label: "Scheduling On-Hold" },
      { value: "No Site Survey Needed", label: "No Site Survey Needed" },
      { value: "Pending Loan Approval", label: "Pending Loan Approval" },
      { value: "Waiting on Change Order", label: "Waiting on Change Order" },
    ]
  },
];

// Flatten groups to get all options
const ALL_SITE_SURVEY_STATUS_OPTIONS = SITE_SURVEY_STATUS_GROUPS.flatMap(g => g.options || []);

export default function SiteSurveyDashboardPage() {
  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: rawProjects, loading, error, refetch } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const projects = rawProjects ?? [];

  // Persisted multi-select filters (survive navigation)
  const { filters, setFilters, clearFilters: clearStore } = useSiteSurveyFilters();
  const filterLocations = filters.locations;
  const filterStages = filters.stages;
  const filterSiteSurveyStatuses = filters.siteSurveyStatuses;
  const searchQuery = filters.search;
  const setFilterLocations = useCallback((v: string[]) => setFilters({ ...filters, locations: v }), [filters, setFilters]);
  const setFilterStages = useCallback((v: string[]) => setFilters({ ...filters, stages: v }), [filters, setFilters]);
  const setFilterSiteSurveyStatuses = useCallback((v: string[]) => setFilters({ ...filters, siteSurveyStatuses: v }), [filters, setFilters]);
  const setSearchQuery = useCallback((v: string) => setFilters({ ...filters, search: v }), [filters, setFilters]);

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("site-survey", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

  // Check if project is in site survey phase
  const isInSiteSurveyPhase = useCallback((p: RawProject) => {
    return p.stage === 'Site Survey' ||
           p.siteSurveyStatus ||
           p.siteSurveyScheduleDate ||
           (p.siteSurveyCompletionDate && p.stage === 'Design & Engineering');
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (!isInSiteSurveyPhase(p)) return false;

      // Exclude completed surveys (have completion date)
      if (p.siteSurveyCompletionDate) return false;

      // Location filter (multi-select)
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || '')) return false;

      // Stage filter (multi-select)
      if (filterStages.length > 0 && !filterStages.includes(p.stage || '')) return false;

      // Site Survey Status filter (multi-select)
      if (filterSiteSurveyStatuses.length > 0 && !filterSiteSurveyStatuses.includes(p.siteSurveyStatus || '')) return false;

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
  }, [projects, filterLocations, filterStages, filterSiteSurveyStatuses, searchQuery, isInSiteSurveyPhase]);

  const surveyClassification = useMemo(() => {
    if (!rawProjects) return { pastDue: [], upcoming: [] };

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    const pastDue: Array<typeof rawProjects[number] & { daysUntil: number }> = [];
    const upcoming: Array<typeof rawProjects[number] & { daysUntil: number }> = [];

    for (const p of rawProjects) {
      // Must have a scheduled date and no completion date
      if (!p.siteSurveyScheduleDate || p.siteSurveyCompletionDate) continue;
      // Must be in a site-survey-relevant phase
      if (!isInSiteSurveyPhase(p)) continue;

      const schedDate = new Date(p.siteSurveyScheduleDate + "T00:00:00");
      const daysUntil = Math.floor((schedDate.getTime() - todayMidnight.getTime()) / 86400000);

      const augmented = { ...p, daysUntil };
      if (daysUntil < 0) {
        pastDue.push(augmented);
      } else {
        upcoming.push(augmented);
      }
    }

    return { pastDue, upcoming };
  }, [rawProjects, isInSiteSurveyPhase]);

  // Filter past-due/upcoming by location and search only.
  // Stage and status filters do NOT apply — these tables define their own
  // status semantics (past-due vs upcoming) and span multiple stages.
  const filteredPastDue = useMemo(() => {
    return surveyClassification.pastDue.filter((p) => {
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || "")) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !(p.name || "").toLowerCase().includes(q) &&
          !(p.pbLocation || "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [surveyClassification.pastDue, filterLocations, searchQuery]);

  const filteredUpcoming = useMemo(() => {
    return surveyClassification.upcoming.filter((p) => {
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || "")) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !(p.name || "").toLowerCase().includes(q) &&
          !(p.pbLocation || "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [surveyClassification.upcoming, filterLocations, searchQuery]);

  const pastDueSort = useSort("daysUntil", "asc");
  const upcomingSort = useSort("daysUntil", "asc");

  const stats = useMemo(() => {
    const inSiteSurveyStage = filteredProjects.filter(p => p.stage === 'Site Survey');
    const scheduled = filteredProjects.filter(p => p.siteSurveyScheduleDate && !p.siteSurveyCompletionDate);
    const completed = filteredProjects.filter(p => p.siteSurveyCompletionDate);
    const needsScheduling = filteredProjects.filter(p =>
      p.stage === 'Site Survey' && !p.siteSurveyScheduleDate && !p.siteSurveyCompletionDate
    );

    // Calculate site survey status breakdown
    const siteSurveyStatusStats: Record<string, number> = {};

    filteredProjects.forEach(p => {
      if (p.siteSurveyStatus) {
        siteSurveyStatusStats[p.siteSurveyStatus] = (siteSurveyStatusStats[p.siteSurveyStatus] || 0) + 1;
      }
    });

    // At Risk: distinct union of on-hold + past-due project IDs
    const atRiskIds = new Set<string>();
    filteredProjects.forEach(p => {
      const lower = p.siteSurveyStatus?.toLowerCase() || '';
      if (lower.includes('hold') || lower.includes('waiting') || lower.includes('pending')) {
        atRiskIds.add(p.id);
      }
    });
    filteredPastDue.forEach(p => atRiskIds.add(p.id));
    const atRiskCount = atRiskIds.size;

    return {
      total: filteredProjects.length,
      totalValue: filteredProjects.reduce((s, p) => s + (p.amount || 0), 0),
      inSiteSurveyStage,
      scheduled,
      completed,
      needsScheduling,
      siteSurveyStatusStats,
      atRiskCount,
    };
  }, [filteredProjects, filteredPastDue]);

  // Get unique values for filters
  const locations = useMemo(() =>
    [...new Set(projects.map(p => p.pbLocation))]
      .filter(l => l && l !== 'Unknown')
      .sort()
      .map(l => ({ value: l!, label: l! })),
    [projects]
  );

  const stages = useMemo(() => {
    const STAGE_ORDER = ['Site Survey', 'Design & Engineering', 'Permitting & Interconnection'];
    return [...new Set(projects.filter(isInSiteSurveyPhase).map(p => p.stage))]
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
  }, [projects, isInSiteSurveyPhase]);

  // Get statuses that exist in the data
  const existingSiteSurveyStatuses = useMemo(() =>
    new Set(projects.map(p => (p as RawProject).siteSurveyStatus).filter(Boolean)),
    [projects]
  );

  // Filter groups to only include options that exist in the actual data
  const filteredSiteSurveyStatusGroups = useMemo(() => {
    const knownValues = new Set(ALL_SITE_SURVEY_STATUS_OPTIONS.map(o => o.value));
    const uncategorized = [...existingSiteSurveyStatuses].filter(s => !knownValues.has(s as string));

    const filtered = SITE_SURVEY_STATUS_GROUPS.map(group => ({
      ...group,
      options: group.options?.filter(opt => existingSiteSurveyStatuses.has(opt.value)) || []
    })).filter(group => group.options && group.options.length > 0);

    if (uncategorized.length > 0) {
      filtered.push({
        name: "Other",
        options: uncategorized.map(status => ({ value: status as string, label: status as string }))
      });
    }

    return filtered;
  }, [existingSiteSurveyStatuses]);

  // Flatten filtered groups to get all options
  const filteredSiteSurveyStatusOptions = useMemo(() =>
    filteredSiteSurveyStatusGroups.flatMap(g => g.options || []),
    [filteredSiteSurveyStatusGroups]
  );

  if (loading) {
    return (
      <DashboardShell title="Site Survey Execution" accentColor="teal">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-teal-500 mx-auto mb-4"></div>
            <p className="text-muted">Loading Site Survey Data...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Site Survey Execution" accentColor="teal">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center text-red-500">
            <p className="text-xl mb-2">Error loading data</p>
            <p className="text-sm text-muted">{error}</p>
            <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-teal-600 rounded-lg hover:bg-teal-700">
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const getSiteSurveyStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-muted';
    const lower = status.toLowerCase();
    if (lower.includes('complete') || lower.includes('completed')) return 'bg-green-500/20 text-green-400';
    if (lower.includes('progress') || lower.includes('started') || lower.includes('on our way')) return 'bg-yellow-500/20 text-yellow-400';
    if (lower.includes('scheduled')) return 'bg-blue-500/20 text-blue-400';
    if (lower.includes('ready')) return 'bg-cyan-500/20 text-cyan-400';
    if (lower.includes('awaiting') || lower.includes('pending') || lower.includes('waiting')) return 'bg-purple-500/20 text-purple-400';
    if (lower.includes('hold') || lower.includes('no site survey')) return 'bg-zinc-500/20 text-muted';
    if (lower.includes('revisit') || lower.includes('needs')) return 'bg-orange-500/20 text-orange-400';
    return 'bg-zinc-500/20 text-muted';
  };

  const clearAllFilters = () => {
    clearStore();
  };

  const hasActiveFilters = filterLocations.length > 0 || filterStages.length > 0 ||
    filterSiteSurveyStatuses.length > 0 || searchQuery;

  return (
    <DashboardShell title="Site Survey Execution" accentColor="teal">
      {/* Search and Filters */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Search Bar */}
        <div className="flex items-center gap-3">
          <ProjectSearchBar
            onSearch={setSearchQuery}
            placeholder="Search by PROJ #, name, or address..."
          />
          <button onClick={() => refetch()} className="bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
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
            accentColor="teal"
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
            label="Site Survey Status"
            options={filteredSiteSurveyStatusOptions}
            groups={filteredSiteSurveyStatusGroups}
            selected={filterSiteSurveyStatuses}
            onChange={setFilterSiteSurveyStatuses}
            placeholder="All Statuses"
            accentColor="cyan"
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
        <StatCard label="Total Projects" value={stats.total} subtitle={formatMoney(stats.totalValue)} color="teal" />
        <StatCard label="Needs Scheduling" value={stats.needsScheduling.length} subtitle={formatMoney(stats.needsScheduling.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))} color="cyan" />
        <StatCard label="Scheduled" value={stats.scheduled.length} subtitle={formatMoney(stats.scheduled.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))} color="yellow" />
        <StatCard label="On Hold / Past Due" value={stats.atRiskCount} subtitle="action needed" color="red" />
      </div>

      {/* Status Pill Row */}
      <StatusPillRow
        stats={stats.siteSurveyStatusStats}
        selected={filters.siteSurveyStatuses}
        onToggle={(status) => {
          const current = filters.siteSurveyStatuses;
          setFilters({
            ...filters,
            siteSurveyStatuses: current.includes(status) ? current.filter(s => s !== status) : [...current, status],
          });
        }}
        getStatusColor={getSiteSurveyStatusColor}
        accentColor="teal"
      />

      {/* Past Due Surveys */}
      {filteredPastDue.length > 0 && (
        <div className="bg-surface border border-red-500/30 rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-t-border">
            <h2 className="text-lg font-semibold text-foreground">Past Due Surveys</h2>
            <p className="text-sm text-muted mt-0.5">
              {filteredPastDue.length} survey{filteredPastDue.length !== 1 ? "s" : ""} where the scheduled date has passed but survey is not complete
            </p>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-t-border bg-surface-2/50">
                  <SortHeader label="Project" sortKey="name" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-left" />
                  <SortHeader label="Customer" sortKey="name" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-left" />
                  <SortHeader label="Location" sortKey="pbLocation" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-left" />
                  <SortHeader label="Surveyor" sortKey="siteSurveyor" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-left" />
                  <SortHeader label="Stage" sortKey="stage" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-left" />
                  <SortHeader label="Amount" sortKey="amount" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-right" />
                  <SortHeader label="Scheduled" sortKey="siteSurveyScheduleDate" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-center" />
                  <SortHeader label="Days Overdue" sortKey="daysUntil" currentKey={pastDueSort.sortKey} currentDir={pastDueSort.sortDir} onSort={pastDueSort.toggle} className="text-center" />
                  <th className="text-center px-4 py-3 font-semibold text-foreground">Links</th>
                </tr>
              </thead>
              <tbody>
                {sortRows(filteredPastDue, pastDueSort.sortKey, pastDueSort.sortDir).map((p, i) => (
                  <tr key={p.id} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-4 py-3 font-mono text-foreground">{p.name.split("|")[0].trim()}</td>
                    <td className="px-4 py-3 text-foreground truncate max-w-[180px]">{p.name.split("|")[1]?.trim() || ""}</td>
                    <td className="px-4 py-3 text-muted">{p.pbLocation}</td>
                    <td className="px-4 py-3 text-muted">{p.siteSurveyor || "--"}</td>
                    <td className="px-4 py-3 text-muted">{p.stage}</td>
                    <td className="px-4 py-3 text-right text-muted">{fmtAmount(p.amount)}</td>
                    <td className="text-center px-4 py-3 text-muted">{fmtDateShort(p.siteSurveyScheduleDate)}</td>
                    <td className={`text-center px-4 py-3 font-mono font-medium ${
                      Math.abs(p.daysUntil) > 7 ? "text-red-400" :
                      Math.abs(p.daysUntil) > 3 ? "text-orange-400" : "text-yellow-400"
                    }`}>
                      {Math.abs(p.daysUntil)}d overdue
                    </td>
                    <td className="text-center px-4 py-3">
                      <DealLinks dealId={p.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Upcoming Surveys */}
      {filteredUpcoming.length > 0 && (
        <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-t-border">
            <h2 className="text-lg font-semibold text-foreground">Upcoming Surveys</h2>
            <p className="text-sm text-muted mt-0.5">
              {filteredUpcoming.length} survey{filteredUpcoming.length !== 1 ? "s" : ""} scheduled for a future date
            </p>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-t-border bg-surface-2/50">
                  <SortHeader label="Project" sortKey="name" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-left" />
                  <SortHeader label="Customer" sortKey="name" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-left" />
                  <SortHeader label="Location" sortKey="pbLocation" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-left" />
                  <SortHeader label="Surveyor" sortKey="siteSurveyor" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-left" />
                  <SortHeader label="Stage" sortKey="stage" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-left" />
                  <SortHeader label="Amount" sortKey="amount" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-right" />
                  <SortHeader label="Scheduled" sortKey="siteSurveyScheduleDate" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-center" />
                  <SortHeader label="Days Until" sortKey="daysUntil" currentKey={upcomingSort.sortKey} currentDir={upcomingSort.sortDir} onSort={upcomingSort.toggle} className="text-center" />
                  <th className="text-center px-4 py-3 font-semibold text-foreground">Links</th>
                </tr>
              </thead>
              <tbody>
                {sortRows(filteredUpcoming, upcomingSort.sortKey, upcomingSort.sortDir).map((p, i) => (
                  <tr key={p.id} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-4 py-3 font-mono text-foreground">{p.name.split("|")[0].trim()}</td>
                    <td className="px-4 py-3 text-foreground truncate max-w-[180px]">{p.name.split("|")[1]?.trim() || ""}</td>
                    <td className="px-4 py-3 text-muted">{p.pbLocation}</td>
                    <td className="px-4 py-3 text-muted">{p.siteSurveyor || "--"}</td>
                    <td className="px-4 py-3 text-muted">{p.stage}</td>
                    <td className="px-4 py-3 text-right text-muted">{fmtAmount(p.amount)}</td>
                    <td className="text-center px-4 py-3 text-muted">{fmtDateShort(p.siteSurveyScheduleDate)}</td>
                    <td className={`text-center px-4 py-3 font-mono font-medium ${
                      p.daysUntil <= 1 ? "text-emerald-400" :
                      p.daysUntil <= 3 ? "text-yellow-400" : "text-muted"
                    }`}>
                      {p.daysUntil}d
                    </td>
                    <td className="text-center px-4 py-3">
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
            <span className="text-xs text-muted">Filtered from {projects.filter(isInSiteSurveyPhase).length} total</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Project</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Site Survey Status</th>
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
                      'Site Survey': 1,
                      'Design & Engineering': 2,
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
                        <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-teal-400">
                          {project.name.split('|')[0].trim()}
                        </a>
                        <div className="text-xs text-muted">{project.name.split('|')[1]?.trim() || ''}</div>
                        <div className="text-xs text-muted">{project.pbLocation}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">{project.stage}</td>
                      <td className="px-4 py-3">
                        {project.siteSurveyStatus ? (
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getSiteSurveyStatusColor(project.siteSurveyStatus)}`}>
                            {project.siteSurveyStatus}
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-sm ${project.siteSurveyScheduleDate ? 'text-blue-400' : 'text-muted'}`}>
                        {project.siteSurveyScheduleDate || '-'}
                      </td>
                      <td className={`px-4 py-3 text-sm ${project.siteSurveyCompletionDate ? 'text-green-400' : 'text-muted'}`}>
                        {project.siteSurveyCompletionDate || '-'}
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
