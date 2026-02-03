"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";

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
  'inspection_scheduled': 'Inspection Scheduled',
  'inspection_passed': 'Inspection Passed',
  'inspection_failed': 'Inspection Failed',
  'corrections_required': 'Corrections Required',
  'reinspection_needed': 'Reinspection Needed',
  'final_passed': 'Final Passed',
  'pending_inspection': 'Pending Inspection',
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

export default function PermittingPage() {
  const [projects, setProjects] = useState<ExtendedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterAhj, setFilterAhj] = useState("all");
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterStage, setFilterStage] = useState("all");
  const [filterPermitStatus, setFilterPermitStatus] = useState("all");
  const [filterInspectionStatus, setFilterInspectionStatus] = useState("all");

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
      if (filterAhj !== 'all' && p.ahj !== filterAhj) return false;
      if (filterLocation !== 'all' && p.pbLocation !== filterLocation) return false;
      if (filterStage !== 'all' && p.stage !== filterStage) return false;
      if (filterPermitStatus !== 'all' && p.permittingStatus !== filterPermitStatus) return false;
      if (filterInspectionStatus !== 'all' && p.finalInspectionStatus !== filterInspectionStatus) return false;
      return true;
    });
  }, [projects, filterAhj, filterLocation, filterStage, filterPermitStatus, filterInspectionStatus]);

  const stats = useMemo(() => {
    const today = new Date();
    const permitPending = filteredProjects.filter(p => isPermitPending(p));
    const permitIssued = filteredProjects.filter(p => isPermitIssued(p));
    const inspectionPending = filteredProjects.filter(p => p.stage === 'Inspection' && !p.inspectionPassDate);
    const inspectionPassed = filteredProjects.filter(p => !!p.inspectionPassDate);

    // Calculate average days in permitting
    const daysInPermitting = permitPending
      .filter(p => p.permitSubmitDate)
      .map(p => Math.floor((today.getTime() - new Date(p.permitSubmitDate!).getTime()) / (1000 * 60 * 60 * 24)));
    const avgDaysInPermitting = daysInPermitting.length > 0
      ? Math.round(daysInPermitting.reduce((a, b) => a + b, 0) / daysInPermitting.length)
      : 0;

    // Calculate average turnaround
    const turnaroundDays = permitIssued
      .filter(p => p.permitSubmitDate && p.permitIssueDate)
      .map(p => {
        const d1 = new Date(p.permitSubmitDate!);
        const d2 = new Date(p.permitIssueDate!);
        return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter(d => d >= 0);
    const avgTurnaround = turnaroundDays.length > 0
      ? Math.round(turnaroundDays.reduce((a, b) => a + b, 0) / turnaroundDays.length)
      : 0;

    // Calculate average days in inspection
    const daysInInspection = inspectionPending
      .filter(p => p.inspectionScheduleDate)
      .map(p => Math.floor((today.getTime() - new Date(p.inspectionScheduleDate!).getTime()) / (1000 * 60 * 60 * 24)));
    const avgDaysInInspection = daysInInspection.length > 0
      ? Math.round(daysInInspection.reduce((a, b) => a + b, 0) / daysInInspection.length)
      : 0;

    // Group by AHJ
    const ahjStats: Record<string, { total: number; permitPending: number; permitIssued: number; inspectionPending: number; avgDays: number[]; totalValue: number }> = {};
    filteredProjects.forEach(p => {
      const ahj = p.ahj || 'Unknown';
      if (!ahjStats[ahj]) {
        ahjStats[ahj] = { total: 0, permitPending: 0, permitIssued: 0, inspectionPending: 0, avgDays: [], totalValue: 0 };
      }
      ahjStats[ahj].total++;
      ahjStats[ahj].totalValue += p.amount || 0;
      if (isPermitIssued(p)) {
        ahjStats[ahj].permitIssued++;
        if (p.permitSubmitDate && p.permitIssueDate) {
          const d1 = new Date(p.permitSubmitDate);
          const d2 = new Date(p.permitIssueDate);
          const days = Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
          if (days >= 0) ahjStats[ahj].avgDays.push(days);
        }
      } else if (isPermitPending(p)) {
        ahjStats[ahj].permitPending++;
      }
      if (p.stage === 'Inspection' && !p.inspectionPassDate) {
        ahjStats[ahj].inspectionPending++;
      }
    });

    return {
      total: filteredProjects.length,
      totalValue: filteredProjects.reduce((s, p) => s + (p.amount || 0), 0),
      permitPending,
      permitIssued,
      inspectionPending,
      inspectionPassed,
      avgDaysInPermitting,
      avgTurnaround,
      avgDaysInInspection,
      ahjStats,
    };
  }, [filteredProjects, isPermitPending, isPermitIssued]);

  // Get unique values for filters
  const ahjs = useMemo(() => [...new Set(projects.map(p => p.ahj))].filter(a => a && a !== 'Unknown').sort(), [projects]);
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
  const permitStatuses = useMemo(() => [...new Set(projects.map(p => (p as ExtendedProject).permittingStatus))].filter(s => s).sort() as string[], [projects]);
  const inspectionStatuses = useMemo(() => [...new Set(projects.map(p => (p as ExtendedProject).finalInspectionStatus))].filter(s => s).sort() as string[], [projects]);

  if (loading) {
    return (
      <DashboardShell title="Permitting & Inspections" accentColor="purple">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500 mx-auto mb-4"></div>
            <p className="text-zinc-400">Loading Permitting & Inspections Data...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Permitting & Inspections" accentColor="purple">
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

  return (
    <DashboardShell title="Permitting & Inspections" accentColor="purple">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap mb-6">
        <select value={filterAhj} onChange={(e) => setFilterAhj(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
          <option value="all">All AHJs</option>
          {ahjs.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
          <option value="all">All Locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
          <option value="all">All Stages</option>
          {stages.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterPermitStatus} onChange={(e) => setFilterPermitStatus(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
          <option value="all">All Permit Status</option>
          {permitStatuses.map(s => <option key={s} value={s}>{getDisplayName(s)}</option>)}
        </select>
        <select value={filterInspectionStatus} onChange={(e) => setFilterInspectionStatus(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
          <option value="all">All Inspection Status</option>
          {inspectionStatuses.map(s => <option key={s} value={s}>{getDisplayName(s)}</option>)}
        </select>
        <button onClick={fetchData} className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg text-sm font-medium">
          Refresh
        </button>
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

      {/* Inspection Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-orange-400">{stats.inspectionPending.length}</div>
          <div className="text-sm text-zinc-400">Inspections Pending</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.inspectionPending.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-emerald-400">{stats.inspectionPassed.length}</div>
          <div className="text-sm text-zinc-400">Inspections Passed</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.inspectionPassed.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-amber-400">{stats.avgDaysInInspection}d</div>
          <div className="text-sm text-zinc-400">Avg Days in Inspection</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-blue-400">{stats.avgDaysInPermitting}d</div>
          <div className="text-sm text-zinc-400">Avg Days Permit Pending</div>
        </div>
      </div>

      {/* AHJ Breakdown */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4">By AHJ</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Object.entries(stats.ahjStats)
            .filter(([ahj]) => ahj !== 'Unknown')
            .sort((a, b) => (b[1].permitPending + b[1].inspectionPending) - (a[1].permitPending + a[1].inspectionPending))
            .slice(0, 12)
            .map(([ahj, ahjData]) => {
              const avgDays = ahjData.avgDays.length > 0
                ? Math.round(ahjData.avgDays.reduce((a, b) => a + b, 0) / ahjData.avgDays.length)
                : null;
              return (
                <div
                  key={ahj}
                  className="bg-zinc-800/50 rounded-lg p-3 cursor-pointer hover:bg-zinc-800 transition-colors"
                  onClick={() => setFilterAhj(ahj)}
                >
                  <div className="text-sm font-medium text-white truncate" title={ahj}>{ahj}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-yellow-400 text-lg font-bold">{ahjData.permitPending}</span>
                    <span className="text-zinc-500 text-xs">permit</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-orange-400 text-sm">{ahjData.inspectionPending}</span>
                    <span className="text-zinc-500 text-xs">inspection</span>
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
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">AHJ</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Permit Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Permit Submitted</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Permit Issued</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Inspection</th>
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
                    if (isPermitPending(a) && !isPermitPending(b)) return -1;
                    if (!isPermitPending(a) && isPermitPending(b)) return 1;
                    if (a.stage === 'Inspection' && b.stage !== 'Inspection') return -1;
                    if (a.stage !== 'Inspection' && b.stage === 'Inspection') return 1;
                    return (b.amount || 0) - (a.amount || 0);
                  })
                  .slice(0, 100)
                  .map(project => {
                    let permitColor = 'bg-zinc-500/20 text-zinc-400';
                    let permitLabel = getDisplayName(project.permittingStatus) || 'Not Started';
                    if (isPermitIssued(project)) {
                      permitColor = 'bg-green-500/20 text-green-400';
                      permitLabel = getDisplayName(project.permittingStatus) || 'Issued';
                    } else if (isPermitPending(project)) {
                      permitColor = 'bg-yellow-500/20 text-yellow-400';
                      permitLabel = getDisplayName(project.permittingStatus) || 'Pending';
                    }

                    let inspectionColor = 'bg-zinc-500/20 text-zinc-500';
                    let inspectionLabel = '-';
                    const rawInspStatus = (project.finalInspectionStatus || '').toLowerCase();
                    if (project.inspectionPassDate || ['passed', 'complete', 'approved'].some(s => rawInspStatus.includes(s))) {
                      inspectionColor = 'bg-emerald-500/20 text-emerald-400';
                      inspectionLabel = getDisplayName(project.finalInspectionStatus) || 'Passed';
                    } else if (project.stage === 'Inspection' || ['pending', 'scheduled', 'in progress', 'submitted'].some(s => rawInspStatus.includes(s))) {
                      inspectionColor = 'bg-orange-500/20 text-orange-400';
                      inspectionLabel = getDisplayName(project.finalInspectionStatus) || (project.inspectionScheduleDate ? 'Scheduled' : 'Pending');
                    } else if (project.finalInspectionStatus) {
                      inspectionLabel = getDisplayName(project.finalInspectionStatus);
                    }

                    return (
                      <tr key={project.id} className="hover:bg-zinc-900/50">
                        <td className="px-4 py-3">
                          <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-white hover:text-purple-400">
                            {project.name.split('|')[0].trim()}
                          </a>
                          <div className="text-xs text-zinc-500">{project.pbLocation}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-300">{project.ahj || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${permitColor}`}>
                            {permitLabel}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.permitSubmitDate ? 'text-blue-400' : 'text-zinc-500'}`}>
                          {project.permitSubmitDate || '-'}
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.permitIssueDate ? 'text-green-400' : 'text-zinc-500'}`}>
                          {project.permitIssueDate || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${inspectionColor}`}>
                            {inspectionLabel}
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
