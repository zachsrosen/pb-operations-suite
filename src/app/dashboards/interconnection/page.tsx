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
// Source: HubSpot property definitions for interconnection_status and pto_status
const DISPLAY_NAMES: Record<string, string> = {
  // Interconnection status
  'Signature Acquired By Customer': 'Ready To Submit',
  'Rejected (New)': 'Rejected',
  'Rejected': 'Rejected - Revisions Needed',
  'In Design For Revisions': 'Design Revision In Progress',
  'Revision Returned From Design': 'Revision Ready To Resubmit',
  // PTO status
  'Inspection Passed - Ready for Utility': 'Inspection Passed - Ready for PTO Submission',
  'Resubmitted to Utility': 'PTO Revision Resubmitted',
  'PTO': 'PTO Granted',
};

function getDisplayName(value: string | undefined): string {
  if (!value) return value || '';
  return DISPLAY_NAMES[value] || value;
}

interface ExtendedProject extends RawProject {
  interconnectionStatus?: string;
  interconnectionSubmitDate?: string;
  interconnectionApprovalDate?: string;
  ptoStatus?: string;
  ptoSubmitDate?: string;
}

// Interconnection Status Groups
const IC_STATUS_GROUPS: FilterGroup[] = [
  {
    name: "Initial Submission",
    options: [
      { value: "Ready for Interconnection", label: "Ready for Interconnection" },
      { value: "Submitted To Customer", label: "Submitted To Customer" },
      { value: "Ready To Submit - Pending Design", label: "Ready To Submit - Pending Design" },
      { value: "Signature Acquired By Customer", label: "Ready To Submit" },
      { value: "Submitted To Utility", label: "Submitted To Utility" },
    ]
  },
  {
    name: "Waiting",
    options: [
      { value: "Waiting On Information", label: "Waiting On Information" },
      { value: "Waiting on Utility Bill", label: "Waiting on Utility Bill" },
      { value: "Waiting on New Construction", label: "Waiting on New Construction" },
      { value: "In Review", label: "In Review" },
    ]
  },
  {
    name: "Rejections & Revisions",
    options: [
      { value: "Non-Design Related Rejection", label: "Non-Design Related Rejection" },
      { value: "Rejected (New)", label: "Rejected" },
      { value: "Rejected", label: "Rejected - Revisions Needed" },
      { value: "In Design For Revisions", label: "Design Revision In Progress" },
      { value: "Revision Returned From Design", label: "Revision Ready To Resubmit" },
      { value: "Resubmitted To Utility", label: "Resubmitted To Utility" },
    ]
  },
  {
    name: "Approved",
    options: [
      { value: "Application Approved", label: "Application Approved" },
      { value: "Application Approved - Pending Signatures", label: "Application Approved - Pending Signatures" },
      { value: "Conditional Application Approval", label: "Conditional Application Approval" },
    ]
  },
  {
    name: "Special Cases",
    options: [
      { value: "Transformer Upgrade", label: "Transformer Upgrade" },
      { value: "Supplemental Review", label: "Supplemental Review" },
      { value: "RBC On Hold", label: "RBC On Hold" },
      { value: "Pending Rebate Approval", label: "Pending Rebate Approval" },
      { value: "Xcel Site Plan & SLD Needed", label: "Xcel Site Plan & SLD Needed" },
    ]
  },
  {
    name: "Other",
    options: [
      { value: "Not Needed", label: "Not Needed" },
    ]
  },
];

