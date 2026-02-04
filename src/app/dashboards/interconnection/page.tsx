"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";

// Display name mappings
const DISPLAY_NAMES: Record<string, string> = {
  'ic_submitted': 'IC Submitted',
  'ic_approved': 'IC Approved',
  'interconnection_submitted': 'Interconnection Submitted',
  'interconnection_approved': 'Interconnection Approved',
  'awaiting_nem': 'Awaiting NEM',
  'nem_approved': 'NEM Approved',
  'upgrade_required': 'Upgrade Required',
  'pending_utility': 'Pending Utility',
  'ready_to_submit': 'Ready to Submit',
  'pto_submitted': 'PTO Submitted',
  'pto_granted': 'PTO Granted',
  'pto_pending': 'PTO Pending',
  'awaiting_inspection': 'Awaiting Inspection',
  'awaiting_meter': 'Awaiting Meter',
  'meter_installed': 'Meter Installed',
  'submitted': 'Submitted',
  'pending': 'Pending',
  'approved': 'Approved',
  'granted': 'Granted',
  'complete': 'Complete',
  'completed': 'Completed',
  'in_progress': 'In Progress',
  'in_review': 'In Review',
  'not_started': 'Not Started',
  'on_hold': 'On Hold',
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
  interconnectionStatus?: string;
  interconnectionSubmitDate?: string;
  interconnectionApprovalDate?: string;
  ptoStatus?: string;
  ptoSubmitDate?: string;
}

