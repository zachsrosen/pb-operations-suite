"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { MultiSelectFilter, ProjectSearchBar, FilterGroup } from "@/components/ui/MultiSelectFilter";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// Display name mappings
const DISPLAY_NAMES: Record<string, string> = {
  'permit_submitted': 'Permit Submitted',
  'permit_issued': 'Permit Issued',
  'permit_approved': 'Permit Approved',
  'in_review': 'In Review',
  'pending_corrections': 'Pending Corrections',
  'corrections_submitted': 'Corrections Submitted',
  'ready_to_submit': 'Ready to Submit',
  'not_started': 'Not Started',
  'on_hold': 'On Hold',
  'submitted': 'Submitted',
  'pending': 'Pending',
  'approved': 'Approved',
  'issued': 'Issued',
  'complete': 'Complete',
  'completed': 'Completed',
  'in_progress': 'In Progress',
  'passed': 'Passed',
  'failed': 'Failed',
  'scheduled': 'Scheduled',
  'not_applicable': 'Not Applicable',
  'n_a': 'N/A',
  'na': 'N/A'
};

function getDisplayName(value: string | undefined): string {
  if (!value) return value || '';
  const key = value.toLowerCase().replace(/[\s-]+/g, '_');
  return DISPLAY_NAMES[key] || value;
}

interface ExtendedProject extends RawProject {
  permittingStatus?: string;
  finalInspectionStatus?: string;
}

// Permitting Status Groups
const PERMITTING_STATUS_GROUPS: FilterGroup[] = [
  {
    name: "Pre-Submission",
    options: [
      { value: "Awaiting Utility Approval", label: "Awaiting Utility Approval" },
      { value: "Ready For Permitting", label: "Ready For Permitting" },
      { value: "Submitted To Customer", label: "Submitted To Customer" },
      { value: "Customer Signature Acquired", label: "Customer Signature Acquired" },
      { value: "Waiting On Information", label: "Waiting On Information" },
    ]
  },
  {
    name: "Submitted",
    options: [
      { value: "Submitted to AHJ", label: "Submitted to AHJ" },
      { value: "Resubmitted to AHJ", label: "Resubmitted to AHJ" },
    ]
  },
  {
    name: "Rejections & Revisions",
    options: [
      { value: "Non-Design Related Rejection", label: "Non-Design Related Rejection" },
      { value: "Permit Rejected - Needs Revision", label: "Permit Rejected" },
      { value: "Design Revision In Progress", label: "Design Revision In Progress" },
      { value: "Revision Ready To Resubmit", label: "Revision Ready To Resubmit" },
      { value: "As-Built Revision Needed", label: "As-Built Revision Needed" },
      { value: "As-Built Revision In Progress", label: "As-Built Revision In Progress" },
      { value: "As-Built Ready To Resubmit", label: "As-Built Ready To Resubmit" },
      { value: "As-Built Revision Resubmitted", label: "As-Built Revision Resubmitted" },
    ]
  },
  {
    name: "SolarApp",
    options: [
      { value: "Ready to Submit for SolarApp", label: "Ready for SolarApp" },
      { value: "Submit SolarApp to AHJ", label: "Submit SolarApp to AHJ" },
    ]
  },
  {
    name: "Completed",
    options: [
      { value: "Permit Issued", label: "Permit Issued" },
    ]
  },
  {
    name: "Other",
    options: [
      { value: "Not Needed", label: "Not Needed" },
    ]
  },
];

// Flatten groups to get all options
const ALL_PERMITTING_STATUS_OPTIONS = PERMITTING_STATUS_GROUPS.flatMap(g => g.options || []);

