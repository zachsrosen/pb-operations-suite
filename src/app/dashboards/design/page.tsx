"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { MultiSelectFilter, ProjectSearchBar, FilterGroup } from "@/components/ui/MultiSelectFilter";

// Display name mappings for status values
const DISPLAY_NAMES: Record<string, string> = {
  // Design Status - with rename for DA Approved
  'DA Approved': 'DA Approved - Final Design Review',
  'da approved': 'DA Approved - Final Design Review',
  'da_approved': 'DA Approved - Final Design Review',
  // Other mappings
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
  // Check exact match first (for DA Approved)
  if (DISPLAY_NAMES[value]) return DISPLAY_NAMES[value];
  // Then check normalized key
  const key = value.toLowerCase().replace(/[\s-]+/g, '_');
  return DISPLAY_NAMES[key] || value;
}

interface ExtendedProject extends RawProject {
  designStatus?: string;
  layoutStatus?: string; // This is Design Approval Status in HubSpot
  designCompletionDate?: string;
  designApprovalDate?: string;
}

// Design Status Groups
const DESIGN_STATUS_GROUPS: FilterGroup[] = [
  {
    name: "Initial Design",
    options: [
      { value: "Ready for Design", label: "Ready for Design" },
      { value: "In Progress", label: "In Progress" },
      { value: "Ready For Review", label: "Ready For Review (Initial)" },
      { value: "Final Review/Stamping", label: "Final Review/Stamping" },
      { value: "Draft Complete - Waiting on Approvals", label: "Draft Complete - Waiting on Approvals" },
    ]
  },
  {
    name: "Engineering & Completion",
    options: [
      { value: "Submitted To Engineering", label: "Submitted To Engineering" },
      { value: "DA Approved", label: "DA Approved - Final Design Review" },
      { value: "Design Complete", label: "Design Complete" },
    ]
  },
  {
    name: "DA Revisions",
    options: [
      { value: "Revision Needed - DA Rejected", label: "Revision Needed - DA Rejected" },
      { value: "DA Revision In Progress", label: "DA Revision In Progress" },
      { value: "DA Revision Completed", label: "DA Revision Completed" },
    ]
  },
  {
    name: "Permit Revisions",
    options: [
      { value: "Revision Needed - Rejected by AHJ", label: "Revision Needed - Rejected by AHJ" },
      { value: "Permit Revision In Progress", label: "Permit Revision In Progress" },
      { value: "Permit Revision Completed", label: "Permit Revision Completed" },
    ]
  },
  {
    name: "Utility Revisions",
    options: [
      { value: "Revision Needed - Rejected by Utility", label: "Revision Needed - Rejected by Utility" },
      { value: "Utility Revision In Progress", label: "Utility Revision In Progress" },
      { value: "Utility Revision Completed", label: "Utility Revision Completed" },
    ]
  },
  {
    name: "As-Built Revisions",
    options: [
      { value: "Revision Needed - As-Built", label: "Revision Needed - As-Built" },
      { value: "As-Built Revision In Progress", label: "As-Built Revision In Progress" },
      { value: "As-Built Revision Completed", label: "As-Built Revision Completed" },
    ]
  },
  {
    name: "Needs Clarification",
    options: [
      { value: "Needs Clarification", label: "Needs Clarification" },
      { value: "Needs Clarification from Customer", label: "From Customer" },
      { value: "Needs Clarification from Sales", label: "From Sales" },
      { value: "Needs Clarification from Operations", label: "From Operations" },
    ]
  },
  {
    name: "New Construction",
    options: [
      { value: "New Construction - Design Needed", label: "Design Needed" },
      { value: "New Construction - In Progress", label: "In Progress" },
      { value: "New Construction - Ready for Review", label: "Ready for Review" },
      { value: "New Construction - Design Completed", label: "Design Completed" },
    ]
  },
  {
    name: "Xcel",
    options: [
      { value: "Xcel - Design Needed", label: "Design Needed" },
      { value: "Xcel - In Progress", label: "In Progress" },
      { value: "Xcel - Site Plan & SLD Completed", label: "Site Plan & SLD Completed" },
    ]
  },
  {
    name: "Other",
    options: [
      { value: "Pending Resurvey", label: "Pending Resurvey" },
      { value: "On Hold", label: "On Hold" },
      { value: "No Design Needed", label: "No Design Needed" },
    ]
  },
  {
    name: "Archived",
    options: [
      { value: "(Archived) Revision In Progress", label: "Revision In Progress" },
      { value: "(Archived) Revision Complete", label: "Revision Complete" },
      { value: "(Archived) Revision Initial Review", label: "Revision Initial Review" },
      { value: "(Archived) Revision Final Review/Stamping", label: "Revision Final Review" },
      { value: "(Archived) Revision In Engineering", label: "Revision In Engineering" },
    ]
  },
];

