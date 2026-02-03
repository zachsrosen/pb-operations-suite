"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";

// Display name mappings for status values
const DISPLAY_NAMES: Record<string, string> = {
  'design_complete': 'Design Complete',
  'design_in_progress': 'Design In Progress',
  'awaiting_info': 'Awaiting Info',
  'revisions_needed': 'Revisions Needed',
  'pending_review': 'Pending Review',
  'not_started': 'Not Started',
  'on_hold': 'On Hold',
  'approved': 'Approved',
  'pending_approval': 'Pending Approval',
  'pending': 'Pending',
  'submitted': 'Submitted',
  'revision_requested': 'Revision Requested',
  'rejected': 'Rejected',
  'in_review': 'In Review',
  'complete': 'Complete',
  'completed': 'Completed',
  'in_progress': 'In Progress',
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
  designStatus?: string;
  layoutStatus?: string;
  designCompletionDate?: string;
  designApprovalDate?: string;
}

export default function DesignEngineeringPage() {
  const [projects, setProjects] = useState<ExtendedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterStage, setFilterStage] = useState("all");
  const [filterDesignStatus, setFilterDesignStatus] = useState("all");
  const [filterLayoutStatus, setFilterLayoutStatus] = useState("all");

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

  // Check if project is in design phase or has design data
  const isInDesignPhase = useCallback((p: ExtendedProject) => {
    return p.stage === 'Design & Engineering' ||
           p.stage === 'Site Survey' ||
           p.designStatus ||
           p.layoutStatus ||
           p.designCompletionDate ||
           p.designApprovalDate;
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (!isInDesignPhase(p)) return false;
      if (filterLocation !== 'all' && p.pbLocation !== filterLocation) return false;
      if (filterStage !== 'all' && p.stage !== filterStage) return false;
      if (filterDesignStatus !== 'all' && p.designStatus !== filterDesignStatus) return false;
      if (filterLayoutStatus !== 'all' && p.layoutStatus !== filterLayoutStatus) return false;
      return true;
    });
  }, [projects, filterLocation, filterStage, filterDesignStatus, filterLayoutStatus, isInDesignPhase]);

  const stats = useMemo(() => {
    const today = new Date();
    const inDesignStage = filteredProjects.filter(p => p.stage === 'Design & Engineering');
    const designComplete = filteredProjects.filter(p => p.designCompletionDate && !p.designApprovalDate);
    const layoutApproved = filteredProjects.filter(p => p.designApprovalDate);

    // Calculate design status breakdown
    const designStatusStats: Record<string, number> = {};
    const layoutStatusStats: Record<string, number> = {};

    filteredProjects.forEach(p => {
      if (p.designStatus) {
        designStatusStats[p.designStatus] = (designStatusStats[p.designStatus] || 0) + 1;
      }
      if (p.layoutStatus) {
        layoutStatusStats[p.layoutStatus] = (layoutStatusStats[p.layoutStatus] || 0) + 1;
      }
    });

    // Calculate average days in design
    const daysInDesign = inDesignStage
      .filter(p => p.closeDate)
      .map(p => Math.floor((today.getTime() - new Date(p.closeDate!).getTime()) / (1000 * 60 * 60 * 24)));
    const avgDaysInDesign = daysInDesign.length > 0
      ? Math.round(daysInDesign.reduce((a, b) => a + b, 0) / daysInDesign.length)
      : 0;

    // Calculate average design turnaround
    const designTurnaroundDays = filteredProjects
      .filter(p => p.closeDate && p.designCompletionDate)
      .map(p => {
        const d1 = new Date(p.closeDate!);
        const d2 = new Date(p.designCompletionDate!);
        return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter(d => d >= 0);
    const avgDesignTurnaround = designTurnaroundDays.length > 0
      ? Math.round(designTurnaroundDays.reduce((a, b) => a + b, 0) / designTurnaroundDays.length)
      : 0;

    return {
      total: filteredProjects.length,
      totalValue: filteredProjects.reduce((s, p) => s + (p.amount || 0), 0),
      inDesignStage,
      designComplete,
      layoutApproved,
      designStatusStats,
      layoutStatusStats,
      avgDaysInDesign,
      avgDesignTurnaround,
    };
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
  const designStatuses = useMemo(() => [...new Set(projects.map(p => (p as ExtendedProject).designStatus))].filter(s => s).sort() as string[], [projects]);
  const layoutStatuses = useMemo(() => [...new Set(projects.map(p => (p as ExtendedProject).layoutStatus))].filter(s => s).sort() as string[], [projects]);

  if (loading) {
    return (
      <DashboardShell title="Design & Engineering" accentColor="indigo">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto mb-4"></div>
            <p className="text-zinc-400">Loading Design & Engineering Data...</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Design & Engineering" accentColor="indigo">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center text-red-500">
            <p className="text-xl mb-2">Error loading data</p>
            <p className="text-sm text-zinc-400">{error}</p>
            <button onClick={fetchData} className="mt-4 px-4 py-2 bg-indigo-600 rounded-lg hover:bg-indigo-700">
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const getDesignStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-zinc-400';
    const lower = status.toLowerCase();
    if (lower.includes('complete') || lower.includes('done') || lower.includes('finished')) return 'bg-green-500/20 text-green-400';
    if (lower.includes('progress') || lower.includes('working') || lower.includes('active')) return 'bg-yellow-500/20 text-yellow-400';
    if (lower.includes('pending') || lower.includes('waiting') || lower.includes('hold')) return 'bg-orange-500/20 text-orange-400';
    return 'bg-zinc-500/20 text-zinc-400';
  };

  const getLayoutStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-zinc-400';
    const lower = status.toLowerCase();
    if (lower.includes('approved') || lower.includes('complete') || lower.includes('done')) return 'bg-emerald-500/20 text-emerald-400';
    if (lower.includes('review') || lower.includes('submitted')) return 'bg-blue-500/20 text-blue-400';
    if (lower.includes('pending') || lower.includes('waiting') || lower.includes('revision')) return 'bg-orange-500/20 text-orange-400';
    return 'bg-zinc-500/20 text-zinc-400';
  };

  return (
    <DashboardShell title="Design & Engineering" accentColor="indigo">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap mb-6">
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
        <select
          value={filterDesignStatus}
          onChange={(e) => setFilterDesignStatus(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Design Status</option>
          {designStatuses.map(s => <option key={s} value={s}>{getDisplayName(s)}</option>)}
        </select>
        <select
          value={filterLayoutStatus}
          onChange={(e) => setFilterLayoutStatus(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Design Approval Status</option>
          {layoutStatuses.map(s => <option key={s} value={s}>{getDisplayName(s)}</option>)}
        </select>
        <button onClick={fetchData} className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg text-sm font-medium">
          Refresh
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-indigo-400">{stats.total}</div>
          <div className="text-sm text-zinc-400">Total Projects</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.totalValue)}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-yellow-400">{stats.inDesignStage.length}</div>
          <div className="text-sm text-zinc-400">In Design Stage</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.inDesignStage.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-blue-400">{stats.designComplete.length}</div>
          <div className="text-sm text-zinc-400">Design Complete</div>
          <div className="text-xs text-zinc-500">Awaiting approval</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-green-400">{stats.layoutApproved.length}</div>
          <div className="text-sm text-zinc-400">Layout Approved</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.layoutApproved.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
      </div>

      {/* Timing Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-cyan-400">{stats.avgDaysInDesign}d</div>
          <div className="text-sm text-zinc-400">Avg Days in Design</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-purple-400">{stats.avgDesignTurnaround}d</div>
          <div className="text-sm text-zinc-400">Avg Design Turnaround</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-amber-400">{Object.keys(stats.designStatusStats).length}</div>
          <div className="text-sm text-zinc-400">Design Statuses</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-zinc-800">
          <div className="text-2xl font-bold text-pink-400">{Object.keys(stats.layoutStatusStats).length}</div>
          <div className="text-sm text-zinc-400">Layout Statuses</div>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Design Status Breakdown */}
        <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-4">
          <h2 className="text-lg font-semibold mb-4 text-indigo-400">By Design Status</h2>
          <div className="space-y-2">
            {Object.keys(stats.designStatusStats).length === 0 ? (
              <p className="text-zinc-500 text-sm">No design status data available</p>
            ) : (
              Object.entries(stats.designStatusStats)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div
                    key={status}
                    className="flex items-center justify-between p-2 bg-zinc-800/50 rounded-lg cursor-pointer hover:bg-zinc-800 transition-colors"
                    onClick={() => setFilterDesignStatus(status)}
                  >
                    <span className="text-sm text-zinc-300">{getDisplayName(status)}</span>
                    <span className="text-lg font-bold text-indigo-400">{count}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* Layout Status Breakdown */}
        <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-4">
          <h2 className="text-lg font-semibold mb-4 text-purple-400">By Design Approval Status</h2>
          <div className="space-y-2">
            {Object.keys(stats.layoutStatusStats).length === 0 ? (
              <p className="text-zinc-500 text-sm">No design approval status data available</p>
            ) : (
              Object.entries(stats.layoutStatusStats)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div
                    key={status}
                    className="flex items-center justify-between p-2 bg-zinc-800/50 rounded-lg cursor-pointer hover:bg-zinc-800 transition-colors"
                    onClick={() => setFilterLayoutStatus(status)}
                  >
                    <span className="text-sm text-zinc-300">{getDisplayName(status)}</span>
                    <span className="text-lg font-bold text-purple-400">{count}</span>
                  </div>
                ))
            )}
          </div>
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
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Design Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Design Approval</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Design Complete</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Design Approved</th>
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
                    if (a.stage === 'Design & Engineering' && b.stage !== 'Design & Engineering') return -1;
                    if (a.stage !== 'Design & Engineering' && b.stage === 'Design & Engineering') return 1;
                    return (b.amount || 0) - (a.amount || 0);
                  })
                  .slice(0, 100)
                  .map(project => (
                    <tr key={project.id} className="hover:bg-zinc-900/50">
                      <td className="px-4 py-3">
                        <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-white hover:text-indigo-400">
                          {project.name.split('|')[0].trim()}
                        </a>
                        <div className="text-xs text-zinc-500">{project.pbLocation}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">{project.stage}</td>
                      <td className="px-4 py-3">
                        {project.designStatus ? (
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getDesignStatusColor(project.designStatus)}`}>
                            {getDisplayName(project.designStatus)}
                          </span>
                        ) : (
                          <span className="text-zinc-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {project.layoutStatus ? (
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getLayoutStatusColor(project.layoutStatus)}`}>
                            {getDisplayName(project.layoutStatus)}
                          </span>
                        ) : (
                          <span className="text-zinc-500">-</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-sm ${project.designCompletionDate ? 'text-green-400' : 'text-zinc-500'}`}>
                        {project.designCompletionDate || '-'}
                      </td>
                      <td className={`px-4 py-3 text-sm ${project.designApprovalDate ? 'text-emerald-400' : 'text-zinc-500'}`}>
                        {project.designApprovalDate || '-'}
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
