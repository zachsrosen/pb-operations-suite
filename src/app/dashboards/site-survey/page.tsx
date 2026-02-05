"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { MultiSelectFilter, ProjectSearchBar, FilterGroup } from "@/components/ui/MultiSelectFilter";

interface ExtendedProject extends RawProject {
  siteSurveyStatus?: string;
  siteSurveyScheduleDate?: string;
  siteSurveyCompletionDate?: string;
}

// Site Survey Status Groups
const SITE_SURVEY_STATUS_GROUPS: FilterGroup[] = [
  {
    name: "Scheduling",
    options: [
      { value: "Ready to Schedule", label: "Ready to Schedule" },
      { value: "Awaiting Reply", label: "Awaiting Reply" },
      { value: "Scheduled", label: "Scheduled" },
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
      { value: "Needs Revisit", label: "Needs Revisit" },
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
  const [projects, setProjects] = useState<ExtendedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Multi-select filters
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterSiteSurveyStatuses, setFilterSiteSurveyStatuses] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch("/api/projects?context=executive");
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      setProjects(data.projects);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Check if project is in site survey phase
  const isInSiteSurveyPhase = useCallback((p: ExtendedProject) => {
    return p.stage === 'Site Survey' ||
           p.siteSurveyStatus ||
           p.siteSurveyScheduleDate ||
           (p.siteSurveyCompletionDate && p.stage === 'Design & Engineering');
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (!isInSiteSurveyPhase(p)) return false;

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

  const stats = useMemo(() => {
    const today = new Date();
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

    // Calculate average days to complete site survey
    const surveyTurnaroundDays = filteredProjects
      .filter(p => p.closeDate && p.siteSurveyCompletionDate)
      .map(p => {
        const d1 = new Date(p.closeDate!);
        const d2 = new Date(p.siteSurveyCompletionDate!);
        return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter(d => d >= 0);
    const avgSurveyTurnaround = surveyTurnaroundDays.length > 0
      ? Math.round(surveyTurnaroundDays.reduce((a, b) => a + b, 0) / surveyTurnaroundDays.length)
      : 0;

    return {
      total: filteredProjects.length,
      totalValue: filteredProjects.reduce((s, p) => s + (p.amount || 0), 0),
      inSiteSurveyStage,
      scheduled,
      completed,
      needsScheduling,
      siteSurveyStatusStats,
      avgSurveyTurnaround,
    };
  }, [filteredProjects]);

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
    new Set(projects.map(p => (p as ExtendedProject).siteSurveyStatus).filter(Boolean)),
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
      <DashboardShell title="Site Survey" accentColor="teal">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-teal-500 mx-auto mb-4"></div>
            <p className="text-zinc-400">Loading Site Survey Data...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Site Survey" accentColor="teal">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center text-red-500">
            <p className="text-xl mb-2">Error loading data</p>
            <p className="text-sm text-zinc-400">{error}</p>
            <button onClick={fetchData} className="mt-4 px-4 py-2 bg-teal-600 rounded-lg hover:bg-teal-700">
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const getSiteSurveyStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-zinc-400';
    const lower = status.toLowerCase();
    if (lower.includes('complete') || lower.includes('completed')) return 'bg-green-500/20 text-green-400';
    if (lower.includes('progress') || lower.includes('started') || lower.includes('on our way')) return 'bg-yellow-500/20 text-yellow-400';
    if (lower.includes('scheduled')) return 'bg-blue-500/20 text-blue-400';
    if (lower.includes('ready')) return 'bg-cyan-500/20 text-cyan-400';
    if (lower.includes('awaiting') || lower.includes('pending') || lower.includes('waiting')) return 'bg-purple-500/20 text-purple-400';
    if (lower.includes('hold') || lower.includes('no site survey')) return 'bg-zinc-500/20 text-zinc-400';
    if (lower.includes('revisit') || lower.includes('needs')) return 'bg-orange-500/20 text-orange-400';
    return 'bg-zinc-500/20 text-zinc-400';
  };

  const clearAllFilters = () => {
    setFilterLocations([]);
    setFilterStages([]);
    setFilterSiteSurveyStatuses([]);
    setSearchQuery("");
  };

  const hasActiveFilters = filterLocations.length > 0 || filterStages.length > 0 ||
    filterSiteSurveyStatuses.length > 0 || searchQuery;

  return (
    <DashboardShell title="Site Survey" accentColor="teal">
      {/* Search and Filters */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Search Bar */}
        <div className="flex items-center gap-3">
          <ProjectSearchBar
            onSearch={setSearchQuery}
            placeholder="Search by PROJ #, name, or address..."
          />
          <button onClick={fetchData} className="bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
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
              className="text-xs text-zinc-400 hover:text-white px-3 py-2 border border-zinc-700 rounded-lg hover:border-zinc-600 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-teal-400">{stats.total}</div>
          <div className="text-sm text-zinc-400">Total Projects</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.totalValue)}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-cyan-400">{stats.needsScheduling.length}</div>
          <div className="text-sm text-zinc-400">Needs Scheduling</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.needsScheduling.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-blue-400">{stats.scheduled.length}</div>
          <div className="text-sm text-zinc-400">Scheduled</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.scheduled.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-green-400">{stats.completed.length}</div>
          <div className="text-sm text-zinc-400">Completed</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.completed.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
      </div>

      {/* Additional Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-yellow-400">{stats.inSiteSurveyStage.length}</div>
          <div className="text-sm text-zinc-400">In Site Survey Stage</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-purple-400">{stats.avgSurveyTurnaround}d</div>
          <div className="text-sm text-zinc-400">Avg Survey Turnaround</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-amber-400">{Object.keys(stats.siteSurveyStatusStats).length}</div>
          <div className="text-sm text-zinc-400">Active Statuses</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-red-400">
            {filteredProjects.filter(p =>
              p.siteSurveyStatus?.toLowerCase().includes('hold') ||
              p.siteSurveyStatus?.toLowerCase().includes('waiting') ||
              p.siteSurveyStatus?.toLowerCase().includes('pending')
            ).length}
          </div>
          <div className="text-sm text-zinc-400">On Hold/Waiting</div>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4 text-teal-400">By Site Survey Status</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {Object.keys(stats.siteSurveyStatusStats).length === 0 ? (
            <p className="text-zinc-500 text-sm col-span-full">No site survey status data available</p>
          ) : (
            Object.entries(stats.siteSurveyStatusStats)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => (
                <div
                  key={status}
                  className={`flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg cursor-pointer hover:bg-zinc-800 transition-colors ${
                    filterSiteSurveyStatuses.includes(status) ? 'ring-1 ring-teal-500' : ''
                  }`}
                  onClick={() => {
                    if (filterSiteSurveyStatuses.includes(status)) {
                      setFilterSiteSurveyStatuses(filterSiteSurveyStatuses.filter(s => s !== status));
                    } else {
                      setFilterSiteSurveyStatuses([...filterSiteSurveyStatuses, status]);
                    }
                  }}
                >
                  <span className="text-xs text-zinc-300 truncate mr-2">{status}</span>
                  <span className="text-lg font-bold text-teal-400">{count}</span>
                </div>
              ))
          )}
        </div>
      </div>

      {/* Projects Table */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 overflow-hidden">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projects ({filteredProjects.length})</h2>
          {hasActiveFilters && (
            <span className="text-xs text-zinc-500">Filtered from {projects.filter(isInSiteSurveyPhase).length} total</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Project</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Site Survey Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Scheduled</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Completed</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-400 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">No projects found</td>
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
                    <tr key={project.id} className="hover:bg-zinc-900/50">
                      <td className="px-4 py-3">
                        <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-white hover:text-teal-400">
                          {project.name.split('|')[0].trim()}
                        </a>
                        <div className="text-xs text-zinc-500">{project.pbLocation}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">{project.stage}</td>
                      <td className="px-4 py-3">
                        {project.siteSurveyStatus ? (
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getSiteSurveyStatusColor(project.siteSurveyStatus)}`}>
                            {project.siteSurveyStatus}
                          </span>
                        ) : (
                          <span className="text-zinc-500">-</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-sm ${project.siteSurveyScheduleDate ? 'text-blue-400' : 'text-zinc-500'}`}>
                        {project.siteSurveyScheduleDate || '-'}
                      </td>
                      <td className={`px-4 py-3 text-sm ${project.siteSurveyCompletionDate ? 'text-green-400' : 'text-zinc-500'}`}>
                        {project.siteSurveyCompletionDate || '-'}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-sm ${(project.amount || 0) > 0 ? 'text-green-400' : 'text-zinc-500'}`}>
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