// Design Approval Status Groups (formerly Layout Status)
const DESIGN_APPROVAL_GROUPS: FilterGroup[] = [
  {
    name: "In Review",
    options: [
      { value: "Review In Progress", label: "Review In Progress" },
      { value: "Draft Complete", label: "Draft Complete" },
      { value: "Pending Review", label: "Pending Review" },
    ]
  },
  {
    name: "Sent to Customer",
    options: [
      { value: "Sent For Approval", label: "Sent For Approval" },
      { value: "Resent For Approval", label: "Resent For Approval" },
    ]
  },
  {
    name: "Approved/Rejected",
    options: [
      { value: "Design Approved", label: "Design Approved" },
      { value: "Design Rejected", label: "Design Rejected" },
    ]
  },
  {
    name: "Revisions",
    options: [
      { value: "In Revision", label: "In Revision" },
      { value: "DA Revision Ready To Send", label: "DA Revision Ready To Send" },
    ]
  },
  {
    name: "Pending Changes",
    options: [
      { value: "Needs Clarification", label: "Needs Clarification" },
      { value: "Pending Sales Changes", label: "Pending Sales Changes" },
      { value: "Pending Ops Changes", label: "Pending Ops Changes" },
      { value: "Pending Design Changes", label: "Pending Design Changes" },
      { value: "Pending Resurvey", label: "Pending Resurvey" },
    ]
  },
];

// Flatten groups to get all options
const ALL_DESIGN_STATUS_OPTIONS = DESIGN_STATUS_GROUPS.flatMap(g => g.options || []);
const ALL_DESIGN_APPROVAL_OPTIONS = DESIGN_APPROVAL_GROUPS.flatMap(g => g.options || []);

