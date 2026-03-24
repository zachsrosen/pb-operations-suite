"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { MultiSelectFilter, ProjectSearchBar, FilterGroup } from "@/components/ui/MultiSelectFilter";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useProjectData } from "@/hooks/useProjectData";
import { useQuery } from "@tanstack/react-query";
import { useSort, sortRows } from "@/hooks/useSort";
import { SortHeader } from "@/components/ui/SortHeader";
import { DealLinks } from "@/components/ui/DealLinks";
import { fmtAmount, fmtDateShort } from "@/lib/format-helpers";
import { StatCard } from "@/components/ui/MetricCard";
import { StatusPillRow } from "@/components/ui/StatusPillRow";

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

type InstallReviewFindingStatus = "pass" | "fail" | "unable_to_verify";

type InstallReviewFinding = {
  category: string;
  status: InstallReviewFindingStatus;
  planset_spec: string;
  observed: string;
  notes: string;
};

type InstallReviewResult = {
  overall_pass: boolean;
  summary: string;
  findings: InstallReviewFinding[];
  photo_count: number;
  planset_filename: string;
  duration_ms: number;
  photo_source?: string;
};

function getProjectDisplayName(name: string | undefined): string {
  return (name || "").split("|")[0]?.trim() || "Unknown Project";
}

