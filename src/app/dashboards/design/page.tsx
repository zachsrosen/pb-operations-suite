"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { MultiSelectFilter, ProjectSearchBar, FilterGroup } from "@/components/ui/MultiSelectFilter";
import { MonthlyBarChart, aggregateMonthly } from "@/components/ui/MonthlyBarChart";
import { useActivityTracking } from "@/hooks/useActivityTracking";

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

interface FullEquipment {
  modules: { brand: string; model: string; count: number; wattage: number };
  inverter: { brand: string; model: string; count: number; sizeKwac: number };
  battery: { brand: string; model: string; count: number; sizeKwh: number; expansionCount: number };
  evCount: number;
  systemSizeKwdc: number;
  systemSizeKwac: number;
}

interface ExtendedProject extends RawProject {
  designStatus?: string;
  layoutStatus?: string; // This is Design Approval Status in HubSpot
  designCompletionDate?: string;
  designApprovalDate?: string;
  tags?: string[];
  equipment?: FullEquipment | RawProject["equipment"];
}

// ============== CLIPPING DETECTION ENGINE ==============
// Seasonal TSRF decomposition: when shade data is unavailable (EVTD-only designs),
// the annual-average TSRF suppresses summer peaks. This decomposes TSRF into a
// seasonal curve so we can estimate true summer peak DC/AC ratio and flag clipping.

interface ClippingAnalysis {
  projectName: string;
  projectId: string;
  projectUrl?: string;
  panelCount: number;
  panelWattage: number;
  dcCapacityKw: number;
  inverterCount: number;
  acCapacityKw: number;
  nameplateDcAcRatio: number;
  estimatedSummerDcAcRatio: number;
  estimatedSummerTsrf: number;
  avgTsrf: number;
  batteryCount: number;
  batteryKwh: number;
  riskLevel: "none" | "low" | "moderate" | "high";
  stage: string;
  designStatus?: string;
}

const DEFAULT_TSRF = 0.84; // Default annual avg TSRF when not known (typical residential)
const SHADE_SWING_FACTOR = 0.65; // Fraction of shade loss recovered in summer

function getSeasonalTSRF(annualTsrf: number): number {
  if (annualTsrf >= 1.0) return annualTsrf;
  const B = SHADE_SWING_FACTOR * (1.0 - annualTsrf);
  const correctedBase = annualTsrf - 0.15 * B;
  // Summer solstice (day 172): sin((172-80)/365 * 2*PI) ≈ 1.0
  return Math.min(1.0, correctedBase + B);
}