export default function PermittingPage() {
  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const [projects, setProjects] = useState<ExtendedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Multi-select filters
  const [filterAhjs, setFilterAhjs] = useState<string[]>([]);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterPermitStatuses, setFilterPermitStatuses] = useState<string[]>([]);
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

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("permitting", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

  // Status helper functions
  const isPermitPending = useCallback((p: ExtendedProject) => {
    const status = (p.permittingStatus || '').toLowerCase();
    if (status && ['submitted', 'in review', 'pending', 'in progress', 'under review'].some(s => status.includes(s))) return true;
    if (!status && p.permitSubmitDate && !p.permitIssueDate) return true;
    return false;
  }, []);

  const isPermitIssued = useCallback((p: ExtendedProject) => {
    const status = (p.permittingStatus || '').toLowerCase();
    if (status && ['issued', 'approved', 'complete', 'received'].some(s => status.includes(s))) return true;
    if (!status && p.permitIssueDate) return true;
    return false;
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      // AHJ filter (multi-select)
      if (filterAhjs.length > 0 && !filterAhjs.includes(p.ahj || '')) return false;

      // Location filter (multi-select)
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || '')) return false;

      // Stage filter (multi-select)
      if (filterStages.length > 0 && !filterStages.includes(p.stage || '')) return false;

      // Permit Status filter (multi-select)
      if (filterPermitStatuses.length > 0 && !filterPermitStatuses.includes(p.permittingStatus || '')) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const name = (p.name || '').toLowerCase();
        const location = (p.pbLocation || '').toLowerCase();
        const ahj = (p.ahj || '').toLowerCase();
        if (!name.includes(query) && !location.includes(query) && !ahj.includes(query)) return false;
      }

      return true;
    });
  }, [projects, filterAhjs, filterLocations, filterStages, filterPermitStatuses, searchQuery]);

  const stats = useMemo(() => {
    const today = new Date();
    const permitPending = filteredProjects.filter(p => isPermitPending(p));
    const permitIssued = filteredProjects.filter(p => isPermitIssued(p));

    // Calculate average days in permitting
    const daysInPermitting = permitPending
      .filter(p => p.permitSubmitDate)
      .map(p => Math.floor((today.getTime() - new Date(p.permitSubmitDate! + "T12:00:00").getTime()) / (1000 * 60 * 60 * 24)));
    const avgDaysInPermitting = daysInPermitting.length > 0
      ? Math.round(daysInPermitting.reduce((a, b) => a + b, 0) / daysInPermitting.length)
      : 0;

    // Calculate average turnaround
    const turnaroundDays = permitIssued
      .filter(p => p.permitSubmitDate && p.permitIssueDate)
      .map(p => {
        const d1 = new Date(p.permitSubmitDate! + "T12:00:00");
        const d2 = new Date(p.permitIssueDate! + "T12:00:00");
        return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter(d => d >= 0);
    const avgTurnaround = turnaroundDays.length > 0
      ? Math.round(turnaroundDays.reduce((a, b) => a + b, 0) / turnaroundDays.length)
      : 0;

    // Status breakdown
    const permitStatusStats: Record<string, number> = {};

    filteredProjects.forEach(p => {
      if (p.permittingStatus) {
        permitStatusStats[p.permittingStatus] = (permitStatusStats[p.permittingStatus] || 0) + 1;
      }
    });

    // Group by AHJ
    const ahjStats: Record<string, { total: number; permitPending: number; permitIssued: number; avgDays: number[]; totalValue: number }> = {};
    filteredProjects.forEach(p => {
      const ahj = p.ahj || 'Unknown';
      if (!ahjStats[ahj]) {
        ahjStats[ahj] = { total: 0, permitPending: 0, permitIssued: 0, avgDays: [], totalValue: 0 };
      }
      ahjStats[ahj].total++;
      ahjStats[ahj].totalValue += p.amount || 0;
      if (isPermitIssued(p)) {
        ahjStats[ahj].permitIssued++;
        if (p.permitSubmitDate && p.permitIssueDate) {
          const d1 = new Date(p.permitSubmitDate + "T12:00:00");
          const d2 = new Date(p.permitIssueDate + "T12:00:00");
          const days = Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
          if (days >= 0) ahjStats[ahj].avgDays.push(days);
        }
      } else if (isPermitPending(p)) {
        ahjStats[ahj].permitPending++;
      }
    });

    return {
      total: filteredProjects.length,
      totalValue: filteredProjects.reduce((s, p) => s + (p.amount || 0), 0),
      permitPending,
      permitIssued,
      avgDaysInPermitting,
      avgTurnaround,
      permitStatusStats,
      ahjStats,
    };
  }, [filteredProjects, isPermitPending, isPermitIssued]);

  // Get unique values for filters
  const ahjs = useMemo(() =>
    [...new Set(projects.map(p => p.ahj))]
      .filter(a => a && a !== 'Unknown')
      .sort()
      .map(a => ({ value: a!, label: a! })),
    [projects]
  );

  const locations = useMemo(() =>
    [...new Set(projects.map(p => p.pbLocation))]
      .filter(l => l && l !== 'Unknown')
      .sort()
      .map(l => ({ value: l!, label: l! })),
    [projects]
  );

  const stages = useMemo(() => {
    const STAGE_ORDER = ['Site Survey', 'Design & Engineering', 'Permitting & Interconnection', 'RTB - Blocked', 'Ready To Build', 'Construction', 'Inspection', 'Permission To Operate', 'Close Out'];
    return [...new Set(projects.map(p => p.stage))]
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
  }, [projects]);

  // Get statuses that exist in the data
  const existingPermitStatuses = useMemo(() =>
    new Set(projects.map(p => (p as ExtendedProject).permittingStatus).filter(Boolean)),
    [projects]
  );

  // Filter groups to only include options that exist in the actual data
  const filteredPermitStatusGroups = useMemo(() => {
    const knownValues = new Set(ALL_PERMITTING_STATUS_OPTIONS.map(o => o.value));
    const uncategorized = [...existingPermitStatuses].filter(s => !knownValues.has(s as string));

    const filtered = PERMITTING_STATUS_GROUPS.map(group => ({
      ...group,
      options: group.options?.filter(opt => existingPermitStatuses.has(opt.value)) || []
    })).filter(group => group.options && group.options.length > 0);

    if (uncategorized.length > 0) {
      filtered.push({
        name: "Other",
        options: uncategorized.map(status => ({ value: status as string, label: status as string }))
      });
    }

    return filtered;
  }, [existingPermitStatuses]);

  // Flatten filtered groups to get all options
  const filteredPermitStatusOptions = useMemo(() =>
    filteredPermitStatusGroups.flatMap(g => g.options || []),
    [filteredPermitStatusGroups]
  );

  const clearAllFilters = () => {
    setFilterAhjs([]);
    setFilterLocations([]);
    setFilterStages([]);
    setFilterPermitStatuses([]);
    setSearchQuery("");
  };

  const hasActiveFilters = filterAhjs.length > 0 || filterLocations.length > 0 ||
    filterStages.length > 0 || filterPermitStatuses.length > 0 || searchQuery;

  if (loading) {
    return (
      <DashboardShell title="Permitting" accentColor="purple">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500 mx-auto mb-4"></div>
            <p className="text-zinc-400">Loading Permitting Data...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Permitting" accentColor="purple">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center text-red-500">
            <p className="text-xl mb-2">Error loading data</p>
            <p className="text-sm text-zinc-400">{error}</p>
            <button onClick={fetchData} className="mt-4 px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700">
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const getPermitStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-zinc-400';
    const lower = status.toLowerCase();
    if (lower.includes('issued') || lower.includes('complete')) return 'bg-green-500/20 text-green-400';
    if (lower.includes('submitted') || lower.includes('resubmitted')) return 'bg-blue-500/20 text-blue-400';
    if (lower.includes('rejected') || lower.includes('revision')) return 'bg-orange-500/20 text-orange-400';
    if (lower.includes('waiting') || lower.includes('pending') || lower.includes('ready')) return 'bg-yellow-500/20 text-yellow-400';
    if (lower.includes('solarapp')) return 'bg-cyan-500/20 text-cyan-400';
    return 'bg-zinc-500/20 text-zinc-400';
  };

  return (
    <DashboardShell title="Permitting" accentColor="purple">
      {/* Search and Filters */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Search Bar */}
        <div className="flex items-center gap-3">
          <ProjectSearchBar
            onSearch={setSearchQuery}
            placeholder="Search by PROJ #, name, location, or AHJ..."
          />
          <button onClick={fetchData} className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
            Refresh
          </button>
        </div>

        {/* Filter Row */}
        <div className="flex items-center gap-3 flex-wrap">
          <MultiSelectFilter
            label="AHJ"
            options={ahjs}
            selected={filterAhjs}
            onChange={setFilterAhjs}
            placeholder="All AHJs"
            accentColor="purple"
          />
          <MultiSelectFilter
            label="Location"
            options={locations}
            selected={filterLocations}
            onChange={setFilterLocations}
            placeholder="All Locations"
            accentColor="blue"
          />
          <MultiSelectFilter
            label="Stage"
            options={stages}
            selected={filterStages}
            onChange={setFilterStages}
            placeholder="All Stages"
            accentColor="indigo"
          />
          <MultiSelectFilter
            label="Permit Status"
            options={filteredPermitStatusOptions}
            groups={filteredPermitStatusGroups}
            selected={filterPermitStatuses}
            onChange={setFilterPermitStatuses}
            placeholder="All Permit Statuses"
            accentColor="green"
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
          <div className="text-2xl font-bold text-purple-400">{stats.total}</div>
          <div className="text-sm text-zinc-400">Total Projects</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.totalValue)}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-yellow-400">{stats.permitPending.length}</div>
          <div className="text-sm text-zinc-400">Permits Pending</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.permitPending.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-green-400">{stats.permitIssued.length}</div>
          <div className="text-sm text-zinc-400">Permits Issued</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.permitIssued.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-cyan-400">{stats.avgTurnaround}d</div>
          <div className="text-sm text-zinc-400">Avg Permit Turnaround</div>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="grid grid-cols-1 gap-6 mb-6">
        {/* Permit Status Breakdown */}
        <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-4">
          <h2 className="text-lg font-semibold mb-4 text-purple-400">By Permit Status</h2>
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {Object.keys(stats.permitStatusStats).length === 0 ? (
              <p className="text-zinc-500 text-sm">No permit status data available</p>
            ) : (
              Object.entries(stats.permitStatusStats)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div
                    key={status}
                    className={`flex items-center justify-between p-2 bg-zinc-800/50 rounded-lg cursor-pointer hover:bg-zinc-800 transition-colors ${
                      filterPermitStatuses.includes(status) ? 'ring-1 ring-purple-500' : ''
                    }`}
                    onClick={() => {
                      if (filterPermitStatuses.includes(status)) {
                        setFilterPermitStatuses(filterPermitStatuses.filter(s => s !== status));
                      } else {
                        setFilterPermitStatuses([...filterPermitStatuses, status]);
                      }
                    }}
                  >
                    <span className="text-sm text-zinc-300">{getDisplayName(status)}</span>
                    <span className="text-lg font-bold text-purple-400">{count}</span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* AHJ Breakdown */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4">By AHJ</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Object.entries(stats.ahjStats)
            .filter(([ahj]) => ahj !== 'Unknown')
            .sort((a, b) => b[1].permitPending - a[1].permitPending)
            .slice(0, 12)
            .map(([ahj, ahjData]) => {
              const avgDays = ahjData.avgDays.length > 0
                ? Math.round(ahjData.avgDays.reduce((a, b) => a + b, 0) / ahjData.avgDays.length)
                : null;
              return (
                <div
                  key={ahj}
                  className={`bg-zinc-800/50 rounded-lg p-3 cursor-pointer hover:bg-zinc-800 transition-colors ${
                    filterAhjs.includes(ahj) ? 'ring-1 ring-purple-500' : ''
                  }`}
                  onClick={() => {
                    if (filterAhjs.includes(ahj)) {
                      setFilterAhjs(filterAhjs.filter(a => a !== ahj));
                    } else {
                      setFilterAhjs([...filterAhjs, ahj]);
                    }
                  }}
                >
                  <div className="text-sm font-medium text-white truncate" title={ahj}>{ahj}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-yellow-400 text-lg font-bold">{ahjData.permitPending}</span>
                    <span className="text-zinc-500 text-xs">permit</span>
                  </div>
                  {avgDays !== null && <div className="text-xs text-zinc-500 mt-1">~{avgDays}d turnaround</div>}
                </div>
              );
            })}
        </div>
      </div>

      {/* Projects Table */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 overflow-hidden">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projects ({filteredProjects.length})</h2>
          {hasActiveFilters && (
            <span className="text-xs text-zinc-500">Filtered from {projects.length} total</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Project</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">AHJ</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Permit Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Permit Submitted</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Permit Issued</th>
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
                    if (isPermitPending(a) && !isPermitPending(b)) return -1;
                    if (!isPermitPending(a) && isPermitPending(b)) return 1;
                    if (a.stage === 'Inspection' && b.stage !== 'Inspection') return -1;
                    if (a.stage !== 'Inspection' && b.stage === 'Inspection') return 1;
                    return (b.amount || 0) - (a.amount || 0);
                  })
                  .slice(0, 100)
                  .map(project => {
                    const permitLabel = getDisplayName(project.permittingStatus) || (
                      isPermitIssued(project) ? 'Issued' :
                      isPermitPending(project) ? 'Pending' : 'Not Started'
                    );

                    return (
                      <tr key={project.id} className="hover:bg-zinc-900/50">
                        <td className="px-4 py-3">
                          <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-white hover:text-purple-400">
                            {project.name.split('|')[0].trim()}
                          </a>
                          <div className="text-xs text-zinc-400">{project.name.split('|')[1]?.trim() || ''}</div>
                          <div className="text-xs text-zinc-500">{project.pbLocation}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-300">{project.ahj || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getPermitStatusColor(project.permittingStatus)}`}>
                            {permitLabel}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.permitSubmitDate ? 'text-blue-400' : 'text-zinc-500'}`}>
                          {project.permitSubmitDate || '-'}
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.permitIssueDate ? 'text-green-400' : 'text-zinc-500'}`}>
                          {project.permitIssueDate || '-'}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-sm ${(project.amount || 0) > 0 ? 'text-green-400' : 'text-zinc-500'}`}>
                          {formatMoney(project.amount || 0)}
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
