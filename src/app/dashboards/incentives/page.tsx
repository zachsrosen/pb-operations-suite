"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useProjectData } from "@/hooks/useProjectData";
// useCallback kept for hasIncentive/getProjectPrograms helpers
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { MultiSelectFilter, ProjectSearchBar } from "@/components/ui/MultiSelectFilter";

// Display name mappings for incentive status values
const DISPLAY_NAMES: Record<string, string> = {
  '3ce_submitted': '3CE Submitted',
  '3ce_approved': '3CE Approved',
  '3ce_pending': '3CE Pending',
  'reservation_submitted': 'Reservation Submitted',
  'reservation_approved': 'Reservation Approved',
  'incentive_claimed': 'Incentive Claimed',
  'payment_received': 'Payment Received',
  'sgip_submitted': 'SGIP Submitted',
  'sgip_approved': 'SGIP Approved',
  'sgip_reserved': 'SGIP Reserved',
  'step_1': 'Step 1',
  'step_2': 'Step 2',
  'step_3': 'Step 3',
  'step_4': 'Step 4',
  'step_5': 'Step 5',
  'step_1_complete': 'Step 1 Complete',
  'step_2_complete': 'Step 2 Complete',
  'step_3_complete': 'Step 3 Complete',
  'step_4_complete': 'Step 4 Complete',
  'step_5_complete': 'Step 5 Complete',
  'pbsr_submitted': 'PBSR Submitted',
  'pbsr_approved': 'PBSR Approved',
  'pbsr_pending': 'PBSR Pending',
  'cpa_submitted': 'CPA Submitted',
  'cpa_approved': 'CPA Approved',
  'cpa_pending': 'CPA Pending',
  'submitted': 'Submitted',
  'pending': 'Pending',
  'approved': 'Approved',
  'reserved': 'Reserved',
  'claimed': 'Claimed',
  'paid': 'Paid',
  'complete': 'Complete',
  'completed': 'Completed',
  'in_progress': 'In Progress',
  'in_review': 'In Review',
  'not_started': 'Not Started',
  'on_hold': 'On Hold',
  'expired': 'Expired',
  'cancelled': 'Cancelled',
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
  threeceEvStatus?: string;
  threeceBatteryStatus?: string;
  sgipStatus?: string;
  pbsrStatus?: string;
  cpaStatus?: string;
}

interface ProgramStats {
  count: number;
  value: number;
  statuses: Record<string, number>;
}