// PTO Status Groups
const PTO_STATUS_GROUPS: FilterGroup[] = [
  {
    name: "Pre-Submission",
    options: [
      { value: "PTO Waiting on Interconnection Approval", label: "Waiting on IC Approval" },
      { value: "Inspection Passed - Ready for Utility", label: "Ready for PTO Submission" },
    ]
  },
  {
    name: "Submitted",
    options: [
      { value: "Inspection Submitted to Utility", label: "Submitted to Utility" },
      { value: "Resubmitted to Utility", label: "PTO Revision Resubmitted" },
    ]
  },
  {
    name: "Rejections",
    options: [
      { value: "Inspection Rejected By Utility", label: "Inspection Rejected" },
      { value: "Ops Related PTO Rejection", label: "Ops Related Rejection" },
    ]
  },
  {
    name: "Waiting",
    options: [
      { value: "Waiting On Information", label: "Waiting On Information" },
      { value: "Waiting on New Construction", label: "Waiting on New Construction" },
      { value: "Pending Truck Roll", label: "Pending Truck Roll" },
    ]
  },
  {
    name: "Xcel Photos",
    options: [
      { value: "Xcel Photos Ready to Submit", label: "Photos Ready to Submit" },
      { value: "Xcel Photos Submitted", label: "Photos Submitted" },
      { value: "XCEL Photos Rejected", label: "Photos Rejected" },
      { value: "Xcel Photos Ready to Resubmit", label: "Photos Ready to Resubmit" },
      { value: "Xcel Photos Resubmitted", label: "Photos Resubmitted" },
      { value: "Xcel Photos Approved", label: "Photos Approved" },
    ]
  },
  {
    name: "Completed",
    options: [
      { value: "PTO", label: "PTO Granted" },
      { value: "Conditional PTO - Pending Transformer Upgrade", label: "Conditional PTO" },
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
const ALL_IC_STATUS_OPTIONS = IC_STATUS_GROUPS.flatMap(g => g.options || []);
const ALL_PTO_STATUS_OPTIONS = PTO_STATUS_GROUPS.flatMap(g => g.options || []);

export default function InterconnectionPage() {
  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, error, refetch } = useProjectData<ExtendedProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: ExtendedProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  // Multi-select filters
  const [filterUtilities, setFilterUtilities] = useState<string[]>([]);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterIcStatuses, setFilterIcStatuses] = useState<string[]>([]);
  const [filterPtoStatuses, setFilterPtoStatuses] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("interconnection", {
        projectCount: safeProjects.length,
      });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

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
    return safeProjects.filter(p => {
      // Utility filter (multi-select)
      if (filterUtilities.length > 0 && !filterUtilities.includes(p.utility || '')) return false;

      // Location filter (multi-select)
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || '')) return false;

      // Stage filter (multi-select)
      if (filterStages.length > 0 && !filterStages.includes(p.stage || '')) return false;

      // IC Status filter (multi-select)
      if (filterIcStatuses.length > 0 && !filterIcStatuses.includes(p.interconnectionStatus || '')) return false;

      // PTO Status filter (multi-select)
      if (filterPtoStatuses.length > 0 && !filterPtoStatuses.includes(p.ptoStatus || '')) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const name = (p.name || '').toLowerCase();
        const location = (p.pbLocation || '').toLowerCase();
        const utility = (p.utility || '').toLowerCase();
        if (!name.includes(query) && !location.includes(query) && !utility.includes(query)) return false;
      }

      return true;
    });
  }, [safeProjects, filterUtilities, filterLocations, filterStages, filterIcStatuses, filterPtoStatuses, searchQuery]);

  const stats = useMemo(() => {
    const today = new Date();
    const icPending = filteredProjects.filter(p => isIcPending(p));
    const icApproved = filteredProjects.filter(p => isIcApproved(p));
    const ptoPending = filteredProjects.filter(p => p.stage === 'Permission To Operate' && !p.ptoGrantedDate);
    const ptoGranted = filteredProjects.filter(p => !!p.ptoGrantedDate);

    // Calculate average days waiting for IC
    const daysWaitingIc = icPending
      .filter(p => p.interconnectionSubmitDate)
      .map(p => Math.floor((today.getTime() - new Date(p.interconnectionSubmitDate! + "T12:00:00").getTime()) / (1000 * 60 * 60 * 24)));
    const avgDaysWaitingIc = daysWaitingIc.length > 0
      ? Math.round(daysWaitingIc.reduce((a, b) => a + b, 0) / daysWaitingIc.length)
      : 0;

    // Calculate average turnaround
    const turnaroundDays = icApproved
      .filter(p => p.interconnectionSubmitDate && p.interconnectionApprovalDate)
      .map(p => {
        const d1 = new Date(p.interconnectionSubmitDate! + "T12:00:00");
        const d2 = new Date(p.interconnectionApprovalDate! + "T12:00:00");
        return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter(d => d >= 0);
    const avgTurnaround = turnaroundDays.length > 0
      ? Math.round(turnaroundDays.reduce((a, b) => a + b, 0) / turnaroundDays.length)
      : 0;

    // Calculate average days in PTO
    const daysInPto = ptoPending
      .filter(p => p.ptoSubmitDate)
      .map(p => Math.floor((today.getTime() - new Date(p.ptoSubmitDate! + "T12:00:00").getTime()) / (1000 * 60 * 60 * 24)));
    const avgDaysInPto = daysInPto.length > 0
      ? Math.round(daysInPto.reduce((a, b) => a + b, 0) / daysInPto.length)
      : 0;

    // IC Status breakdown
    const icStatusStats: Record<string, number> = {};
    const ptoStatusStats: Record<string, number> = {};

    filteredProjects.forEach(p => {
      if (p.interconnectionStatus) {
        icStatusStats[p.interconnectionStatus] = (icStatusStats[p.interconnectionStatus] || 0) + 1;
      }
      if (p.ptoStatus) {
        ptoStatusStats[p.ptoStatus] = (ptoStatusStats[p.ptoStatus] || 0) + 1;
      }
    });

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
          const d1 = new Date(p.interconnectionSubmitDate + "T12:00:00");
          const d2 = new Date(p.interconnectionApprovalDate + "T12:00:00");
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
      icStatusStats,
      ptoStatusStats,
      utilityStats,
    };
  }, [filteredProjects, isIcPending, isIcApproved]);

  // Get unique values for filters
  const utilities = useMemo(() =>
    [...new Set(safeProjects.map(p => p.utility))]
      .filter(u => u && u !== 'Unknown')
      .sort()
      .map(u => ({ value: u!, label: u! })),
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
  const existingIcStatuses = useMemo(() =>
    new Set(safeProjects.map(p => (p as ExtendedProject).interconnectionStatus).filter(Boolean)),
    [safeProjects]
  );

  const existingPtoStatuses = useMemo(() =>
    new Set(safeProjects.map(p => (p as ExtendedProject).ptoStatus).filter(Boolean)),
    [safeProjects]
  );

  // Filter groups to only include options that exist in the actual data
  const filteredIcStatusGroups = useMemo(() => {
    const knownValues = new Set(ALL_IC_STATUS_OPTIONS.map(o => o.value));
    const uncategorized = [...existingIcStatuses].filter(s => !knownValues.has(s as string));

    const filtered = IC_STATUS_GROUPS.map(group => ({
      ...group,
      options: group.options?.filter(opt => existingIcStatuses.has(opt.value)) || []
    })).filter(group => group.options && group.options.length > 0);

    if (uncategorized.length > 0) {
      filtered.push({
        name: "Other",
        options: uncategorized.map(status => ({ value: status as string, label: getDisplayName(status as string) }))
      });
    }

    return filtered;
  }, [existingIcStatuses]);

  const filteredPtoStatusGroups = useMemo(() => {
    const knownValues = new Set(ALL_PTO_STATUS_OPTIONS.map(o => o.value));
    const uncategorized = [...existingPtoStatuses].filter(s => !knownValues.has(s as string));

    const filtered = PTO_STATUS_GROUPS.map(group => ({
      ...group,
      options: group.options?.filter(opt => existingPtoStatuses.has(opt.value)) || []
    })).filter(group => group.options && group.options.length > 0);

    if (uncategorized.length > 0) {
      filtered.push({
        name: "Other",
        options: uncategorized.map(status => ({ value: status as string, label: getDisplayName(status as string) }))
      });
    }

    return filtered;
  }, [existingPtoStatuses]);

  // Flatten filtered groups to get all options
  const filteredIcStatusOptions = useMemo(() =>
    filteredIcStatusGroups.flatMap(g => g.options || []),
    [filteredIcStatusGroups]
  );

  const filteredPtoStatusOptions = useMemo(() =>
    filteredPtoStatusGroups.flatMap(g => g.options || []),
    [filteredPtoStatusGroups]
  );

  const clearAllFilters = () => {
    setFilterUtilities([]);
    setFilterLocations([]);
    setFilterStages([]);
    setFilterIcStatuses([]);
    setFilterPtoStatuses([]);
    setSearchQuery("");
  };

  const hasActiveFilters = filterUtilities.length > 0 || filterLocations.length > 0 ||
    filterStages.length > 0 || filterIcStatuses.length > 0 || filterPtoStatuses.length > 0 || searchQuery;

  if (loading) {
    return (
      <DashboardShell title="Interconnection & PTO" accentColor="orange">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500 mx-auto mb-4"></div>
            <p className="text-muted">Loading Interconnection & PTO Data...</p>
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
            <p className="text-sm text-muted">{error}</p>
            <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-amber-600 rounded-lg hover:bg-amber-700">
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const getIcStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-muted';
    const lower = status.toLowerCase();
    if (lower.includes('approved') || lower.includes('complete')) return 'bg-green-500/20 text-green-400';
    if (lower.includes('submitted') || lower.includes('in review')) return 'bg-blue-500/20 text-blue-400';
    if (lower.includes('rejected') || lower.includes('revision')) return 'bg-orange-500/20 text-orange-400';
    if (lower.includes('waiting') || lower.includes('pending')) return 'bg-yellow-500/20 text-yellow-400';
    return 'bg-zinc-500/20 text-muted';
  };

  const getPtoStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-muted';
    const lower = status.toLowerCase();
    if (lower === 'pto' || lower.includes('granted') || lower.includes('approved')) return 'bg-emerald-500/20 text-emerald-400';
    if (lower.includes('submitted') || lower.includes('resubmitted')) return 'bg-cyan-500/20 text-cyan-400';
    if (lower.includes('rejected')) return 'bg-red-500/20 text-red-400';
    if (lower.includes('waiting') || lower.includes('pending')) return 'bg-orange-500/20 text-orange-400';
    if (lower.includes('xcel') || lower.includes('photos')) return 'bg-purple-500/20 text-purple-400';
    return 'bg-zinc-500/20 text-muted';
  };

  return (
    <DashboardShell title="Interconnection & PTO" accentColor="orange">
      {/* Search and Filters */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Search Bar */}
        <div className="flex items-center gap-3">
          <ProjectSearchBar
            onSearch={setSearchQuery}
            placeholder="Search by PROJ #, name, location, or utility..."
          />
          <button onClick={() => refetch()} className="bg-amber-600 hover:bg-amber-700 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
            Refresh
          </button>
        </div>

        {/* Filter Row */}
        <div className="flex items-center gap-3 flex-wrap">
          <MultiSelectFilter
            label="Utility"
            options={utilities}
            selected={filterUtilities}
            onChange={setFilterUtilities}
            placeholder="All Utilities"
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
            accentColor="purple"
          />
          <MultiSelectFilter
            label="IC Status"
            options={filteredIcStatusOptions}
            groups={filteredIcStatusGroups}
            selected={filterIcStatuses}
            onChange={setFilterIcStatuses}
            placeholder="All IC Statuses"
            accentColor="green"
          />
          <MultiSelectFilter
            label="PTO Status"
            options={filteredPtoStatusOptions}
            groups={filteredPtoStatusGroups}
            selected={filterPtoStatuses}
            onChange={setFilterPtoStatuses}
            placeholder="All PTO Statuses"
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-amber-400">{stats.total}</div>
          <div className="text-sm text-muted">Total Projects</div>
          <div className="text-xs text-muted">{formatMoney(stats.totalValue)}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-yellow-400">{stats.icPending.length}</div>
          <div className="text-sm text-muted">IC Pending</div>
          <div className="text-xs text-muted">{formatMoney(stats.icPending.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-green-400">{stats.icApproved.length}</div>
          <div className="text-sm text-muted">IC Approved</div>
          <div className="text-xs text-muted">{formatMoney(stats.icApproved.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-cyan-400">{stats.avgTurnaround}d</div>
          <div className="text-sm text-muted">Avg IC Turnaround</div>
        </div>
      </div>

      {/* PTO Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-orange-400">{stats.ptoPending.length}</div>
          <div className="text-sm text-muted">PTO Pending</div>
          <div className="text-xs text-muted">{formatMoney(stats.ptoPending.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-emerald-400">{stats.ptoGranted.length}</div>
          <div className="text-sm text-muted">PTO Granted</div>
          <div className="text-xs text-muted">{formatMoney(stats.ptoGranted.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-purple-400">{stats.avgDaysInPto}d</div>
          <div className="text-sm text-muted">Avg Days in PTO</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-blue-400">{stats.avgDaysWaitingIc}d</div>
          <div className="text-sm text-muted">Avg Days IC Pending</div>
        </div>
      </div>

      {/* IC Approvals & PTO Granted by Month */}
      {!loading && (stats.icApproved.length > 0 || stats.ptoGranted.length > 0) && (
        <div className="mb-6">
          <MonthlyBarChart
            title="Approvals & PTO by Month"
            data={aggregateMonthly(
              stats.icApproved
                .filter((p: ExtendedProject) => p.interconnectionApprovalDate)
                .map((p: ExtendedProject) => ({ date: p.interconnectionApprovalDate, amount: p.amount })),
              6,
            )}
            secondaryData={aggregateMonthly(
              stats.ptoGranted.map(p => ({ date: p.ptoGrantedDate, amount: p.amount })),
              6,
            )}
            accentColor="emerald"
            primaryLabel="IC Approved"
            secondaryLabel="PTO Granted"
            defaultCollapsed
          />
        </div>
      )}

      {/* Status Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* IC Status Breakdown */}
        <div className="bg-surface rounded-xl border border-t-border p-4">
          <h2 className="text-lg font-semibold mb-4 text-amber-400">By IC Status</h2>
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {Object.keys(stats.icStatusStats).length === 0 ? (
              <p className="text-muted text-sm">No IC status data available</p>
            ) : (
              Object.entries(stats.icStatusStats)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div
                    key={status}
                    className={`flex items-center justify-between p-2 bg-skeleton rounded-lg cursor-pointer hover:bg-surface-2 transition-colors ${
                      filterIcStatuses.includes(status) ? 'ring-1 ring-amber-500' : ''
                    }`}
                    onClick={() => {
                      if (filterIcStatuses.includes(status)) {
                        setFilterIcStatuses(filterIcStatuses.filter(s => s !== status));
                      } else {
                        setFilterIcStatuses([...filterIcStatuses, status]);
                      }
                    }}
                  >
                    <span className="text-sm text-foreground/80">{getDisplayName(status)}</span>
                    <span className="text-lg font-bold text-amber-400">{count}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* PTO Status Breakdown */}
        <div className="bg-surface rounded-xl border border-t-border p-4">
          <h2 className="text-lg font-semibold mb-4 text-orange-400">By PTO Status</h2>
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {Object.keys(stats.ptoStatusStats).length === 0 ? (
              <p className="text-muted text-sm">No PTO status data available</p>
            ) : (
              Object.entries(stats.ptoStatusStats)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div
                    key={status}
                    className={`flex items-center justify-between p-2 bg-skeleton rounded-lg cursor-pointer hover:bg-surface-2 transition-colors ${
                      filterPtoStatuses.includes(status) ? 'ring-1 ring-orange-500' : ''
                    }`}
                    onClick={() => {
                      if (filterPtoStatuses.includes(status)) {
                        setFilterPtoStatuses(filterPtoStatuses.filter(s => s !== status));
                      } else {
                        setFilterPtoStatuses([...filterPtoStatuses, status]);
                      }
                    }}
                  >
                    <span className="text-sm text-foreground/80">{getDisplayName(status)}</span>
                    <span className="text-lg font-bold text-orange-400">{count}</span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* Utility Breakdown */}
      <div className="bg-surface rounded-xl border border-t-border p-4 mb-6">
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
                  className={`bg-skeleton rounded-lg p-3 cursor-pointer hover:bg-surface-2 transition-colors ${
                    filterUtilities.includes(utility) ? 'ring-1 ring-amber-500' : ''
                  }`}
                  onClick={() => {
                    if (filterUtilities.includes(utility)) {
                      setFilterUtilities(filterUtilities.filter(u => u !== utility));
                    } else {
                      setFilterUtilities([...filterUtilities, utility]);
                    }
                  }}
                >
                  <div className="text-sm font-medium text-foreground truncate" title={utility}>{utility}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-yellow-400 text-lg font-bold">{utilityData.icPending}</span>
                    <span className="text-muted text-xs">IC</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-orange-400 text-sm">{utilityData.ptoPending}</span>
                    <span className="text-muted text-xs">PTO</span>
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
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Utility</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Interconnection</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">IC Submitted</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">IC Approved</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">PTO Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">PTO Submitted</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">PTO Granted</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-t-border">
              {filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted">No projects found</td>
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
                    const icLabel = getDisplayName(project.interconnectionStatus) || (
                      isIcApproved(project) ? 'Approved' :
                      isIcPending(project) ? 'Pending' : 'Not Started'
                    );

                    let ptoLabel = '-';
                    const rawPtoStatus = (project.ptoStatus || '').toLowerCase();
                    if (project.ptoGrantedDate || rawPtoStatus === 'pto' || ['granted', 'complete', 'approved', 'received'].some(s => rawPtoStatus.includes(s))) {
                      ptoLabel = getDisplayName(project.ptoStatus) || 'Granted';
                    } else if (project.stage === 'Permission To Operate' || ['pending', 'submitted', 'in progress', 'in review'].some(s => rawPtoStatus.includes(s))) {
                      ptoLabel = getDisplayName(project.ptoStatus) || (project.ptoSubmitDate ? 'Submitted' : 'Pending');
                    } else if (project.ptoStatus) {
                      ptoLabel = getDisplayName(project.ptoStatus);
                    }

                    return (
                      <tr key={project.id} className="hover:bg-surface/50">
                        <td className="px-4 py-3">
                          <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-amber-400">
                            {project.name.split('|')[0].trim()}
                          </a>
                          <div className="text-xs text-muted">{project.name.split('|')[1]?.trim() || ''}</div>
                          <div className="text-xs text-muted">{project.pbLocation}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-muted">{project.stage || '-'}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground/80">{project.utility || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getIcStatusColor(project.interconnectionStatus)}`}>
                            {icLabel}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.interconnectionSubmitDate ? 'text-blue-400' : 'text-muted'}`}>
                          {project.interconnectionSubmitDate || '-'}
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.interconnectionApprovalDate ? 'text-green-400' : 'text-muted'}`}>
                          {project.interconnectionApprovalDate || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getPtoStatusColor(project.ptoStatus)}`}>
                            {ptoLabel}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.ptoSubmitDate ? 'text-cyan-400' : 'text-muted'}`}>
                          {project.ptoSubmitDate || '-'}
                        </td>
                        <td className={`px-4 py-3 text-sm ${project.ptoGrantedDate ? 'text-emerald-400' : 'text-muted'}`}>
                          {project.ptoGrantedDate || '-'}
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