export default function InterconnectionPage() {
  const [projects, setProjects] = useState<ExtendedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterUtility, setFilterUtility] = useState("all");
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterStage, setFilterStage] = useState("all");
  const [filterIcStatus, setFilterIcStatus] = useState("all");
  const [filterPtoStatus, setFilterPtoStatus] = useState("all");

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

  // Status helper functions
  const isIcPending = useCallback((p: ExtendedProject) => {
    const status = (p.interconnectionStatus || '').toLowerCase();
    if (status && ['submitted', 'in review', 'pending', 'in progress', 'under review'].some(s => status.includes(s))) return true;
    if (!status && p.interconnectionSubmitDate && !p.interconnectionApprovalDate) return true;
    return false;
  }, []);

  const isIcApproved = useCallback((p: ExtendedProject) => {
    const status = (p.interconnectionStatus || '').toLowerCase();
    if (status && ['approved', 'complete', 'granted', 'received'].some(s => status.includes(s))) return true;
    if (!status && p.interconnectionApprovalDate) return true;
    return false;
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (filterUtility !== 'all' && p.utility !== filterUtility) return false;
      if (filterLocation !== 'all' && p.pbLocation !== filterLocation) return false;
      if (filterStage !== 'all' && p.stage !== filterStage) return false;
      if (filterIcStatus !== 'all' && p.interconnectionStatus !== filterIcStatus) return false;
      if (filterPtoStatus !== 'all' && p.ptoStatus !== filterPtoStatus) return false;
      return true;
    });
  }, [projects, filterUtility, filterLocation, filterStage, filterIcStatus, filterPtoStatus]);

  const stats = useMemo(() => {
    const today = new Date();
    const icPending = filteredProjects.filter(p => isIcPending(p));
    const icApproved = filteredProjects.filter(p => isIcApproved(p));
    const ptoPending = filteredProjects.filter(p => p.stage === 'Permission To Operate' && !p.ptoGrantedDate);
    const ptoGranted = filteredProjects.filter(p => !!p.ptoGrantedDate);

    // Calculate average days waiting for IC
    const daysWaitingIc = icPending
      .filter(p => p.interconnectionSubmitDate)
      .map(p => Math.floor((today.getTime() - new Date(p.interconnectionSubmitDate!).getTime()) / (1000 * 60 * 60 * 24)));
    const avgDaysWaitingIc = daysWaitingIc.length > 0
      ? Math.round(daysWaitingIc.reduce((a, b) => a + b, 0) / daysWaitingIc.length)
      : 0;

    // Calculate average turnaround
    const turnaroundDays = icApproved
      .filter(p => p.interconnectionSubmitDate && p.interconnectionApprovalDate)
      .map(p => {
        const d1 = new Date(p.interconnectionSubmitDate!);
        const d2 = new Date(p.interconnectionApprovalDate!);
        return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter(d => d >= 0);
    const avgTurnaround = turnaroundDays.length > 0
      ? Math.round(turnaroundDays.reduce((a, b) => a + b, 0) / turnaroundDays.length)
      : 0;

    // Calculate average days in PTO
    const daysInPto = ptoPending
      .filter(p => p.ptoSubmitDate)
      .map(p => Math.floor((today.getTime() - new Date(p.ptoSubmitDate!).getTime()) / (1000 * 60 * 60 * 24)));
    const avgDaysInPto = daysInPto.length > 0
      ? Math.round(daysInPto.reduce((a, b) => a + b, 0) / daysInPto.length)
      : 0;

    // Group by Utility
    const utilityStats: Record<string, { total: number; icPending: number; icApproved: number; ptoPending: number; avgDays: number[]; totalValue: number }> = {};
    filteredProjects.forEach(p => {
      const utility = p.utility || 'Unknown';
      if (!utilityStats[utility]) {
        utilityStats[utility] = { total: 0, icPending: 0, icApproved: 0, ptoPending: 0, avgDays: [], totalValue: 0 };
      }
      utilityStats[utility].total++;
      utilityStats[utility].totalValue += p.amount || 0;
      if (isIcApproved(p)) {
        utilityStats[utility].icApproved++;
        if (p.interconnectionSubmitDate && p.interconnectionApprovalDate) {
          const d1 = new Date(p.interconnectionSubmitDate);
          const d2 = new Date(p.interconnectionApprovalDate);
          const days = Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
          if (days >= 0) utilityStats[utility].avgDays.push(days);
        }
      } else if (isIcPending(p)) {
        utilityStats[utility].icPending++;
      }
      if (p.stage === 'Permission To Operate' && !p.ptoGrantedDate) {
        utilityStats[utility].ptoPending++;
      }
    });

    return {
      total: filteredProjects.length,
      totalValue: filteredProjects.reduce((s, p) => s + (p.amount || 0), 0),
      icPending,
      icApproved,
      ptoPending,
      ptoGranted,
      avgDaysWaitingIc,
      avgTurnaround,
      avgDaysInPto,
      utilityStats,
    };
  }, [filteredProjects, isIcPending, isIcApproved]);

  // Get unique values for filters
  const utilities = useMemo(() => [...new Set(projects.map(p => p.utility))].filter(u => u && u !== 'Unknown').sort(), [projects]);
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
  const icStatuses = useMemo(() => [...new Set(projects.map(p => (p as ExtendedProject).interconnectionStatus))].filter(s => s).sort() as string[], [projects]);
  const ptoStatuses = useMemo(() => [...new Set(projects.map(p => (p as ExtendedProject).ptoStatus))].filter(s => s).sort() as string[], [projects]);

  if (loading) {
    return (
      <DashboardShell title="Interconnection & PTO" accentColor="orange">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500 mx-auto mb-4"></div>
            <p className="text-zinc-400">Loading Interconnection & PTO Data...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Interconnection & PTO" accentColor="orange">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center text-red-500">
            <p className="text-xl mb-2">Error loading data</p>
            <p className="text-sm text-zinc-400">{error}</p>
            <button onClick={fetchData} className="mt-4 px-4 py-2 bg-amber-600 rounded-lg hover:bg-amber-700">
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Interconnection & PTO" accentColor="orange">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap mb-6">
        <select value={filterUtility} onChange={(e) => setFilterUtility(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
          <option value="all">All Utilities</option>
          {utilities.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
          <option value="all">All Locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
          <option value="all">All Stages</option>
          {stages.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterIcStatus} onChange={(e) => setFilterIcStatus(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
          <option value="all">All Interconnection Status</option>
          {icStatuses.map(s => <option key={s} value={s}>{getDisplayName(s)}</option>)}
        </select>
        <select value={filterPtoStatus} onChange={(e) => setFilterPtoStatus(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
          <option value="all">All PTO Status</option>
          {ptoStatuses.map(s => <option key={s} value={s}>{getDisplayName(s)}</option>)}
        </select>
        <button onClick={fetchData} className="bg-amber-600 hover:bg-amber-700 px-4 py-2 rounded-lg text-sm font-medium">
          Refresh
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-amber-400">{stats.total}</div>
          <div className="text-sm text-zinc-400">Total Projects</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.totalValue)}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-yellow-400">{stats.icPending.length}</div>
          <div className="text-sm text-zinc-400">IC Pending</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.icPending.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-green-400">{stats.icApproved.length}</div>
          <div className="text-sm text-zinc-400">IC Approved</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.icApproved.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-cyan-400">{stats.avgTurnaround}d</div>
          <div className="text-sm text-zinc-400">Avg IC Turnaround</div>
        </div>
      </div>

      {/* PTO Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-orange-400">{stats.ptoPending.length}</div>
          <div className="text-sm text-zinc-400">PTO Pending</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.ptoPending.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-emerald-400">{stats.ptoGranted.length}</div>
          <div className="text-sm text-zinc-400">PTO Granted</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.ptoGranted.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-purple-400">{stats.avgDaysInPto}d</div>
          <div className="text-sm text-zinc-400">Avg Days in PTO</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-blue-400">{stats.avgDaysWaitingIc}d</div>
          <div className="text-sm text-zinc-400">Avg Days IC Pending</div>
        </div>
      </div>

      {/* Utility Breakdown */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4">By Utility</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Object.entries(stats.utilityStats)
            .filter(([utility]) => utility !== 'Unknown')
            .sort((a, b) => (b[1].icPending + b[1].ptoPending) - (a[1].icPending + a[1].ptoPending))
            .slice(0, 12)
            .map(([utility, utilityData]) => {
              const avgDays = utilityData.avgDays.length > 0
                ? Math.round(utilityData.avgDays.reduce((a, b) => a + b, 0) / utilityData.avgDays.length)
                : null;
              return (
                <div
                  key={utility}
                  className="bg-zinc-800/50 rounded-lg p-3 cursor-pointer hover:bg-zinc-800 transition-colors"
                  onClick={() => setFilterUtility(utility)}
                >
                  <div className="text-sm font-medium text-white truncate" title={utility}>{utility}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-yellow-400 text-lg font-bold">{utilityData.icPending}</span>
                    <span className="text-zinc-500 text-xs">IC</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-orange-400 text-sm">{utilityData.ptoPending}</span>
                    <span className="text-zinc-500 text-xs">PTO</span>
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
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Project</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Utility</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Interconnection</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">IC Submitted</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">IC Approved</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">PTO Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-400 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">No projects found</td>
                </tr>
              ) : (
                filteredProjects
                  .sort((a, b) => {
                    if (isIcPending(a) && !isIcPending(b)) return -1;
                    if (!isIcPending(a) && isIcPending(b)) return 1;
                    if (a.stage === 'Permission To Operate' && b.stage !== 'Permission To Operate') return -1;
                    if (a.stage !== 'Permission To Operate' && b.stage === 'Permission To Operate') return 1;
                    return (b.amount || 0) - (a.amount || 0);
                  })
                  .slice(0, 100)
                  .map(project => {
                    let icColor = 'bg-zinc-500/20 text-zinc-400';
                    let icLabel = getDisplayName(project.interconnectionStatus) || 'Not Started';
                    if (isIcApproved(project)) {
                      icColor = 'bg-green-500/20 text-green-400';
                      icLabel = getDisplayName(project.interconnectionStatus) || 'Approved';
                    } else if (isIcPending(project)) {
                      icColor = 'bg-yellow-500/20 text-yellow-400';
                      icLabel = getDisplayName(project.interconnectionStatus) || 'Pending';
                    }

                    let ptoColor = 'bg-zinc-500/20 text-zinc-500';
                    let ptoLabel = '-';
                    const rawPtoStatus = (project.ptoStatus || '').toLowerCase();
                    if (project.ptoGrantedDate || ['granted', 'complete', 'approved', 'received'].some(s => rawPtoStatus.includes(s))) {
                      ptoColor = 'bg-emerald-500/20 text-emerald-400';
                      ptoLabel = getDisplayName(project.ptoStatus) || 'Granted';
                    } else if (project.stage === 'Permission To Operate' || ['pending', 'submitted', 'in progress', 'in review'].some(s => rawPtoStatus.includes(s))) {
                      ptoColor = 'bg-orange-500/20 text-orange-400';
                      ptoLabel = getDisplayName(project.ptoStatus) || (project.ptoSubmitDate ? 'Submitted' : 'Pending');
                    } else if (project.ptoStatus) {
                      ptoLabel = getDisplayName(project.ptoStatus);
                    }

                    return (
                      <tr key={project.id} className="hover:bg-zinc-900/50">
                        <td className="px-4 py-3">
                          <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-white hover:text-amber-400">
                            {project.name.split('|')[0].trim()}
                          </a>
                          <div className="text-xs text-zinc-500">{project.pbLocation}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-300">{project.utility || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${icColor}`}>
                            {icLabel}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.interconnectionSubmitDate ? 'text-blue-400' : 'text-zinc-500'}`}>
                          {project.interconnectionSubmitDate || '-'}
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.interconnectionApprovalDate ? 'text-green-400' : 'text-zinc-500'}`}>
                          {project.interconnectionApprovalDate || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${ptoColor}`}>
                            {ptoLabel}
                          </span>
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
