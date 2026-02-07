"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";

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
  const [projects, setProjects] = useState<ExtendedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterProgram, setFilterProgram] = useState("all");
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterStage, setFilterStage] = useState("all");

  // Activity tracking
  const { trackDashboardView, trackFilter } = useActivityTracking();
  const hasTrackedView = useRef(false);

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

  // Track dashboard view
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("incentives", { projectCount: projects.length });
    }
  }, [loading, projects.length, trackDashboardView]);

  // Track filter changes
  useEffect(() => {
    if (!loading && hasTrackedView.current) {
      trackFilter("incentives", { program: filterProgram, location: filterLocation, stage: filterStage });
    }
  }, [filterProgram, filterLocation, filterStage, loading, trackFilter]);

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
    return projects.filter(p => {
      if (!hasIncentive(p)) return false;
      if (filterLocation !== 'all' && p.pbLocation !== filterLocation) return false;
      if (filterStage !== 'all' && p.stage !== filterStage) return false;
      if (filterProgram !== 'all') {
        if (filterProgram === '3ce_ev' && !p.threeceEvStatus) return false;
        if (filterProgram === '3ce_battery' && !p.threeceBatteryStatus) return false;
        if (filterProgram === 'sgip' && !p.sgipStatus) return false;
        if (filterProgram === 'pbsr' && !p.pbsrStatus) return false;
        if (filterProgram === 'cpa' && !p.cpaStatus) return false;
      }
      return true;
    });
  }, [projects, filterProgram, filterLocation, filterStage, hasIncentive]);

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
  const locations = useMemo(() => [...new Set(projects.map(p => p.pbLocation))].filter(l => l && l !== 'Unknown').sort(), [projects]);
  const stages = useMemo(() => {
    const STAGE_ORDER = ['Site Survey', 'Design & Engineering', 'Permitting & Interconnection', 'RTB - Blocked', 'Ready To Build', 'Construction', 'Inspection', 'Permission To Operate', 'Close Out'];
    return [...new Set(projects.map(p => p.stage))].filter(s => s).sort((a, b) => {
      const aIdx = STAGE_ORDER.findIndex(s => s.toLowerCase() === a.toLowerCase());
      const bIdx = STAGE_ORDER.findIndex(s => s.toLowerCase() === b.toLowerCase());
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
  }, [projects]);

  if (loading) {
    return (
      <DashboardShell title="Incentives Dashboard" accentColor="emerald">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500 mx-auto mb-4"></div>
            <p className="text-zinc-400">Loading Incentives Data...</p>
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
            <p className="text-sm text-zinc-400">{error}</p>
            <button onClick={fetchData} className="mt-4 px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-700">
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
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap mb-6">
        <select
          value={filterProgram}
          onChange={(e) => setFilterProgram(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Programs</option>
          <option value="3ce_ev">3CE EV</option>
          <option value="3ce_battery">3CE Battery</option>
          <option value="sgip">SGIP</option>
          <option value="pbsr">PBSR</option>
          <option value="cpa">CPA</option>
        </select>
        <select
          value={filterLocation}
          onChange={(e) => setFilterLocation(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Stages</option>
          {stages.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={fetchData} className="bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-lg text-sm font-medium">
          Refresh
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-emerald-400">{filteredProjects.length}</div>
          <div className="text-sm text-zinc-400">Projects with Incentives</div>
          <div className="text-xs text-zinc-500">{formatMoney(filteredProjects.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-green-400">{programStats.sgip.count}</div>
          <div className="text-sm text-zinc-400">SGIP</div>
          <div className="text-xs text-zinc-500">{formatMoney(programStats.sgip.value)}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-blue-400">{programStats['3ce_ev'].count + programStats['3ce_battery'].count}</div>
          <div className="text-sm text-zinc-400">3CE (EV + Battery)</div>
          <div className="text-xs text-zinc-500">{formatMoney(programStats['3ce_ev'].value + programStats['3ce_battery'].value)}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-amber-400">{programStats.pbsr.count}</div>
          <div className="text-sm text-zinc-400">PBSR</div>
          <div className="text-xs text-zinc-500">{formatMoney(programStats.pbsr.value)}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-pink-400">{programStats.cpa.count}</div>
          <div className="text-sm text-zinc-400">CPA</div>
          <div className="text-xs text-zinc-500">{formatMoney(programStats.cpa.value)}</div>
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
              className={`bg-[#12121a] rounded-xl border border-zinc-800 p-4 cursor-pointer transition-colors ${colorMap[prog.color]}`}
              onClick={() => setFilterProgram(prog.key)}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className={`font-semibold ${colorMap[prog.color]}`}>{prog.name}</h3>
                <span className="text-2xl font-bold text-white">{stats.count}</span>
              </div>
              <div className="text-sm text-green-400 mb-3">{formatMoney(stats.value)}</div>
              <div className="space-y-1">
                {Object.entries(stats.statuses)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400 truncate mr-2">{getDisplayName(status)}</span>
                      <span className="text-zinc-300 font-medium">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Projects Table */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 overflow-hidden">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Incentive Projects ({filteredProjects.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Project</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Location</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Programs</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-400 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">No projects found</td>
                </tr>
              ) : (
                filteredProjects
                  .sort((a, b) => (b.amount || 0) - (a.amount || 0))
                  .slice(0, 100)
                  .map(project => {
                    const programs = getProjectPrograms(project);
                    return (
                      <tr key={project.id} className="hover:bg-zinc-900/50">
                        <td className="px-4 py-3">
                          <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-white hover:text-emerald-400">
                            {project.name.split('|')[0].trim()}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-300">{project.pbLocation}</td>
                        <td className="px-4 py-3 text-sm text-zinc-400">{project.stage}</td>
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
