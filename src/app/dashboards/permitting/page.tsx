"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { MultiSelectFilter, ProjectSearchBar, FilterGroup } from "@/components/ui/MultiSelectFilter";
import { MonthlyBarChart, aggregateMonthly } from "@/components/ui/MonthlyBarChart";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useProjectData } from "@/hooks/useProjectData";

// Display name mappings — HubSpot internal enum values → display labels
// Source: HubSpot property definitions for permitting_status
const DISPLAY_NAMES: Record<string, string> = {
  'Complete': 'Permit Issued',
  'Rejected': 'Permit Rejected - Needs Revision',
  'In Design For Revision': 'Design Revision In Progress',
  'Returned from Design': 'Revision Ready To Resubmit',
  'Pending SolarApp': 'Ready to Submit for SolarApp',
};

function getDisplayName(value: string | undefined): string {
  if (!value) return value || '';
  return DISPLAY_NAMES[value] || value;
}

interface ExtendedProject extends RawProject {
  permittingStatus?: string;
  finalInspectionStatus?: string;
}

// Permitting Status Groups — values are HubSpot internal enum values, labels are display names
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
      { value: "Rejected", label: "Permit Rejected - Needs Revision" },
      { value: "In Design For Revision", label: "Design Revision In Progress" },
      { value: "Returned from Design", label: "Revision Ready To Resubmit" },
      { value: "As-Built Revision Needed", label: "As-Built Revision Needed" },
      { value: "As-Built Revision In Progress", label: "As-Built Revision In Progress" },
      { value: "As-Built Ready To Resubmit", label: "As-Built Ready To Resubmit" },
      { value: "As-Built Revision Resubmitted", label: "As-Built Revision Resubmitted" },
    ]
  },
  {
    name: "SolarApp",
    options: [
      { value: "Pending SolarApp", label: "Ready to Submit for SolarApp" },
      { value: "Submit SolarApp to AHJ", label: "Submit SolarApp to AHJ" },
    ]
  },
  {
    name: "Completed",
    options: [
      { value: "Complete", label: "Permit Issued" },
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

  const { data: projects, loading, error, refetch } = useProjectData<ExtendedProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: ExtendedProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  // Multi-select filters
  const [filterAhjs, setFilterAhjs] = useState<string[]>([]);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterPermitStatuses, setFilterPermitStatuses] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("permitting", {
        projectCount: safeProjects.length,
      });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

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
    return safeProjects.filter(p => {
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
  }, [safeProjects, filterAhjs, filterLocations, filterStages, filterPermitStatuses, searchQuery]);

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
    [...new Set(safeProjects.map(p => p.ahj))]
      .filter(a => a && a !== 'Unknown')
      .sort()
      .map(a => ({ value: a!, label: a! })),
    [safeProjects]
  );

  const locations = useMemo(() =>
    [...new Set(safeProjects.map(p => p.pbLocation))]
      .filter(l => l && l !== 'Unknown')
      .sort()
      .map(l => ({ value: l!, label: l! })),
    [safeProjects]
  );

  const stages = useMemo(() => {
    const STAGE_ORDER = ['Site Survey', 'Design & Engineering', 'Permitting & Interconnection', 'RTB - Blocked', 'Ready To Build', 'Construction', 'Inspection', 'Permission To Operate', 'Close Out'];
    return [...new Set(safeProjects.map(p => p.stage))]
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
  }, [safeProjects]);

  // Get statuses that exist in the data
  const existingPermitStatuses = useMemo(() =>
    new Set(safeProjects.map(p => (p as ExtendedProject).permittingStatus).filter(Boolean)),
    [safeProjects]
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
        options: uncategorized.map(status => ({ value: status as string, label: getDisplayName(status as string) }))
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
            <p className="text-muted">Loading Permitting Data...</p>
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
            <p className="text-sm text-muted">{error}</p>
            <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700">
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const getPermitStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-muted';
    const lower = status.toLowerCase();
    if (lower.includes('issued') || lower.includes('complete')) return 'bg-green-500/20 text-green-400';
    if (lower.includes('submitted') || lower.includes('resubmitted')) return 'bg-blue-500/20 text-blue-400';
    if (lower.includes('rejected') || lower.includes('revision')) return 'bg-orange-500/20 text-orange-400';
    if (lower.includes('waiting') || lower.includes('pending') || lower.includes('ready')) return 'bg-yellow-500/20 text-yellow-400';
    if (lower.includes('solarapp')) return 'bg-cyan-500/20 text-cyan-400';
    return 'bg-zinc-500/20 text-muted';
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
          <button onClick={() => refetch()} className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
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
              className="text-xs text-muted hover:text-foreground px-3 py-2 border border-t-border rounded-lg hover:border-muted transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-purple-400">{stats.total}</div>
          <div className="text-sm text-muted">Total Projects</div>
          <div className="text-xs text-muted">{formatMoney(stats.totalValue)}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-yellow-400">{stats.permitPending.length}</div>
          <div className="text-sm text-muted">Permits Pending</div>
          <div className="text-xs text-muted">{formatMoney(stats.permitPending.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-green-400">{stats.permitIssued.length}</div>
          <div className="text-sm text-muted">Permits Issued</div>
          <div className="text-xs text-muted">{formatMoney(stats.permitIssued.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-cyan-400">{stats.avgTurnaround}d</div>
          <div className="text-sm text-muted">Avg Permit Turnaround</div>
        </div>
      </div>

      {/* Permits Submitted & Issued by Month */}
      {!loading && (stats.permitIssued.length > 0 || filteredProjects.some(p => p.permitSubmitDate)) && (
        <div className="mb-6">
          <MonthlyBarChart
            title="Permits Submitted & Issued by Month"
            data={aggregateMonthly(
              stats.permitIssued.map(p => ({ date: p.permitIssueDate, amount: p.amount })),
              6,
            )}
            secondaryData={aggregateMonthly(
              filteredProjects
                .filter(p => p.permitSubmitDate)
                .map(p => ({ date: p.permitSubmitDate, amount: p.amount })),
              6,
            )}
            accentColor="green"
            primaryLabel="Permits Issued"
            secondaryLabel="Permits Submitted"
            defaultCollapsed
          />
        </div>
      )}

      {/* Status Breakdown */}
      <div className="grid grid-cols-1 gap-6 mb-6">
        {/* Permit Status Breakdown */}
        <div className="bg-surface rounded-xl border border-t-border p-4">
          <h2 className="text-lg font-semibold mb-4 text-purple-400">By Permit Status</h2>
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {Object.keys(stats.permitStatusStats).length === 0 ? (
              <p className="text-muted text-sm">No permit status data available</p>
            ) : (
              Object.entries(stats.permitStatusStats)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div
                    key={status}
                    className={`flex items-center justify-between p-2 bg-skeleton rounded-lg cursor-pointer hover:bg-surface-2 transition-colors ${
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
                    <span className="text-sm text-foreground/80">{getDisplayName(status)}</span>
                    <span className="text-lg font-bold text-purple-400">{count}</span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* AHJ Breakdown */}
      <div className="bg-surface rounded-xl border border-t-border p-4 mb-6">
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
                  className={`bg-skeleton rounded-lg p-3 cursor-pointer hover:bg-surface-2 transition-colors ${
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
                  <div className="text-sm font-medium text-foreground truncate" title={ahj}>{ahj}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-yellow-400 text-lg font-bold">{ahjData.permitPending}</span>
                    <span className="text-muted text-xs">permit</span>
                  </div>
                  {avgDays !== null && <div className="text-xs text-muted mt-1">~{avgDays}d turnaround</div>}
                </div>
              );
            })}
        </div>
      </div>

      {/* Projects Table */}
      <div className="bg-surface rounded-xl border border-t-border overflow-hidden">
        <div className="p-4 border-b border-t-border flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projects ({filteredProjects.length})</h2>
          {hasActiveFilters && (
            <span className="text-xs text-muted">Filtered from {safeProjects.length} total</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Project</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Deal Stage</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">AHJ</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Permit Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Permit Submitted</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Permit Issued</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-t-border">
              {filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">No projects found</td>
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
                      <tr key={project.id} className="hover:bg-surface/50">
                        <td className="px-4 py-3">
                          <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-purple-400">
                            {project.name.split('|')[0].trim()}
                          </a>
                          <div className="text-xs text-muted">{project.name.split('|')[1]?.trim() || ''}</div>
                          <div className="text-xs text-muted">{project.pbLocation}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-muted">{project.stage || '-'}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground/80">{project.ahj || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getPermitStatusColor(project.permittingStatus)}`}>
                            {permitLabel}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.permitSubmitDate ? 'text-blue-400' : 'text-muted'}`}>
                          {project.permitSubmitDate || '-'}
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.permitIssueDate ? 'text-green-400' : 'text-muted'}`}>
                          {project.permitIssueDate || '-'}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-sm ${(project.amount || 0) > 0 ? 'text-green-400' : 'text-muted'}`}>
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