export default function DesignEngineeringPage() {
  const [projects, setProjects] = useState<ExtendedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Multi-select filters
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterDesignStatuses, setFilterDesignStatuses] = useState<string[]>([]);
  const [filterDesignApprovalStatuses, setFilterDesignApprovalStatuses] = useState<string[]>([]);
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

      // Location filter (multi-select)
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || '')) return false;

      // Stage filter (multi-select)
      if (filterStages.length > 0 && !filterStages.includes(p.stage || '')) return false;

      // Design Status filter (multi-select)
      if (filterDesignStatuses.length > 0 && !filterDesignStatuses.includes(p.designStatus || '')) return false;

      // Design Approval Status filter (multi-select)
      if (filterDesignApprovalStatuses.length > 0 && !filterDesignApprovalStatuses.includes(p.layoutStatus || '')) return false;

      // Search filter - search by project name (includes PROJ number) and location
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const name = (p.name || '').toLowerCase();
        const location = (p.pbLocation || '').toLowerCase();
        const projMatch = name.includes(query) || location.includes(query);
        if (!projMatch) return false;
      }

      return true;
    });
  }, [projects, filterLocations, filterStages, filterDesignStatuses, filterDesignApprovalStatuses, searchQuery, isInDesignPhase]);

  const stats = useMemo(() => {
    const today = new Date();
    const inDesignStage = filteredProjects.filter(p => p.stage === 'Design & Engineering');
    const designComplete = filteredProjects.filter(p => p.designCompletionDate && !p.designApprovalDate);
    const designApproved = filteredProjects.filter(p => p.designApprovalDate);

    // Calculate design status breakdown
    const designStatusStats: Record<string, number> = {};
    const designApprovalStatusStats: Record<string, number> = {};

    filteredProjects.forEach(p => {
      if (p.designStatus) {
        designStatusStats[p.designStatus] = (designStatusStats[p.designStatus] || 0) + 1;
      }
      if (p.layoutStatus) {
        designApprovalStatusStats[p.layoutStatus] = (designApprovalStatusStats[p.layoutStatus] || 0) + 1;
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
      designApproved,
      designStatusStats,
      designApprovalStatusStats,
      avgDaysInDesign,
      avgDesignTurnaround,
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

  // Get design statuses that exist in the data (for showing in groups)
  const existingDesignStatuses = useMemo(() =>
    new Set(projects.map(p => (p as ExtendedProject).designStatus).filter(Boolean)),
    [projects]
  );

  const existingDesignApprovalStatuses = useMemo(() =>
    new Set(projects.map(p => (p as ExtendedProject).layoutStatus).filter(Boolean)),
    [projects]
  );

  // Filter groups to only include options that exist in the actual data
  // This ensures the dropdown shows proper grouping/labels while only including real values
  const filteredDesignStatusGroups = useMemo(() => {
    const knownValues = new Set(ALL_DESIGN_STATUS_OPTIONS.map(o => o.value));
    const uncategorized = [...existingDesignStatuses].filter(s => !knownValues.has(s as string));

    const filtered = DESIGN_STATUS_GROUPS.map(group => ({
      ...group,
      options: group.options?.filter(opt => existingDesignStatuses.has(opt.value)) || []
    })).filter(group => group.options && group.options.length > 0);

    // Add uncategorized values that exist in data but not in predefined groups
    if (uncategorized.length > 0) {
      filtered.push({
        name: "Other",
        options: uncategorized.map(status => ({ value: status as string, label: status as string }))
      });
    }

    return filtered;
  }, [existingDesignStatuses]);

  const filteredDesignApprovalGroups = useMemo(() => {
    const knownValues = new Set(ALL_DESIGN_APPROVAL_OPTIONS.map(o => o.value));
    const uncategorized = [...existingDesignApprovalStatuses].filter(s => !knownValues.has(s as string));

    const filtered = DESIGN_APPROVAL_GROUPS.map(group => ({
      ...group,
      options: group.options?.filter(opt => existingDesignApprovalStatuses.has(opt.value)) || []
    })).filter(group => group.options && group.options.length > 0);

    // Add uncategorized values that exist in data but not in predefined groups
    if (uncategorized.length > 0) {
      filtered.push({
        name: "Other",
        options: uncategorized.map(status => ({ value: status as string, label: status as string }))
      });
    }

    return filtered;
  }, [existingDesignApprovalStatuses]);

  // Flatten filtered groups to get all options for the filter component
  const filteredDesignStatusOptions = useMemo(() =>
    filteredDesignStatusGroups.flatMap(g => g.options || []),
    [filteredDesignStatusGroups]
  );

  const filteredDesignApprovalOptions = useMemo(() =>
    filteredDesignApprovalGroups.flatMap(g => g.options || []),
    [filteredDesignApprovalGroups]
  );

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
    if (lower.includes('complete') || lower.includes('approved') || lower.includes('done')) return 'bg-green-500/20 text-green-400';
    if (lower.includes('progress') || lower.includes('review') || lower.includes('stamping')) return 'bg-yellow-500/20 text-yellow-400';
    if (lower.includes('revision') || lower.includes('rejected')) return 'bg-orange-500/20 text-orange-400';
    if (lower.includes('clarification') || lower.includes('pending')) return 'bg-blue-500/20 text-blue-400';
    if (lower.includes('hold') || lower.includes('archived')) return 'bg-zinc-500/20 text-zinc-400';
    return 'bg-indigo-500/20 text-indigo-400';
  };

  const getDesignApprovalStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-zinc-400';
    const lower = status.toLowerCase();
    if (lower.includes('approved')) return 'bg-emerald-500/20 text-emerald-400';
    if (lower.includes('rejected')) return 'bg-red-500/20 text-red-400';
    if (lower.includes('review') || lower.includes('draft')) return 'bg-blue-500/20 text-blue-400';
    if (lower.includes('sent') || lower.includes('resent')) return 'bg-cyan-500/20 text-cyan-400';
    if (lower.includes('revision')) return 'bg-orange-500/20 text-orange-400';
    if (lower.includes('pending') || lower.includes('clarification')) return 'bg-yellow-500/20 text-yellow-400';
    return 'bg-zinc-500/20 text-zinc-400';
  };

  const clearAllFilters = () => {
    setFilterLocations([]);
    setFilterStages([]);
    setFilterDesignStatuses([]);
    setFilterDesignApprovalStatuses([]);
    setSearchQuery("");
  };

  const hasActiveFilters = filterLocations.length > 0 || filterStages.length > 0 ||
    filterDesignStatuses.length > 0 || filterDesignApprovalStatuses.length > 0 || searchQuery;

  return (
    <DashboardShell title="Design & Engineering" accentColor="indigo">
      {/* Search and Filters */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Search Bar */}
        <div className="flex items-center gap-3">
          <ProjectSearchBar
            onSearch={setSearchQuery}
            placeholder="Search by PROJ #, name, or address..."
          />
          <button onClick={fetchData} className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
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
            accentColor="indigo"
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
            label="Design Status"
            options={filteredDesignStatusOptions}
            groups={filteredDesignStatusGroups}
            selected={filterDesignStatuses}
            onChange={setFilterDesignStatuses}
            placeholder="All Statuses"
            accentColor="purple"
          />
          <MultiSelectFilter
            label="Design Approval"
            options={filteredDesignApprovalOptions}
            groups={filteredDesignApprovalGroups}
            selected={filterDesignApprovalStatuses}
            onChange={setFilterDesignApprovalStatuses}
            placeholder="All Statuses"
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
          <div className="text-2xl font-bold text-green-400">{stats.designApproved.length}</div>
          <div className="text-sm text-zinc-400">Design Approved</div>
          <div className="text-xs text-zinc-500">{formatMoney(stats.designApproved.reduce((s, p) => s + (p.amount || 0), 0))}</div>
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
          <div className="text-2xl font-bold text-pink-400">{Object.keys(stats.designApprovalStatusStats).length}</div>
          <div className="text-sm text-zinc-400">Approval Statuses</div>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Design Status Breakdown */}
        <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-4">
          <h2 className="text-lg font-semibold mb-4 text-indigo-400">By Design Status</h2>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {Object.keys(stats.designStatusStats).length === 0 ? (
              <p className="text-zinc-500 text-sm">No design status data available</p>
            ) : (
              Object.entries(stats.designStatusStats)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div
                    key={status}
                    className={`flex items-center justify-between p-2 bg-zinc-800/50 rounded-lg cursor-pointer hover:bg-zinc-800 transition-colors ${
                      filterDesignStatuses.includes(status) ? 'ring-1 ring-indigo-500' : ''
                    }`}
                    onClick={() => {
                      if (filterDesignStatuses.includes(status)) {
                        setFilterDesignStatuses(filterDesignStatuses.filter(s => s !== status));
                      } else {
                        setFilterDesignStatuses([...filterDesignStatuses, status]);
                      }
                    }}
                  >
                    <span className="text-sm text-zinc-300">{getDisplayName(status)}</span>
                    <span className="text-lg font-bold text-indigo-400">{count}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* Design Approval Status Breakdown */}
        <div className="bg-[#12121a] rounded-xl border border-zinc-800 p-4">
          <h2 className="text-lg font-semibold mb-4 text-purple-400">By Design Approval Status</h2>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {Object.keys(stats.designApprovalStatusStats).length === 0 ? (
              <p className="text-zinc-500 text-sm">No design approval status data available</p>
            ) : (
              Object.entries(stats.designApprovalStatusStats)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div
                    key={status}
                    className={`flex items-center justify-between p-2 bg-zinc-800/50 rounded-lg cursor-pointer hover:bg-zinc-800 transition-colors ${
                      filterDesignApprovalStatuses.includes(status) ? 'ring-1 ring-purple-500' : ''
                    }`}
                    onClick={() => {
                      if (filterDesignApprovalStatuses.includes(status)) {
                        setFilterDesignApprovalStatuses(filterDesignApprovalStatuses.filter(s => s !== status));
                      } else {
                        setFilterDesignApprovalStatuses([...filterDesignApprovalStatuses, status]);
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

      {/* Projects Table */}
      <div className="bg-[#12121a] rounded-xl border border-zinc-800 overflow-hidden">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projects ({filteredProjects.length})</h2>
          {hasActiveFilters && (
            <span className="text-xs text-zinc-500">Filtered from {projects.filter(isInDesignPhase).length} total</span>
          )}
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
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getDesignApprovalStatusColor(project.layoutStatus)}`}>
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