function analyzeClipping(project: ExtendedProject): ClippingAnalysis | null {
  const eq = project.equipment as FullEquipment | undefined;
  if (!eq) return null;

  const panelCount = eq.modules?.count || 0;
  const panelWattage = eq.modules?.wattage || 0;
  const inverterCount = eq.inverter?.count || 0;
  const inverterSizeKwac = eq.inverter?.sizeKwac || 0;

  // Need both DC and AC data to analyze
  const dcCapacityKw = eq.systemSizeKwdc || (panelCount * panelWattage / 1000);
  const acCapacityKw = eq.systemSizeKwac || (inverterCount * inverterSizeKwac);

  if (dcCapacityKw <= 0 || acCapacityKw <= 0) return null;

  const nameplateDcAcRatio = dcCapacityKw / acCapacityKw;
  const avgTsrf = DEFAULT_TSRF; // No per-project TSRF from HubSpot; use typical residential
  const summerTsrf = getSeasonalTSRF(avgTsrf);
  const estimatedSummerDcAcRatio = (dcCapacityKw * summerTsrf) / acCapacityKw;

  const batteryCount = eq.battery?.count || 0;
  const batteryKwh = batteryCount * (eq.battery?.sizeKwh || 0);

  // Risk classification
  let riskLevel: ClippingAnalysis["riskLevel"] = "none";
  if (nameplateDcAcRatio > 1.5) {
    riskLevel = "high";
  } else if (estimatedSummerDcAcRatio > 1.15 || nameplateDcAcRatio > 1.3) {
    riskLevel = "moderate";
  } else if (estimatedSummerDcAcRatio > 1.0 || nameplateDcAcRatio > 1.15) {
    riskLevel = "low";
  }

  // Battery can absorb some DC excess — reduce risk if battery present
  if (riskLevel !== "none" && batteryKwh > 0) {
    // DC-coupled battery (e.g., PW3) can absorb ~5kW DC excess
    // If battery present and ratio is only slightly over, downgrade risk
    if (riskLevel === "low") riskLevel = "none";
    else if (riskLevel === "moderate" && nameplateDcAcRatio < 1.4) riskLevel = "low";
  }

  return {
    projectName: project.name,
    projectId: project.id,
    projectUrl: project.url,
    panelCount,
    panelWattage,
    dcCapacityKw,
    inverterCount,
    acCapacityKw,
    nameplateDcAcRatio,
    estimatedSummerDcAcRatio,
    estimatedSummerTsrf: summerTsrf,
    avgTsrf,
    batteryCount,
    batteryKwh,
    riskLevel,
    stage: project.stage,
    designStatus: project.designStatus,
  };
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
      { value: "DA Approved", label: "DA Approved - Final Design Review" },
    ]
  },
  {
    name: "Engineering & Completion",
    options: [
      { value: "Submitted To Engineering", label: "Submitted To Engineering" },
      { value: "Design Complete", label: "Design Complete" },
    ]
  },
  {
    name: "Revisions - DA",
    options: [
      { value: "Revision Needed - DA Rejected", label: "Revision Needed - DA Rejected" },
      { value: "DA Revision In Progress", label: "DA Revision In Progress" },
      { value: "DA Revision Completed", label: "DA Revision Completed" },
    ]
  },
  {
    name: "Revisions - Permit",
    options: [
      { value: "Revision Needed - Rejected by AHJ", label: "Revision Needed - Rejected by AHJ" },
      { value: "Permit Revision In Progress", label: "Permit Revision In Progress" },
      { value: "Permit Revision Completed", label: "Permit Revision Completed" },
    ]
  },
  {
    name: "Revisions - Utility",
    options: [
      { value: "Revision Needed - Rejected by Utility", label: "Revision Needed - Rejected by Utility" },
      { value: "Utility Revision In Progress", label: "Utility Revision In Progress" },
      { value: "Utility Revision Completed", label: "Utility Revision Completed" },
    ]
  },
  {
    name: "Revisions - As-Built",
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
    name: "Ready",
    options: [
      { value: "Ready", label: "Ready" },
      { value: "Ready For Review", label: "Ready For Review" },
      { value: "Draft Created", label: "Draft Created" },
    ]
  },
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
      { value: "Sent to Customer", label: "Sent to Customer" },
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
  /* ---- activity tracking ---- */
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

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

  /* ---- Track dashboard view on load ---- */
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("design", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

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
      .map(p => Math.floor((today.getTime() - new Date(p.closeDate! + "T12:00:00").getTime()) / (1000 * 60 * 60 * 24)));
    const avgDaysInDesign = daysInDesign.length > 0
      ? Math.round(daysInDesign.reduce((a, b) => a + b, 0) / daysInDesign.length)
      : 0;

    // Calculate average design turnaround
    const designTurnaroundDays = filteredProjects
      .filter(p => p.closeDate && p.designCompletionDate)
      .map(p => {
        const d1 = new Date(p.closeDate! + "T12:00:00");
        const d2 = new Date(p.designCompletionDate! + "T12:00:00");
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

  // Clipping analysis across all projects with equipment data
  const clippingAnalyses = useMemo(() => {
    const analyses = filteredProjects
      .map(p => analyzeClipping(p))
      .filter((a): a is ClippingAnalysis => a !== null);

    const atRisk = analyses.filter(a => a.riskLevel !== "none");
    const high = analyses.filter(a => a.riskLevel === "high");
    const moderate = analyses.filter(a => a.riskLevel === "moderate");
    const low = analyses.filter(a => a.riskLevel === "low");
    const withBattery = atRisk.filter(a => a.batteryKwh > 0);

    return { all: analyses, atRisk, high, moderate, low, withBattery };
  }, [filteredProjects]);

  const [showClippingTool, setShowClippingTool] = useState(false);

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
            <p className="text-muted">Loading Design & Engineering Data...</p>
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
            <p className="text-sm text-muted">{error}</p>
            <button onClick={fetchData} className="mt-4 px-4 py-2 bg-indigo-600 rounded-lg hover:bg-indigo-700">
              Retry
            </button>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const getDesignStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-muted';
    const lower = status.toLowerCase();
    if (lower.includes('complete') || lower.includes('approved') || lower.includes('done')) return 'bg-green-500/20 text-green-400';
    if (lower.includes('progress') || lower.includes('review') || lower.includes('stamping')) return 'bg-yellow-500/20 text-yellow-400';
    if (lower.includes('revision') || lower.includes('rejected')) return 'bg-orange-500/20 text-orange-400';
    if (lower.includes('clarification') || lower.includes('pending')) return 'bg-blue-500/20 text-blue-400';
    if (lower.includes('hold') || lower.includes('archived')) return 'bg-zinc-500/20 text-muted';
    return 'bg-indigo-500/20 text-indigo-400';
  };

  const getDesignApprovalStatusColor = (status: string | undefined): string => {
    if (!status) return 'bg-zinc-500/20 text-muted';
    const lower = status.toLowerCase();
    if (lower.includes('approved')) return 'bg-emerald-500/20 text-emerald-400';
    if (lower.includes('rejected')) return 'bg-red-500/20 text-red-400';
    if (lower.includes('review') || lower.includes('draft')) return 'bg-blue-500/20 text-blue-400';
    if (lower.includes('sent') || lower.includes('resent')) return 'bg-cyan-500/20 text-cyan-400';
    if (lower.includes('revision')) return 'bg-orange-500/20 text-orange-400';
    if (lower.includes('pending') || lower.includes('clarification')) return 'bg-yellow-500/20 text-yellow-400';
    return 'bg-zinc-500/20 text-muted';
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
          <div className="text-2xl font-bold text-indigo-400">{stats.total}</div>
          <div className="text-sm text-muted">Total Projects</div>
          <div className="text-xs text-muted">{formatMoney(stats.totalValue)}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-yellow-400">{stats.inDesignStage.length}</div>
          <div className="text-sm text-muted">In Design Stage</div>
          <div className="text-xs text-muted">{formatMoney(stats.inDesignStage.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-blue-400">{stats.designComplete.length}</div>
          <div className="text-sm text-muted">Design Complete</div>
          <div className="text-xs text-muted">Awaiting approval</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-green-400">{stats.designApproved.length}</div>
          <div className="text-sm text-muted">Design Approved</div>
          <div className="text-xs text-muted">{formatMoney(stats.designApproved.reduce((s, p) => s + (p.amount || 0), 0))}</div>
        </div>
      </div>

      {/* Timing Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-cyan-400">{stats.avgDaysInDesign}d</div>
          <div className="text-sm text-muted">Avg Days in Design</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-purple-400">{stats.avgDesignTurnaround}d</div>
          <div className="text-sm text-muted">Avg Design Turnaround</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-amber-400">{Object.keys(stats.designStatusStats).length}</div>
          <div className="text-sm text-muted">Design Statuses</div>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-t-border">
          <div className="text-2xl font-bold text-pink-400">{Object.keys(stats.designApprovalStatusStats).length}</div>
          <div className="text-sm text-muted">Approval Statuses</div>
        </div>
      </div>

      {/* Design Completions by Month */}
      {!loading && (stats.designApproved.length > 0 || filteredProjects.some(p => p.designCompletionDate)) && (
        <div className="mb-6">
          <MonthlyBarChart
            title="Design Completions by Month"
            data={aggregateMonthly(
              stats.designApproved.map(p => ({ date: p.designApprovalDate, amount: p.amount })),
              6,
            )}
            secondaryData={aggregateMonthly(
              filteredProjects
                .filter(p => p.designCompletionDate)
                .map(p => ({ date: p.designCompletionDate, amount: p.amount })),
              6,
            )}
            accentColor="blue"
            primaryLabel="DA Approved"
            secondaryLabel="Design Complete"
          />
        </div>
      )}

      {/* Status Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Design Status Breakdown */}
        <div className="bg-surface rounded-xl border border-t-border p-4">
          <h2 className="text-lg font-semibold mb-4 text-indigo-400">By Design Status</h2>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {Object.keys(stats.designStatusStats).length === 0 ? (
              <p className="text-muted text-sm">No design status data available</p>
            ) : (
              Object.entries(stats.designStatusStats)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div
                    key={status}
                    className={`flex items-center justify-between p-2 bg-skeleton rounded-lg cursor-pointer hover:bg-surface-2 transition-colors ${
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
                    <span className="text-sm text-foreground/80">{getDisplayName(status)}</span>
                    <span className="text-lg font-bold text-indigo-400">{count}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* Design Approval Status Breakdown */}
        <div className="bg-surface rounded-xl border border-t-border p-4">
          <h2 className="text-lg font-semibold mb-4 text-purple-400">By Design Approval Status</h2>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {Object.keys(stats.designApprovalStatusStats).length === 0 ? (
              <p className="text-muted text-sm">No design approval status data available</p>
            ) : (
              Object.entries(stats.designApprovalStatusStats)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div
                    key={status}
                    className={`flex items-center justify-between p-2 bg-skeleton rounded-lg cursor-pointer hover:bg-surface-2 transition-colors ${
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
                    <span className="text-sm text-foreground/80">{getDisplayName(status)}</span>
                    <span className="text-lg font-bold text-purple-400">{count}</span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* Clipping Detection Tool */}
      <div className="bg-surface rounded-xl border border-t-border mb-6 overflow-hidden">
        <button
          onClick={() => setShowClippingTool(!showClippingTool)}
          className="w-full p-4 flex items-center justify-between hover:bg-surface/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-amber-400">Clipping Detection</h2>
            <span className="text-xs text-muted">Seasonal TSRF Decomposition</span>
            {clippingAnalyses.atRisk.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400">
                {clippingAnalyses.atRisk.length} at risk
              </span>
            )}
          </div>
          <svg
            className={`w-5 h-5 text-muted transition-transform ${showClippingTool ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showClippingTool && (
          <div className="p-4 border-t border-t-border">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <div className="bg-surface/50 rounded-lg p-3 border border-t-border/50">
                <div className="text-xl font-bold text-foreground/80">{clippingAnalyses.all.length}</div>
                <div className="text-xs text-muted">Analyzed</div>
              </div>
              <div className="bg-surface/50 rounded-lg p-3 border border-red-500/20">
                <div className="text-xl font-bold text-red-400">{clippingAnalyses.high.length}</div>
                <div className="text-xs text-muted">High Risk</div>
              </div>
              <div className="bg-surface/50 rounded-lg p-3 border border-amber-500/20">
                <div className="text-xl font-bold text-amber-400">{clippingAnalyses.moderate.length}</div>
                <div className="text-xs text-muted">Moderate Risk</div>
              </div>
              <div className="bg-surface/50 rounded-lg p-3 border border-yellow-500/20">
                <div className="text-xl font-bold text-yellow-400">{clippingAnalyses.low.length}</div>
                <div className="text-xs text-muted">Low Risk</div>
              </div>
              <div className="bg-surface/50 rounded-lg p-3 border border-cyan-500/20">
                <div className="text-xl font-bold text-cyan-400">{clippingAnalyses.withBattery.length}</div>
                <div className="text-xs text-muted">Battery Mitigated</div>
              </div>
            </div>

            {/* Explanation */}
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 mb-4">
              <p className="text-xs text-muted leading-relaxed">
                <span className="text-amber-400 font-medium">How it works:</span> Without EVIA 30-min shade profiles,
                annual-average TSRF suppresses summer peaks. This tool decomposes TSRF seasonally — summer TSRF is ~{Math.round(getSeasonalTSRF(DEFAULT_TSRF) * 100)}%
                vs annual avg ~{Math.round(DEFAULT_TSRF * 100)}% — revealing systems where summer DC output exceeds inverter AC capacity.
                Projects flagged here may clip in summer even if the EVTD interface reports acceptable ratios.
                DC-coupled batteries (PW3) can absorb ~5kW DC excess before true clipping occurs.
              </p>
            </div>

            {/* At-Risk Projects Table */}
            {clippingAnalyses.atRisk.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-surface/80">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase">Project</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase">Equipment</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-muted uppercase">DC kW</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-muted uppercase">AC kW</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-muted uppercase">Nameplate DC/AC</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-muted uppercase">Summer DC/AC</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-muted uppercase">Battery</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-muted uppercase">Risk</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-t-border/50">
                    {clippingAnalyses.atRisk
                      .sort((a, b) => b.nameplateDcAcRatio - a.nameplateDcAcRatio)
                      .map(analysis => {
                        const riskColors = {
                          high: "bg-red-500/20 text-red-400 border-red-500/30",
                          moderate: "bg-amber-500/20 text-amber-400 border-amber-500/30",
                          low: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
                          none: "bg-green-500/20 text-green-400 border-green-500/30",
                        };
                        return (
                          <tr key={analysis.projectId} className="hover:bg-surface/30">
                            <td className="px-3 py-2">
                              <a
                                href={analysis.projectUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-foreground hover:text-amber-400"
                              >
                                {analysis.projectName.split('|')[0].trim()}
                              </a>
                              <div className="text-xs text-muted">{analysis.stage}</div>
                            </td>
                            <td className="px-3 py-2 text-xs text-muted">
                              {analysis.panelCount}x {analysis.panelWattage}W
                              <div className="text-muted">{analysis.inverterCount}x inv</div>
                            </td>
                            <td className="px-3 py-2 text-center text-sm font-mono text-foreground/80">
                              {analysis.dcCapacityKw.toFixed(1)}
                            </td>
                            <td className="px-3 py-2 text-center text-sm font-mono text-foreground/80">
                              {analysis.acCapacityKw.toFixed(1)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className={`text-sm font-mono font-bold ${
                                analysis.nameplateDcAcRatio > 1.3 ? 'text-red-400' :
                                analysis.nameplateDcAcRatio > 1.15 ? 'text-amber-400' :
                                analysis.nameplateDcAcRatio > 1.0 ? 'text-yellow-400' : 'text-green-400'
                              }`}>
                                {analysis.nameplateDcAcRatio.toFixed(2)}
                              </span>
                              <div className="text-[10px] text-muted">{(analysis.nameplateDcAcRatio * 100).toFixed(0)}%</div>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className={`text-sm font-mono font-bold ${
                                analysis.estimatedSummerDcAcRatio > 1.15 ? 'text-red-400' :
                                analysis.estimatedSummerDcAcRatio > 1.0 ? 'text-amber-400' : 'text-green-400'
                              }`}>
                                {analysis.estimatedSummerDcAcRatio.toFixed(2)}
                              </span>
                              <div className="text-[10px] text-muted">~{Math.round(analysis.estimatedSummerTsrf * 100)}% TSRF</div>
                            </td>
                            <td className="px-3 py-2 text-center text-xs">
                              {analysis.batteryKwh > 0 ? (
                                <span className="text-cyan-400">{analysis.batteryKwh.toFixed(0)} kWh</span>
                              ) : (
                                <span className="text-muted/70">None</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${riskColors[analysis.riskLevel]}`}>
                                {analysis.riskLevel}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-6 text-muted text-sm">
                {clippingAnalyses.all.length === 0
                  ? "No projects with equipment data available for clipping analysis"
                  : "No clipping risk detected across analyzed projects"}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Projects Table */}
      <div className="bg-surface rounded-xl border border-t-border overflow-hidden">
        <div className="p-4 border-b border-t-border flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projects ({filteredProjects.length})</h2>
          {hasActiveFilters && (
            <span className="text-xs text-muted">Filtered from {projects.filter(isInDesignPhase).length} total</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Project</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Stage</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Design Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Design Approval</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Design Complete</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Design Approved</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Tags</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-muted uppercase">DC/AC</th>
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
                    if (a.stage === 'Design & Engineering' && b.stage !== 'Design & Engineering') return -1;
                    if (a.stage !== 'Design & Engineering' && b.stage === 'Design & Engineering') return 1;
                    return (b.amount || 0) - (a.amount || 0);
                  })
                  .slice(0, 100)
                  .map(project => (
                    <tr key={project.id} className="hover:bg-surface/50">
                      <td className="px-4 py-3">
                        <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-indigo-400">
                          {project.name.split('|')[0].trim()}
                        </a>
                        <div className="text-xs text-muted">{project.name.split('|')[1]?.trim() || ''}</div>
                        <div className="text-xs text-muted">{project.pbLocation}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">{project.stage}</td>
                      <td className="px-4 py-3">
                        {project.designStatus ? (
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getDesignStatusColor(project.designStatus)}`}>
                            {getDisplayName(project.designStatus)}
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {project.layoutStatus ? (
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getDesignApprovalStatusColor(project.layoutStatus)}`}>
                            {getDisplayName(project.layoutStatus)}
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-sm ${project.designCompletionDate ? 'text-green-400' : 'text-muted'}`}>
                        {project.designCompletionDate || '-'}
                      </td>
                      <td className={`px-4 py-3 text-sm ${project.designApprovalDate ? 'text-emerald-400' : 'text-muted'}`}>
                        {project.designApprovalDate || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground/80">
                        {project.projectType || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {project.tags && project.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {project.tags.map((tag, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.65rem] font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/20"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {(() => {
                          const clip = analyzeClipping(project);
                          if (!clip) return <span className="text-muted/70 text-xs">-</span>;
                          const colors = {
                            high: "text-red-400",
                            moderate: "text-amber-400",
                            low: "text-yellow-400",
                            none: "text-green-400",
                          };
                          return (
                            <span className={`text-xs font-mono font-medium ${colors[clip.riskLevel]}`} title={`DC: ${clip.dcCapacityKw.toFixed(1)}kW / AC: ${clip.acCapacityKw.toFixed(1)}kW | Summer est: ${clip.estimatedSummerDcAcRatio.toFixed(2)}`}>
                              {clip.nameplateDcAcRatio.toFixed(2)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-sm ${(project.amount || 0) > 0 ? 'text-green-400' : 'text-muted'}`}>
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