function getDisplayName(value: string | undefined): string {
  if (!value) return value || '';
  const key = value.toLowerCase().replace(/[\s-]+/g, '_');
  return DISPLAY_NAMES[key] || value;
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

  const { data: projects, loading, error, refetch, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = useMemo(() => projects ?? [], [projects]);

  const { data: pipelineData, refetch: refetchPipeline } = useQuery({
    queryKey: ["inspection-pipeline"],
    queryFn: async () => {
      const res = await fetch("/api/hubspot/inspection-metrics?scope=pipeline");
      if (!res.ok) throw new Error("Failed to fetch pipeline data");
      return res.json() as Promise<{
        outstandingFailed: Array<{
          dealId: string; projectNumber: string; name: string; url: string;
          pbLocation: string; ahj: string; stage: string; amount: number;
          inspectionFailDate: string | null; inspectionFailCount: number | null;
          inspectionFailureReason: string | null; daysSinceLastFail: number | null;
          constructionCompleteDate: string | null; daysSinceCc: number | null;
          inspectionScheduleDate: string | null; inspectionBookedDate: string | null;
          readyForInspection: string | null; zuperJobUid: string | null;
        }>;
        ccPendingInspection: Array<{
          dealId: string; projectNumber: string; name: string; url: string;
          pbLocation: string; ahj: string; stage: string; amount: number;
          constructionCompleteDate: string | null; daysSinceCc: number | null;
          inspectionScheduleDate: string | null; inspectionBookedDate: string | null;
          readyForInspection: string | null; zuperJobUid: string | null;
          inspectionFailDate: string | null; inspectionFailCount: number | null;
          inspectionFailureReason: string | null; daysSinceLastFail: number | null;
        }>;
      }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Multi-select filters
  const [filterAhjs, setFilterAhjs] = useState<string[]>([]);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterInspectionStatuses, setFilterInspectionStatuses] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Install Photo Review state
  const [photoReviewOpen, setPhotoReviewOpen] = useState(false);
  const [photoReviewDealId, setPhotoReviewDealId] = useState<string | null>(null);
  const [photoReviewDealName, setPhotoReviewDealName] = useState("");
  const [photoReviewLoading, setPhotoReviewLoading] = useState(false);
  const [photoReviewResult, setPhotoReviewResult] = useState<InstallReviewResult | null>(null);
  const [photoReviewError, setPhotoReviewError] = useState<string | null>(null);
  const [photoReviewProjectSearch, setPhotoReviewProjectSearch] = useState("");
  const [photoReviewStatusFilter, setPhotoReviewStatusFilter] = useState<"all" | InstallReviewFindingStatus>("all");
  const photoReviewRequestId = useRef(0);

  const resetPhotoReview = () => {
    photoReviewRequestId.current += 1;
    setPhotoReviewDealId(null);
    setPhotoReviewDealName("");
    setPhotoReviewLoading(false);
    setPhotoReviewResult(null);
    setPhotoReviewError(null);
    setPhotoReviewStatusFilter("all");
  };

  const runPhotoReview = async (dealId: string, dealName: string) => {
    const requestId = ++photoReviewRequestId.current;
    setPhotoReviewDealId(dealId);
    setPhotoReviewDealName(dealName);
    setPhotoReviewOpen(true);
    setPhotoReviewLoading(true);
    setPhotoReviewResult(null);
    setPhotoReviewError(null);
    setPhotoReviewStatusFilter("all");

    try {
      const res = await fetch("/api/install-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId }),
      });
      // Stale response — user already started a new review
      if (requestId !== photoReviewRequestId.current) return;
      const data = await res.json();
      if (!res.ok) {
        setPhotoReviewError(data.error || `Request failed (${res.status})`);
        if (data.details) setPhotoReviewError(`${data.error}: ${data.details}`);
      } else {
        setPhotoReviewResult(data);
      }
    } catch (err) {
      if (requestId !== photoReviewRequestId.current) return;
      setPhotoReviewError(err instanceof Error ? err.message : "Network error");
    } finally {
      if (requestId === photoReviewRequestId.current) {
        setPhotoReviewLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("inspections", {
        projectCount: safeProjects.length,
      });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  const filteredProjects = useMemo(() => {
    return safeProjects.filter(p => {
      // Only include projects in the Inspection stage
      if (p.stage !== 'Inspection') return false;
      // Exclude passed inspections (have pass date)
      if (p.inspectionPassDate) return false;

      if (filterAhjs.length > 0 && !filterAhjs.includes(p.ahj || '')) return false;
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || '')) return false;
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
  }, [safeProjects, filterAhjs, filterLocations, filterInspectionStatuses, searchQuery]);

  const filteredFailed = useMemo(() => {
    if (!pipelineData?.outstandingFailed) return [];
    return pipelineData.outstandingFailed.filter((r) => {
      if (filterLocations.length > 0 && !filterLocations.includes(r.pbLocation)) return false;
      if (filterAhjs.length > 0 && !filterAhjs.includes(r.ahj)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !(r.projectNumber || "").toLowerCase().includes(q) &&
          !(r.name || "").toLowerCase().includes(q) &&
          !(r.pbLocation || "").toLowerCase().includes(q) &&
          !(r.ahj || "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [pipelineData, filterLocations, filterAhjs, searchQuery]);

  const filteredPending = useMemo(() => {
    if (!pipelineData?.ccPendingInspection) return [];
    return pipelineData.ccPendingInspection
      .filter((r) => {
        if (filterLocations.length > 0 && !filterLocations.includes(r.pbLocation)) return false;
        if (filterAhjs.length > 0 && !filterAhjs.includes(r.ahj)) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          if (
            !(r.projectNumber || "").toLowerCase().includes(q) &&
            !(r.name || "").toLowerCase().includes(q) &&
            !(r.pbLocation || "").toLowerCase().includes(q) &&
            !(r.ahj || "").toLowerCase().includes(q)
          ) return false;
        }
        return true;
      })
      .map((r) => ({ ...r, readyForInspection: !!r.readyForInspection }));
  }, [pipelineData, filterLocations, filterAhjs, searchQuery]);

  const failedSort = useSort("daysSinceLastFail", "desc");
  const pendingSort = useSort("daysSinceCc", "desc");

  const photoReviewCandidates = useMemo(() => {
    const query = photoReviewProjectSearch.trim().toLowerCase();
    return filteredProjects
      .filter((p) => {
        const status = (p.finalInspectionStatus || "").toLowerCase();
        return p.stage === "Inspection" || status.includes("scheduled") || status.includes("ready");
      })
      .filter((p) => {
        if (!query) return true;
        const name = getProjectDisplayName(p.name).toLowerCase();
        const projectId = (p.id || "").toLowerCase();
        const location = (p.pbLocation || "").toLowerCase();
        const ahj = (p.ahj || "").toLowerCase();
        return (
          name.includes(query) ||
          projectId.includes(query) ||
          location.includes(query) ||
          ahj.includes(query)
        );
      })
      .sort((a, b) => {
        const aIsCurrent = photoReviewDealId === a.id ? 1 : 0;
        const bIsCurrent = photoReviewDealId === b.id ? 1 : 0;
        if (aIsCurrent !== bIsCurrent) return bIsCurrent - aIsCurrent;
        return (b.amount || 0) - (a.amount || 0);
      })
      .slice(0, 40);
  }, [filteredProjects, photoReviewProjectSearch, photoReviewDealId]);

  const photoReviewFindingCounts = useMemo(() => {
    const findings = photoReviewResult?.findings || [];
    return {
      all: findings.length,
      pass: findings.filter((f) => f.status === "pass").length,
      fail: findings.filter((f) => f.status === "fail").length,
      unable_to_verify: findings.filter((f) => f.status === "unable_to_verify").length,
    };
  }, [photoReviewResult]);

  const visiblePhotoReviewFindings = useMemo(() => {
    const findings = [...(photoReviewResult?.findings || [])];
    const rank: Record<InstallReviewFindingStatus, number> = {
      fail: 0,
      unable_to_verify: 1,
      pass: 2,
    };
    findings.sort((a, b) => {
      const rankDiff = rank[a.status] - rank[b.status];
      if (rankDiff !== 0) return rankDiff;
      return (a.category || "").localeCompare(b.category || "");
    });
    if (photoReviewStatusFilter === "all") return findings;
    return findings.filter((f) => f.status === photoReviewStatusFilter);
  }, [photoReviewResult, photoReviewStatusFilter]);

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

    const needsScheduling = filteredProjects.filter(
      p => p.stage === "Inspection" && !p.inspectionScheduleDate && !p.inspectionPassDate
    );

    return {
      total: filteredProjects.length,
      totalValue: filteredProjects.reduce((s, p) => s + (p.amount || 0), 0),
      inspectionPending,
      inspectionPassed,
      inspectionFailed,
      needsScheduling,
      avgDaysInInspection,
      avgTurnaround,
      passRate,
      inspectionStatusStats,
    };
  }, [filteredProjects]);

  // Cross-stage: projects with inspection scheduled but not yet passed.
  // Computed from safeProjects (all stages) with location/AHJ/search filters only.
  const inspectionScheduled = useMemo(() => {
    return safeProjects.filter(p => {
      if (!p.inspectionScheduleDate || p.inspectionPassDate) return false;
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || "")) return false;
      if (filterAhjs.length > 0 && !filterAhjs.includes(p.ahj || "")) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !(p.name || "").toLowerCase().includes(q) &&
          !(p.pbLocation || "").toLowerCase().includes(q) &&
          !(p.ahj || "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [safeProjects, filterLocations, filterAhjs, searchQuery]);

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


  const existingInspectionStatuses = useMemo(() =>
    new Set(safeProjects.map(p => (p as RawProject).finalInspectionStatus).filter(Boolean)),
    [safeProjects]
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
setFilterInspectionStatuses([]);
    setSearchQuery("");
  };

  const hasActiveFilters = filterAhjs.length > 0 || filterLocations.length > 0 ||
    filterInspectionStatuses.length > 0 || searchQuery;

  if (loading) {
    return (
      <DashboardShell title="Inspections Execution" accentColor="orange">
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
      <DashboardShell title="Inspections Execution" accentColor="orange">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center text-red-500">
            <p className="text-xl mb-2">Error loading data</p>
            <p className="text-sm text-muted">{error}</p>
            <button onClick={() => { refetch(); refetchPipeline(); }} className="mt-4 px-4 py-2 bg-orange-600 rounded-lg hover:bg-orange-700">
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
    <DashboardShell title="Inspections Execution" accentColor="orange" lastUpdated={lastUpdated}>
      {/* Search and Filters */}
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-center gap-3">
          <ProjectSearchBar
            onSearch={setSearchQuery}
            placeholder="Search by PROJ #, name, location, or AHJ..."
          />
          <button onClick={() => { refetch(); refetchPipeline(); }} className="bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-grid mb-6">
        <StatCard label="Total Projects" value={stats.total} subtitle={formatMoney(stats.totalValue)} color="orange" />
        <StatCard label="Needs Scheduling" value={stats.needsScheduling.length} subtitle={formatMoney(stats.needsScheduling.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))} color="cyan" />
        <StatCard label="Scheduled" value={inspectionScheduled.length} subtitle={formatMoney(inspectionScheduled.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))} color="yellow" />
        <StatCard label="Failed" value={stats.inspectionFailed.length} subtitle={formatMoney(stats.inspectionFailed.reduce((s: number, p: RawProject) => s + (p.amount || 0), 0))} color="red" />
      </div>

      {/* Status Pill Row */}
      <StatusPillRow
        stats={stats.inspectionStatusStats}
        selected={filterInspectionStatuses}
        onToggle={(status) => {
          if (filterInspectionStatuses.includes(status)) {
            setFilterInspectionStatuses(filterInspectionStatuses.filter(s => s !== status));
          } else {
            setFilterInspectionStatuses([...filterInspectionStatuses, status]);
          }
        }}
        getStatusColor={getInspectionStatusColor}
        getDisplayName={getDisplayName}
        accentColor="orange"
      />

      {/* Outstanding Failed Inspections */}
      {filteredFailed.length > 0 && (
        <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-6 border-l-4 border-l-red-500">
          <div className="px-5 py-4 border-b border-t-border">
            <h2 className="text-lg font-semibold text-foreground">Outstanding Failed Inspections</h2>
            <p className="text-sm text-muted mt-0.5">
              {filteredFailed.length} project{filteredFailed.length !== 1 ? "s" : ""} with failed inspection awaiting reinspection
            </p>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-t-border bg-surface-2/50">
                  <SortHeader compact label="Project" sortKey="projectNumber" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
                  <SortHeader compact label="Customer" sortKey="name" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
                  <SortHeader compact label="PB Location" sortKey="pbLocation" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
                  <SortHeader compact label="AHJ" sortKey="ahj" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
                  <SortHeader compact label="Stage" sortKey="stage" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
                  <SortHeader compact label="Amount" sortKey="amount" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} className="text-right" />
                  <SortHeader compact label="Fail Date" sortKey="inspectionFailDate" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
                  <SortHeader compact label="Fail Count" sortKey="inspectionFailCount" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} className="text-center" />
                  <SortHeader compact label="Failure Reason" sortKey="inspectionFailureReason" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} />
                  <SortHeader compact label="Days Since Fail" sortKey="daysSinceLastFail" currentKey={failedSort.sortKey} currentDir={failedSort.sortDir} onSort={failedSort.toggle} className="text-center" />
                  <th className="px-3 py-2 text-center text-xs font-medium text-muted">Links</th>
                </tr>
              </thead>
              <tbody>
                {sortRows(filteredFailed, failedSort.sortKey, failedSort.sortDir).map((row, i) => (
                  <tr key={row.dealId} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-3 py-2.5 font-mono text-foreground">{row.projectNumber}</td>
                    <td className="px-3 py-2.5 text-foreground truncate max-w-[180px]">{row.name}</td>
                    <td className="px-3 py-2.5 text-muted">{row.pbLocation}</td>
                    <td className="px-3 py-2.5 text-muted">{row.ahj}</td>
                    <td className="px-3 py-2.5 text-muted">{row.stage}</td>
                    <td className="px-3 py-2.5 text-right text-muted">{fmtAmount(row.amount)}</td>
                    <td className="px-3 py-2.5 text-muted">{fmtDateShort(row.inspectionFailDate)}</td>
                    <td className={`px-3 py-2.5 text-center font-mono ${(row.inspectionFailCount ?? 0) > 0 ? "text-red-400" : "text-muted"}`}>
                      {row.inspectionFailCount ?? 0}
                    </td>
                    <td className="px-3 py-2.5 text-muted truncate max-w-[200px]">{row.inspectionFailureReason || "--"}</td>
                    <td className={`px-3 py-2.5 text-center font-mono font-medium ${
                      (row.daysSinceLastFail ?? 0) > 14 ? "text-red-400" :
                      (row.daysSinceLastFail ?? 0) > 7 ? "text-orange-400" : "text-yellow-400"
                    }`}>
                      {row.daysSinceLastFail ?? "--"}d
                    </td>
                    <td className="px-3 py-2.5"><DealLinks dealId={row.dealId} zuperJobUid={row.zuperJobUid} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CC Pending Inspection */}
      {filteredPending.length > 0 && (
        <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-t-border">
            <h2 className="text-lg font-semibold text-foreground">CC Pending Inspection</h2>
            <p className="text-sm text-muted mt-0.5">
              {filteredPending.length} project{filteredPending.length !== 1 ? "s" : ""} construction-complete awaiting inspection
            </p>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-t-border bg-surface-2/50">
                  <SortHeader compact label="Project" sortKey="projectNumber" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
                  <SortHeader compact label="Customer" sortKey="name" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
                  <SortHeader compact label="PB Location" sortKey="pbLocation" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
                  <SortHeader compact label="AHJ" sortKey="ahj" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
                  <SortHeader compact label="Stage" sortKey="stage" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
                  <SortHeader compact label="Amount" sortKey="amount" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-right" />
                  <SortHeader compact label="CC Date" sortKey="constructionCompleteDate" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
                  <SortHeader compact label="Days Since CC" sortKey="daysSinceCc" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-center" />
                  <SortHeader compact label="Insp Scheduled" sortKey="inspectionScheduleDate" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
                  <SortHeader compact label="Booked Date" sortKey="inspectionBookedDate" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} />
                  <SortHeader compact label="Ready" sortKey="readyForInspection" currentKey={pendingSort.sortKey} currentDir={pendingSort.sortDir} onSort={pendingSort.toggle} className="text-center" />
                  <th className="px-3 py-2 text-center text-xs font-medium text-muted">Links</th>
                </tr>
              </thead>
              <tbody>
                {sortRows(filteredPending, pendingSort.sortKey, pendingSort.sortDir).map((row, i) => (
                  <tr key={row.dealId} className={`border-b border-t-border/50 ${i % 2 === 0 ? "" : "bg-surface-2/20"}`}>
                    <td className="px-3 py-2.5 font-mono text-foreground">{row.projectNumber}</td>
                    <td className="px-3 py-2.5 text-foreground truncate max-w-[180px]">{row.name}</td>
                    <td className="px-3 py-2.5 text-muted">{row.pbLocation}</td>
                    <td className="px-3 py-2.5 text-muted">{row.ahj}</td>
                    <td className="px-3 py-2.5 text-muted">{row.stage}</td>
                    <td className="px-3 py-2.5 text-right text-muted">{fmtAmount(row.amount)}</td>
                    <td className="px-3 py-2.5 text-muted">{fmtDateShort(row.constructionCompleteDate)}</td>
                    <td className={`px-3 py-2.5 text-center font-mono font-medium ${
                      (row.daysSinceCc ?? 0) > 30 ? "text-red-400" :
                      (row.daysSinceCc ?? 0) > 14 ? "text-orange-400" :
                      (row.daysSinceCc ?? 0) > 7 ? "text-yellow-400" : "text-emerald-400"
                    }`}>
                      {row.daysSinceCc ?? "--"}d
                    </td>
                    <td className="px-3 py-2.5 text-muted">{fmtDateShort(row.inspectionScheduleDate)}</td>
                    <td className="px-3 py-2.5 text-muted">{fmtDateShort(row.inspectionBookedDate)}</td>
                    <td className="px-3 py-2.5 text-center">
                      {row.readyForInspection ? (
                        <span className="text-emerald-400" title="Ready">&#10003;</span>
                      ) : (
                        <span className="text-muted" title="Not ready">&#10007;</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5"><DealLinks dealId={row.dealId} zuperJobUid={row.zuperJobUid} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Install Photo Review */}
      <div className="bg-surface rounded-xl border border-t-border mb-6 overflow-hidden">
        <button
          onClick={() => setPhotoReviewOpen(!photoReviewOpen)}
          className="w-full flex items-center justify-between p-4 hover:bg-surface-2 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">&#128247;</span>
            <div className="text-left">
              <h2 className="text-lg font-semibold">Install Photo Review</h2>
              <p className="text-xs text-muted">Compare install photos against the permitted planset</p>
            </div>
          </div>
          <svg
            className={`w-5 h-5 text-muted transition-transform ${photoReviewOpen ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {photoReviewOpen && (
          <div className="border-t border-t-border p-4">
            <div className="grid grid-cols-1 xl:grid-cols-[360px,minmax(0,1fr)] gap-4">
              <div className="border border-t-border rounded-xl bg-surface-2/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Select Project</h3>
                  <span className="text-[0.7rem] text-muted">{photoReviewCandidates.length} shown</span>
                </div>
                <p className="text-xs text-muted mt-1">
                  Search by project name, ID, location, or AHJ.
                </p>
                <input
                  type="text"
                  value={photoReviewProjectSearch}
                  onChange={(e) => setPhotoReviewProjectSearch(e.target.value)}
                  placeholder="Find a project..."
                  className="mt-3 w-full px-3 py-2 bg-surface border border-t-border rounded-lg text-sm focus:outline-none focus:border-orange-500"
                />
                <div className="mt-3 max-h-[480px] overflow-y-auto space-y-2 pr-1">
                  {photoReviewCandidates.length === 0 ? (
                    <div className="text-xs text-muted px-2 py-4 text-center border border-dashed border-t-border rounded-lg">
                      No matching projects in current filters.
                    </div>
                  ) : (
                    photoReviewCandidates.map((project) => {
                      const projectName = getProjectDisplayName(project.name);
                      const inspectionStatus = getDisplayName(project.finalInspectionStatus) || "Pending";
                      const isActive = photoReviewDealId === project.id;
                      const isRunning = isActive && photoReviewLoading;
                      return (
                        <button
                          key={project.id}
                          onClick={() => runPhotoReview(project.id, projectName)}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            isActive
                              ? "border-orange-500/60 bg-orange-500/10"
                              : "border-t-border bg-surface hover:bg-surface-2 hover:border-orange-500/40"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{projectName}</p>
                              <p className="text-xs text-muted truncate mt-0.5">
                                {project.pbLocation || "Unknown"} • {project.ahj || "Unknown AHJ"}
                              </p>
                              <p className="text-[0.7rem] text-muted truncate mt-0.5">{project.id}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs font-mono text-orange-400">{formatMoney(project.amount || 0)}</p>
                              <span className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium ${getInspectionStatusColor(project.finalInspectionStatus)}`}>
                                {inspectionStatus}
                              </span>
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-orange-300">
                            {isRunning ? "Running review..." : isActive ? "Selected for review" : "Run photo review"}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="min-h-[260px]">
                {!photoReviewDealId && !photoReviewLoading && !photoReviewResult && !photoReviewError && (
                  <div className="h-full rounded-xl border border-dashed border-t-border bg-surface-2/30 p-6">
                    <h3 className="text-lg font-semibold text-foreground">Run Install Photo Review</h3>
                    <p className="text-sm text-muted mt-2">
                      Pick a project on the left to compare install photos against the permitted planset.
                    </p>
                    <ul className="mt-4 space-y-2 text-xs text-muted">
                      <li>1. Select a project and start review.</li>
                      <li>2. Wait while the system fetches planset + photos.</li>
                      <li>3. Prioritize any FAIL findings for follow-up.</li>
                    </ul>
                  </div>
                )}

                {photoReviewLoading && (
                  <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-6">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-orange-500"></div>
                      <div>
                        <p className="text-foreground font-medium">{photoReviewDealName}</p>
                        <p className="text-xs text-muted">Fetching photos, loading planset, running AI comparison.</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted mt-3">Typical runtime: 30-60 seconds.</p>
                  </div>
                )}

                {photoReviewError && (
                  <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
                    <p className="font-medium text-red-400">{photoReviewDealName || "Install Photo Review"}</p>
                    <p className="text-sm text-red-300 mt-1">{photoReviewError}</p>
                    <div className="flex items-center gap-2 mt-4">
                      {photoReviewDealId && (
                        <button
                          onClick={() => runPhotoReview(photoReviewDealId, photoReviewDealName || "Selected Project")}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-700"
                        >
                          Retry Review
                        </button>
                      )}
                      <button
                        onClick={resetPhotoReview}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-t-border hover:border-muted text-muted hover:text-foreground"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}

                {photoReviewResult && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <h3 className="font-semibold text-foreground">{photoReviewDealName}</h3>
                        <p className="text-xs text-muted mt-0.5">
                          {photoReviewResult.photo_count} photo{photoReviewResult.photo_count !== 1 ? "s" : ""} reviewed
                          {" • "}planset: {photoReviewResult.planset_filename}
                          {" • "}{(photoReviewResult.duration_ms / 1000).toFixed(1)}s
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                          photoReviewResult.overall_pass
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-red-500/20 text-red-400"
                        }`}>
                          {photoReviewResult.overall_pass ? "PASS" : "FAIL"}
                        </span>
                        {photoReviewDealId && (
                          <button
                            onClick={() => runPhotoReview(photoReviewDealId, photoReviewDealName)}
                            className="text-xs px-3 py-1.5 border border-t-border rounded-lg hover:border-orange-500/50"
                          >
                            Run Again
                          </button>
                        )}
                        <button
                          onClick={resetPhotoReview}
                          className="text-xs px-3 py-1.5 border border-t-border rounded-lg hover:border-muted text-muted hover:text-foreground"
                        >
                          New Review
                        </button>
                      </div>
                    </div>

                    <p className="text-sm text-muted bg-surface-2 rounded-lg p-3 border border-t-border">
                      {photoReviewResult.summary}
                    </p>

                    <div className="flex items-center gap-2 flex-wrap">
                      {[
                        { key: "all" as const, label: "All", count: photoReviewFindingCounts.all, activeClass: "bg-zinc-500/20 text-foreground border-zinc-500/40" },
                        { key: "fail" as const, label: "Fail", count: photoReviewFindingCounts.fail, activeClass: "bg-red-500/20 text-red-300 border-red-500/40" },
                        { key: "unable_to_verify" as const, label: "Unable", count: photoReviewFindingCounts.unable_to_verify, activeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
                        { key: "pass" as const, label: "Pass", count: photoReviewFindingCounts.pass, activeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
                      ].map((filter) => (
                        <button
                          key={filter.key}
                          onClick={() => setPhotoReviewStatusFilter(filter.key)}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                            photoReviewStatusFilter === filter.key
                              ? filter.activeClass
                              : "border-t-border text-muted hover:text-foreground"
                          }`}
                        >
                          {filter.label} ({filter.count})
                        </button>
                      ))}
                    </div>

                    <div className="space-y-3">
                      {visiblePhotoReviewFindings.length === 0 ? (
                        <div className="text-xs text-muted border border-dashed border-t-border rounded-lg p-4">
                          No findings match this filter.
                        </div>
                      ) : (
                        visiblePhotoReviewFindings.map((finding, idx) => {
                          const statusClass = finding.status === "pass"
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                            : finding.status === "fail"
                              ? "bg-red-500/20 text-red-300 border-red-500/30"
                              : "bg-amber-500/20 text-amber-300 border-amber-500/30";
                          const statusLabel = finding.status === "unable_to_verify"
                            ? "Unable to verify"
                            : finding.status.toUpperCase();
                          return (
                            <div key={`${finding.category}-${idx}`} className="border border-t-border rounded-lg p-3 bg-surface-2/30">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-foreground capitalize">{finding.category || "Unknown"}</p>
                                <span className={`px-2 py-0.5 rounded-full text-[0.7rem] font-semibold border ${statusClass}`}>
                                  {statusLabel}
                                </span>
                              </div>
                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3 text-xs">
                                <div className="rounded-md border border-t-border p-2 bg-surface">
                                  <p className="uppercase tracking-wide text-[0.65rem] text-muted mb-1">Planset Spec</p>
                                  <p className="text-foreground/90 whitespace-pre-wrap">{finding.planset_spec || "-"}</p>
                                </div>
                                <div className="rounded-md border border-t-border p-2 bg-surface">
                                  <p className="uppercase tracking-wide text-[0.65rem] text-muted mb-1">Observed</p>
                                  <p className="text-foreground/90 whitespace-pre-wrap">{finding.observed || "-"}</p>
                                </div>
                                <div className="rounded-md border border-t-border p-2 bg-surface">
                                  <p className="uppercase tracking-wide text-[0.65rem] text-muted mb-1">Notes</p>
                                  <p className="text-foreground/90 whitespace-pre-wrap">{finding.notes || "-"}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
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
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-orange-400">
                                {getProjectDisplayName(project.name)}
                              </a>
                              <div className="text-xs text-muted">{project.name.split('|')[1]?.trim() || ''}</div>
                              <div className="text-xs text-muted">{project.pbLocation}</div>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); runPhotoReview(project.id, getProjectDisplayName(project.name)); }}
                              className="flex-shrink-0 p-1.5 rounded-lg text-muted hover:text-orange-400 hover:bg-orange-500/10 transition-colors"
                              title="Review install photos"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            </button>
                          </div>
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