export default function IncentivesPage() {
  const { data: projects, loading, error, refetch } = useProjectData<ExtendedProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: ExtendedProject[] }).projects,
  });

  const [filterPrograms, setFilterPrograms] = useState<string[]>([]);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Activity tracking
  const { trackDashboardView, trackFilter } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const safeProjects = projects ?? [];

  // Track dashboard view
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("incentives", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // Track filter changes
  useEffect(() => {
    if (!loading && hasTrackedView.current) {
      trackFilter("incentives", { programs: filterPrograms, locations: filterLocations, stages: filterStages });
    }
  }, [filterPrograms, filterLocations, filterStages, loading, trackFilter]);

  const hasIncentive = useCallback((p: ExtendedProject) => {
    return p.threeceEvStatus ||
           p.threeceBatteryStatus ||
           p.sgipStatus ||
           p.pbsrStatus ||
           p.cpaStatus;
  }, []);

  const getProjectPrograms = useCallback((p: ExtendedProject): { name: string; status: string }[] => {
    const programs: { name: string; status: string }[] = [];
    if (p.threeceEvStatus) programs.push({ name: '3CE EV', status: p.threeceEvStatus });
    if (p.threeceBatteryStatus) programs.push({ name: '3CE Battery', status: p.threeceBatteryStatus });
    if (p.sgipStatus) programs.push({ name: 'SGIP', status: p.sgipStatus });
    if (p.pbsrStatus) programs.push({ name: 'PBSR', status: p.pbsrStatus });
    if (p.cpaStatus) programs.push({ name: 'CPA', status: p.cpaStatus });
    return programs;
  }, []);

  const filteredProjects = useMemo(() => {
    return safeProjects.filter(p => {
      if (!hasIncentive(p)) return false;

      // Location filter (multi-select)
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || '')) return false;

      // Stage filter (multi-select)
      if (filterStages.length > 0 && !filterStages.includes(p.stage || '')) return false;

      // Program filter (multi-select)
      if (filterPrograms.length > 0) {
        const hasMatchingProgram = filterPrograms.some(prog => {
          if (prog === '3ce_ev') return !!p.threeceEvStatus;
          if (prog === '3ce_battery') return !!p.threeceBatteryStatus;
          if (prog === 'sgip') return !!p.sgipStatus;
          if (prog === 'pbsr') return !!p.pbsrStatus;
          if (prog === 'cpa') return !!p.cpaStatus;
          return false;
        });
        if (!hasMatchingProgram) return false;
      }

      // Status filter (multi-select) — matches across all programs
      if (filterStatuses.length > 0) {
        const projectStatuses = [
          p.threeceEvStatus,
          p.threeceBatteryStatus,
          p.sgipStatus,
          p.pbsrStatus,
          p.cpaStatus,
        ].filter(Boolean) as string[];
        if (!projectStatuses.some(s => filterStatuses.includes(s))) return false;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const name = (p.name || '').toLowerCase();
        const location = (p.pbLocation || '').toLowerCase();
        if (!name.includes(query) && !location.includes(query)) return false;
      }

      return true;
    });
  }, [safeProjects, filterPrograms, filterLocations, filterStages, filterStatuses, searchQuery, hasIncentive]);

  const programStats = useMemo(() => {
    const stats: Record<string, ProgramStats> = {
      '3ce_ev': { count: 0, value: 0, statuses: {} },
      '3ce_battery': { count: 0, value: 0, statuses: {} },
      sgip: { count: 0, value: 0, statuses: {} },
      pbsr: { count: 0, value: 0, statuses: {} },
      cpa: { count: 0, value: 0, statuses: {} }
    };

    filteredProjects.forEach(p => {
      if (p.threeceEvStatus) {
        stats['3ce_ev'].count++;
        stats['3ce_ev'].value += p.amount || 0;
        stats['3ce_ev'].statuses[p.threeceEvStatus] = (stats['3ce_ev'].statuses[p.threeceEvStatus] || 0) + 1;
      }
      if (p.threeceBatteryStatus) {
        stats['3ce_battery'].count++;
        stats['3ce_battery'].value += p.amount || 0;
        stats['3ce_battery'].statuses[p.threeceBatteryStatus] = (stats['3ce_battery'].statuses[p.threeceBatteryStatus] || 0) + 1;
      }
      if (p.sgipStatus) {
        stats.sgip.count++;
        stats.sgip.value += p.amount || 0;
        stats.sgip.statuses[p.sgipStatus] = (stats.sgip.statuses[p.sgipStatus] || 0) + 1;
      }
      if (p.pbsrStatus) {
        stats.pbsr.count++;
        stats.pbsr.value += p.amount || 0;
        stats.pbsr.statuses[p.pbsrStatus] = (stats.pbsr.statuses[p.pbsrStatus] || 0) + 1;
      }
      if (p.cpaStatus) {
        stats.cpa.count++;
        stats.cpa.value += p.amount || 0;
        stats.cpa.statuses[p.cpaStatus] = (stats.cpa.statuses[p.cpaStatus] || 0) + 1;
      }
    });

    return stats;
  }, [filteredProjects]);

  // Get unique values for filters
  const locationOptions = useMemo(() =>
    [...new Set(safeProjects.map(p => p.pbLocation))]
      .filter(l => l && l !== 'Unknown')
      .sort()
      .map(l => ({ value: l!, label: l! })),
    [safeProjects]
  );

  const stageOptions = useMemo(() => {
    const STAGE_ORDER = ['Site Survey', 'Design & Engineering', 'Permitting & Interconnection', 'RTB - Blocked', 'Ready To Build', 'Construction', 'Inspection', 'Permission To Operate', 'Close Out'];
    return [...new Set(safeProjects.map(p => p.stage))]
      .filter(s => s)
      .sort((a, b) => {
        const aIdx = STAGE_ORDER.findIndex(s => s.toLowerCase() === a.toLowerCase());
        const bIdx = STAGE_ORDER.findIndex(s => s.toLowerCase() === b.toLowerCase());
        if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      })
      .map(s => ({ value: s!, label: s! }));
  }, [safeProjects]);

  const programOptions = [
    { value: '3ce_ev', label: '3CE EV' },
    { value: '3ce_battery', label: '3CE Battery' },
    { value: 'sgip', label: 'SGIP' },
    { value: 'pbsr', label: 'PBSR' },
    { value: 'cpa', label: 'CPA' },
  ];

  // Collect all unique statuses from all incentive programs
  const statusOptions = useMemo(() => {
    const allStatuses = new Set<string>();
    safeProjects.forEach(p => {
      if (p.threeceEvStatus) allStatuses.add(p.threeceEvStatus);
      if (p.threeceBatteryStatus) allStatuses.add(p.threeceBatteryStatus);
      if (p.sgipStatus) allStatuses.add(p.sgipStatus);
      if (p.pbsrStatus) allStatuses.add(p.pbsrStatus);
      if (p.cpaStatus) allStatuses.add(p.cpaStatus);
    });
    return [...allStatuses]
      .sort()
      .map(s => ({ value: s, label: getDisplayName(s) }));
  }, [safeProjects]);

  const clearAllFilters = () => {
    setFilterPrograms([]);
    setFilterLocations([]);
    setFilterStages([]);
    setFilterStatuses([]);
    setSearchQuery("");
  };

  const hasActiveFilters = filterPrograms.length > 0 || filterLocations.length > 0 ||
    filterStages.length > 0 || filterStatuses.length > 0 || searchQuery;

  if (loading) {
    return (
      <DashboardShell title="Incentives Dashboard" accentColor="emerald">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500 mx-auto mb-4"></div>
            <p className="text-muted">Loading Incentives Data...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Incentives Dashboard" accentColor="emerald">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center text-red-500">
            <p className="text-xl mb-2">Error loading data</p>
            <p className="text-sm text-muted">{error}</p>
            <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-700">
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const programConfigs = [
    { key: '3ce_ev', name: '3CE EV', color: 'blue' },
    { key: '3ce_battery', name: '3CE Battery', color: 'purple' },
    { key: 'sgip', name: 'SGIP', color: 'green' },
    { key: 'pbsr', name: 'PBSR', color: 'amber' },
    { key: 'cpa', name: 'CPA', color: 'pink' }
  ];

  return (
    <DashboardShell title="Incentives Dashboard" accentColor="emerald">
      {/* Search and Filters */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Search Bar */}
        <div className="flex items-center gap-3">
          <ProjectSearchBar
            onSearch={setSearchQuery}
            placeholder="Search by PROJ #, name, or location..."
          />
          <button onClick={() => refetch()} className="bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
            Refresh
          </button>
        </div>

        {/* Filter Row */}
        <div className="flex items-center gap-3 flex-wrap">
          <MultiSelectFilter
            label="Program"
            options={programOptions}
            selected={filterPrograms}
            onChange={setFilterPrograms}
            placeholder="All Programs"
            accentColor="emerald"
          />
          <MultiSelectFilter
            label="Location"
            options={locationOptions}
            selected={filterLocations}
            onChange={setFilterLocations}
            placeholder="All Locations"
            accentColor="blue"
          />
          <MultiSelectFilter
            label="Stage"
            options={stageOptions}
            selected={filterStages}
            onChange={setFilterStages}
            placeholder="All Stages"
            accentColor="purple"
          />
          <MultiSelectFilter
            label="Status"
            options={statusOptions}
            selected={filterStatuses}
            onChange={setFilterStatuses}
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

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-emerald-400">{filteredProjects.length}</div>
          <div className="text-sm text-muted">Projects with Incentives</div>
          <div className="text-xs text-muted">{formatMoney(filteredProjects.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-green-400">{programStats.sgip.count}</div>
          <div className="text-sm text-muted">SGIP</div>
          <div className="text-xs text-muted">{formatMoney(programStats.sgip.value)}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-blue-400">{programStats['3ce_ev'].count + programStats['3ce_battery'].count}</div>
          <div className="text-sm text-muted">3CE (EV + Battery)</div>
          <div className="text-xs text-muted">{formatMoney(programStats['3ce_ev'].value + programStats['3ce_battery'].value)}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-amber-400">{programStats.pbsr.count}</div>
          <div className="text-sm text-muted">PBSR</div>
          <div className="text-xs text-muted">{formatMoney(programStats.pbsr.value)}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-pink-400">{programStats.cpa.count}</div>
          <div className="text-sm text-muted">CPA</div>
          <div className="text-xs text-muted">{formatMoney(programStats.cpa.value)}</div>
        </div>
      </div>

      {/* Program Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {programConfigs.map(prog => {
          const stats = programStats[prog.key as keyof typeof programStats];
          if (stats.count === 0) return null;

          const colorMap: Record<string, string> = {
            blue: 'text-blue-400 hover:border-blue-500/50',
            purple: 'text-purple-400 hover:border-purple-500/50',
            green: 'text-green-400 hover:border-green-500/50',
            amber: 'text-amber-400 hover:border-amber-500/50',
            pink: 'text-pink-400 hover:border-pink-500/50'
          };

          return (
            <div
              key={prog.key}
              className={`bg-surface rounded-xl border p-4 cursor-pointer transition-colors ${
                filterPrograms.includes(prog.key) ? 'border-emerald-500 ring-1 ring-emerald-500/30' : 'border-t-border'
              } ${colorMap[prog.color]}`}
              onClick={() => {
                if (filterPrograms.includes(prog.key)) {
                  setFilterPrograms(filterPrograms.filter(p => p !== prog.key));
                } else {
                  setFilterPrograms([...filterPrograms, prog.key]);
                }
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className={`font-semibold ${colorMap[prog.color]}`}>{prog.name}</h3>
                <span className="text-2xl font-bold text-foreground">{stats.count}</span>
              </div>
              <div className="text-sm text-green-400 mb-3">{formatMoney(stats.value)}</div>
              <div className="space-y-1">
                {Object.entries(stats.statuses)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between text-xs">
                      <span className="text-muted truncate mr-2">{getDisplayName(status)}</span>
                      <span className="text-foreground/80 font-medium">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Projects Table */}
      <div className="bg-surface rounded-xl border border-t-border overflow-hidden">
        <div className="p-4 border-b border-t-border flex items-center justify-between">
          <h2 className="text-lg font-semibold">Incentive Projects ({filteredProjects.length})</h2>
          {hasActiveFilters && (
            <span className="text-xs text-muted">Filtered from {safeProjects.filter(hasIncentive).length} total</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Project</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Location</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Programs</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-t-border">
              {filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">No projects found</td>
                </tr>
              ) : (
                filteredProjects
                  .sort((a, b) => (b.amount || 0) - (a.amount || 0))
                  .slice(0, 100)
                  .map(project => {
                    const programs = getProjectPrograms(project);
                    return (
                      <tr key={project.id} className="hover:bg-surface/50">
                        <td className="px-4 py-3">
                          <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-emerald-400">
                            {project.name.split('|')[0].trim()}
                          </a>
                          <div className="text-xs text-muted">{project.name.split('|')[1]?.trim() || ''}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground/80">{project.pbLocation}</td>
                        <td className="px-4 py-3 text-sm text-muted">{project.stage}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {programs.map((prog, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400"
                                title={prog.status}
                              >
                                {prog.name}
                              </span>
                            ))}
                          </div>
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
