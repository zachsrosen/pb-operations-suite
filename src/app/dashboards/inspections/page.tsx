"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { MultiSelectFilter, ProjectSearchBar, FilterGroup } from "@/components/ui/MultiSelectFilter";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// Display name mappings
const DISPLAY_NAMES: Record<string, string> = {
  'inspection_scheduled': 'Inspection Scheduled',
  'inspection_passed': 'Inspection Passed',
  'inspection_failed': 'Inspection Failed',
  'corrections_required': 'Corrections Required',
  'reinspection_needed': 'Reinspection Needed',
  'final_passed': 'Final Passed',
  'pending_inspection': 'Pending Inspection',
  'submitted': 'Submitted',
  'pending': 'Pending',
  'complete': 'Complete',
  'completed': 'Completed',
  'in_progress': 'In Progress',
  'passed': 'Passed',
  'failed': 'Failed',
  'scheduled': 'Scheduled',
  'not_applicable': 'Not Applicable',
  'n_a': 'N/A',
  'na': 'N/A',
  'not_needed': 'Not Needed',
  'ready_for_inspection': 'Ready For Inspection',
  'on_our_way': 'On Our Way',
  'started': 'Started',
  'rejected': 'Rejected',
  'waiting_on_permit_revisions': 'Waiting on Permit Revisions',
  'revisions_complete': 'Revisions Complete',
  'partial_pass': 'Partial Pass',
  'pending_new_construction_sign_off': 'Pending NC Sign Off',
  'pending_fire_inspection': 'Pending Fire Inspection',
  'pending_bus_install': 'Pending BUS Install',
  'pending_new_construction': 'Pending New Construction',
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

// Inspection Status Groups
const INSPECTION_STATUS_GROUPS: FilterGroup[] = [
  {
    name: "Pre-Inspection",
    options: [
      { value: "Ready For Inspection", label: "Ready For Inspection" },
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
    name: "Failed/Waiting",
    options: [
      { value: "Failed", label: "Failed" },
      { value: "Rejected", label: "Rejected" },
      { value: "Waiting on Permit Revisions", label: "Waiting on Permit Revisions" },
      { value: "Revisions Complete", label: "Revisions Complete" },
    ]
  },
  {
    name: "Passed",
    options: [
      { value: "Passed", label: "Passed" },
      { value: "Partial Pass", label: "Partial Pass" },
    ]
  },
  {
    name: "Pending",
    options: [
      { value: "Pending New Construction Sign Off", label: "Pending NC Sign Off" },
      { value: "Pending Fire Inspection", label: "Pending Fire Inspection" },
      { value: "Pending BUS Install", label: "Pending BUS Install" },
      { value: "Pending New Construction", label: "Pending New Construction" },
    ]
  },
  {
    name: "Other",
    options: [
      { value: "Not Needed", label: "Not Needed" },
    ]
  },
];

const ALL_INSPECTION_STATUS_OPTIONS = INSPECTION_STATUS_GROUPS.flatMap(g => g.options || []);

export default function InspectionsPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const [projects, setProjects] = useState<ExtendedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Multi-select filters
  const [filterAhjs, setFilterAhjs] = useState<string[]>([]);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterInspectionStatuses, setFilterInspectionStatuses] = useState<string[]>([]);
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

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("inspections", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (filterAhjs.length > 0 && !filterAhjs.includes(p.ahj || '')) return false;
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || '')) return false;
      if (filterStages.length > 0 && !filterStages.includes(p.stage || '')) return false;
      if (filterInspectionStatuses.length > 0 && !filterInspectionStatuses.includes(p.finalInspectionStatus || '')) return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const name = (p.name || '').toLowerCase();
        const location = (p.pbLocation || '').toLowerCase();
        const ahj = (p.ahj || '').toLowerCase();
        if (!name.includes(query) && !location.includes(query) && !ahj.includes(query)) return false;
      }

      return true;
    });
  }, [projects, filterAhjs, filterLocations, filterStages, filterInspectionStatuses, searchQuery]);

  const stats = useMemo(() => {
    const today = new Date();
    const inspectionPending = filteredProjects.filter(p => {
      const status = (p.finalInspectionStatus || '').toLowerCase();
      if (p.stage === 'Inspection' && !p.inspectionPassDate) return true;
      if (status && ['scheduled', 'ready', 'pending', 'in progress', 'started', 'on our way'].some(s => status.includes(s))) return true;
      return false;
    });
    const inspectionPassed = filteredProjects.filter(p => {
      const status = (p.finalInspectionStatus || '').toLowerCase();
      if (p.inspectionPassDate) return true;
      if (status && ['passed', 'complete'].some(s => status.includes(s))) return true;
      return false;
    });
    const inspectionFailed = filteredProjects.filter(p => {
      const status = (p.finalInspectionStatus || '').toLowerCase();
      return status && ['failed', 'rejected'].some(s => status.includes(s));
    });

    // Calculate average days in inspection
    const daysInInspection = inspectionPending
      .filter(p => p.inspectionScheduleDate)
      .map(p => Math.floor((today.getTime() - new Date(p.inspectionScheduleDate! + "T12:00:00").getTime()) / (1000 * 60 * 60 * 24)));
    const avgDaysInInspection = daysInInspection.length > 0
      ? Math.round(daysInInspection.reduce((a, b) => a + b, 0) / daysInInspection.length)
      : 0;

    // Calculate turnaround for passed inspections
    const turnaroundDays = inspectionPassed
      .filter(p => p.inspectionScheduleDate && p.inspectionPassDate)
      .map(p => {
        const d1 = new Date(p.inspectionScheduleDate! + "T12:00:00");
        const d2 = new Date(p.inspectionPassDate! + "T12:00:00");
        return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter(d => d >= 0);
    const avgTurnaround = turnaroundDays.length > 0
      ? Math.round(turnaroundDays.reduce((a, b) => a + b, 0) / turnaroundDays.length)
      : 0;

    // Pass rate
    const totalWithOutcome = inspectionPassed.length + inspectionFailed.length;
    const passRate = totalWithOutcome > 0 ? Math.round((inspectionPassed.length / totalWithOutcome) * 100) : 0;

    // Status breakdown
    const inspectionStatusStats: Record<string, number> = {};
    filteredProjects.forEach(p => {
      if (p.finalInspectionStatus) {
        inspectionStatusStats[p.finalInspectionStatus] = (inspectionStatusStats[p.finalInspectionStatus] || 0) + 1;
      }
    });

    // Group by AHJ
    const ahjStats: Record<string, { total: number; inspectionPending: number; inspectionPassed: number; inspectionFailed: number; avgDays: number[]; totalValue: number }> = {};
    filteredProjects.forEach(p => {
      const ahj = p.ahj || 'Unknown';
      if (!ahjStats[ahj]) {
        ahjStats[ahj] = { total: 0, inspectionPending: 0, inspectionPassed: 0, inspectionFailed: 0, avgDays: [], totalValue: 0 };
      }
      ahjStats[ahj].total++;
      ahjStats[ahj].totalValue += p.amount || 0;

      const status = (p.finalInspectionStatus || '').toLowerCase();
      if (p.inspectionPassDate || (status && ['passed', 'complete'].some(s => status.includes(s)))) {
        ahjStats[ahj].inspectionPassed++;
        if (p.inspectionScheduleDate && p.inspectionPassDate) {
          const d1 = new Date(p.inspectionScheduleDate + "T12:00:00");
          const d2 = new Date(p.inspectionPassDate + "T12:00:00");
          const days = Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
          if (days >= 0) ahjStats[ahj].avgDays.push(days);
        }
      } else if (status && ['failed', 'rejected'].some(s => status.includes(s))) {
        ahjStats[ahj].inspectionFailed++;
      } else if (p.stage === 'Inspection' && !p.inspectionPassDate) {
        ahjStats[ahj].inspectionPending++;
      }
    });

    return {
      total: filteredProjects.length,
      totalValue: filteredProjects.reduce((s, p) => s + (p.amount || 0), 0),
      inspectionPending,
      inspectionPassed,
      inspectionFailed,
      avgDaysInInspection,
      avgTurnaround,
      passRate,
      inspectionStatusStats,
      ahjStats,
    };
  }, [filteredProjects]);

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

  const existingInspectionStatuses = useMemo(() =>
    new Set(projects.map(p => (p as ExtendedProject).finalInspectionStatus).filter(Boolean)),
    [projects]
  );

  const filteredInspectionStatusGroups = useMemo(() => {
    const knownValues = new Set(ALL_INSPECTION_STATUS_OPTIONS.map(o => o.value));
    const uncategorized = [...existingInspectionStatuses].filter(s => !knownValues.has(s as string));

    const filtered = INSPECTION_STATUS_GROUPS.map(group => ({
      ...group,
      options: group.options?.filter(opt => existingInspectionStatuses.has(opt.value)) || []
    })).filter(group => group.options && group.options.length > 0);

    if (uncategorized.length > 0) {
      filtered.push({
        name: "Other",
        options: uncategorized.map(status => ({ value: status as string, label: status as string }))
      });
    }

    return filtered;
  }, [existingInspectionStatuses]);

  const filteredInspectionStatusOptions = useMemo(() =>
    filteredInspectionStatusGroups.flatMap(g => g.options || []),
    [filteredInspectionStatusGroups]
  );

  const clearAllFilters = () => {
    setFilterAhjs([]);
    setFilterLocations([]);
    setFilterStages([]);
    setFilterInspectionStatuses([]);
    setSearchQuery("");
  };

  const hasActiveFilters = filterAhjs.length > 0 || filterLocations.length > 0 ||
    filterStages.length > 0 || filterInspectionStatuses.length > 0 || searchQuery;

  if (loading) {
    return (
      <DashboardShell title="Inspections" accentColor="orange">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500 mx-auto mb-4"></div>
            <p className="text-muted">Loading Inspections Data...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Inspections" accentColor="orange">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center text-red-500">
            <p className="text-xl mb-2">Error loading data</p>
            <p className="text-sm text-muted">{error}</p>
            <button onClick={fetchData} className="mt-4 px-4 py-2 bg-orange-600 rounded-lg hover:bg-orange-700">
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const getInspectionStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-muted';
    const lower = status.toLowerCase();
    if (lower.includes('passed')) return 'bg-emerald-500/20 text-emerald-400';
    if (lower.includes('failed') || lower.includes('rejected')) return 'bg-red-500/20 text-red-400';
    if (lower.includes('scheduled') || lower.includes('ready')) return 'bg-blue-500/20 text-blue-400';
    if (lower.includes('progress') || lower.includes('started') || lower.includes('way')) return 'bg-cyan-500/20 text-cyan-400';
    if (lower.includes('waiting') || lower.includes('pending')) return 'bg-orange-500/20 text-orange-400';
    if (lower.includes('revision')) return 'bg-yellow-500/20 text-yellow-400';
    return 'bg-zinc-500/20 text-muted';
  };

  return (
    <DashboardShell title="Inspections" accentColor="orange">
      {/* Search and Filters */}
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-center gap-3">
          <ProjectSearchBar
            onSearch={setSearchQuery}
            placeholder="Search by PROJ #, name, location, or AHJ..."
          />
          <button onClick={fetchData} className="bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
            Refresh
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <MultiSelectFilter
            label="AHJ"
            options={ahjs}
            selected={filterAhjs}
            onChange={setFilterAhjs}
            placeholder="All AHJs"
            accentColor="orange"
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
            label="Inspection Status"
            options={filteredInspectionStatusOptions}
            groups={filteredInspectionStatusGroups}
            selected={filterInspectionStatuses}
            onChange={setFilterInspectionStatuses}
            placeholder="All Inspection Statuses"
            accentColor="emerald"
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-orange-400">{stats.total}</div>
          <div className="text-sm text-muted">Total Projects</div>
          <div className="text-xs text-muted">{formatMoney(stats.totalValue)}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-yellow-400">{stats.inspectionPending.length}</div>
          <div className="text-sm text-muted">Pending Inspection</div>
          <div className="text-xs text-muted">{formatMoney(stats.inspectionPending.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-emerald-400">{stats.inspectionPassed.length}</div>
          <div className="text-sm text-muted">Passed</div>
          <div className="text-xs text-muted">{formatMoney(stats.inspectionPassed.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-amber-400">{stats.avgDaysInInspection}d</div>
          <div className="text-sm text-muted">Avg Days Pending</div>
          <div className="text-xs text-muted">{stats.avgTurnaround}d avg turnaround</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-cyan-400">{stats.passRate}%</div>
          <div className="text-sm text-muted">Pass Rate</div>
          <div className="text-xs text-muted">{stats.inspectionFailed.length} failed</div>
        </div>
      </div>

      {/* Status Breakdown & AHJ side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Inspection Status Breakdown */}
        <div className="bg-surface rounded-xl border border-t-border p-4">
          <h2 className="text-lg font-semibold mb-4 text-orange-400">By Inspection Status</h2>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {Object.keys(stats.inspectionStatusStats).length === 0 ? (
              <p className="text-muted text-sm">No inspection status data available</p>
            ) : (
              Object.entries(stats.inspectionStatusStats)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div
                    key={status}
                    className={`flex items-center justify-between p-2 bg-skeleton rounded-lg cursor-pointer hover:bg-surface-2 transition-colors ${
                      filterInspectionStatuses.includes(status) ? 'ring-1 ring-orange-500' : ''
                    }`}
                    onClick={() => {
                      if (filterInspectionStatuses.includes(status)) {
                        setFilterInspectionStatuses(filterInspectionStatuses.filter(s => s !== status));
                      } else {
                        setFilterInspectionStatuses([...filterInspectionStatuses, status]);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getInspectionStatusColor(status)}`}>
                        {getDisplayName(status)}
                      </span>
                    </div>
                    <span className="text-lg font-bold text-orange-400">{count}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* AHJ Breakdown */}
        <div className="bg-surface rounded-xl border border-t-border p-4">
          <h2 className="text-lg font-semibold mb-4">By AHJ (Authority Having Jurisdiction)</h2>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {Object.entries(stats.ahjStats)
              .filter(([ahj]) => ahj !== 'Unknown')
              .sort((a, b) => b[1].inspectionPending - a[1].inspectionPending)
              .slice(0, 15)
              .map(([ahj, ahjData]) => {
                const avgDays = ahjData.avgDays.length > 0
                  ? Math.round(ahjData.avgDays.reduce((a, b) => a + b, 0) / ahjData.avgDays.length)
                  : null;
                return (
                  <div
                    key={ahj}
                    className={`flex items-center justify-between p-2 bg-skeleton rounded-lg cursor-pointer hover:bg-surface-2 transition-colors ${
                      filterAhjs.includes(ahj) ? 'ring-1 ring-orange-500' : ''
                    }`}
                    onClick={() => {
                      if (filterAhjs.includes(ahj)) {
                        setFilterAhjs(filterAhjs.filter(a => a !== ahj));
                      } else {
                        setFilterAhjs([...filterAhjs, ahj]);
                      }
                    }}
                  >
                    <div>
                      <span className="text-sm text-foreground/80">{ahj}</span>
                      {avgDays !== null && <span className="text-xs text-muted ml-2">~{avgDays}d avg</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-yellow-400 font-bold">{ahjData.inspectionPending}</span>
                      <span className="text-muted/70 text-xs">pending</span>
                      <span className="text-emerald-400 font-medium">{ahjData.inspectionPassed}</span>
                      <span className="text-muted/70 text-xs">passed</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Projects Table */}
      <div className="bg-surface rounded-xl border border-t-border overflow-hidden">
        <div className="p-4 border-b border-t-border flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projects ({filteredProjects.length})</h2>
          {hasActiveFilters && (
            <span className="text-xs text-muted">Filtered from {projects.length} total</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Project</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">AHJ</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Inspection Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Scheduled</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Passed</th>
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
                    // Sort: inspection stage first, then failed, then pending, then by amount
                    if (a.stage === 'Inspection' && b.stage !== 'Inspection') return -1;
                    if (a.stage !== 'Inspection' && b.stage === 'Inspection') return 1;
                    const aFailed = (a.finalInspectionStatus || '').toLowerCase().includes('failed');
                    const bFailed = (b.finalInspectionStatus || '').toLowerCase().includes('failed');
                    if (aFailed && !bFailed) return -1;
                    if (!aFailed && bFailed) return 1;
                    return (b.amount || 0) - (a.amount || 0);
                  })
                  .slice(0, 150)
                  .map(project => {
                    let inspectionLabel = '-';
                    const rawInspStatus = (project.finalInspectionStatus || '').toLowerCase();
                    if (project.inspectionPassDate || ['passed', 'complete', 'approved'].some(s => rawInspStatus.includes(s))) {
                      inspectionLabel = getDisplayName(project.finalInspectionStatus) || 'Passed';
                    } else if (project.stage === 'Inspection' || ['pending', 'scheduled', 'in progress', 'submitted', 'ready', 'started', 'way'].some(s => rawInspStatus.includes(s))) {
                      inspectionLabel = getDisplayName(project.finalInspectionStatus) || (project.inspectionScheduleDate ? 'Scheduled' : 'Pending');
                    } else if (project.finalInspectionStatus) {
                      inspectionLabel = getDisplayName(project.finalInspectionStatus);
                    }

                    return (
                      <tr key={project.id} className="hover:bg-surface/50">
                        <td className="px-4 py-3">
                          <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-orange-400">
                            {project.name.split('|')[0].trim()}
                          </a>
                          <div className="text-xs text-muted">{project.name.split('|')[1]?.trim() || ''}</div>
                          <div className="text-xs text-muted">{project.pbLocation}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground/80">{project.ahj || '-'}</td>
                        <td className="px-4 py-3 text-sm text-foreground/80">{project.stage || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getInspectionStatusColor(project.finalInspectionStatus)}`}>
                            {inspectionLabel}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.inspectionScheduleDate ? 'text-blue-400' : 'text-muted'}`}>
                          {project.inspectionScheduleDate || '-'}
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.inspectionPassDate ? 'text-emerald-400' : 'text-muted'}`}>
                          {project.inspectionPassDate || '-'}
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
