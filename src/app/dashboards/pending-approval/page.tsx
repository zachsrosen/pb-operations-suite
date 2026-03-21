"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { formatDate } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { usePendingApprovalFilters } from "@/stores/dashboard-filters";

// ── Constants ──────────────────────────────────────────────────────────

const EXCLUDED_STAGES = ["Project Complete", "Cancelled", "Closed Lost", "Closed Won", "Lost"];

/** Layout statuses that mean the design is ready / drafted */
const DESIGN_READY_STATUSES = ["Draft Complete", "Ready", "Draft Created"];

/** Layout statuses that mean the DA has been sent to customer */
const DA_SENT_STATUSES = [
  "Sent For Approval",
  "Resent For Approval",
  "Sent to Customer",
  "Review In Progress",
  "Pending Review",
  "Ready For Review",
];

/** Combined "approved" layout statuses */
const APPROVED_STATUSES = ["Approved", "Customer Approved"];

// ── Sort helpers ───────────────────────────────────────────────────────

type SortDir = "asc" | "desc";

function useSort(defaultKey: string | null = null, defaultDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);
  const toggle = useCallback(
    (key: string) => {
      if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setSortKey(key);
        setSortDir("desc");
      }
    },
    [sortKey]
  );
  return { sortKey, sortDir, toggle };
}

function sortRows<T extends Record<string, unknown>>(rows: T[], key: string | null, dir: SortDir): T[] {
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === "number" && typeof bv === "number") return dir === "asc" ? av - bv : bv - av;
    return dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}

// ── Day-diff helper ────────────────────────────────────────────────────

function daysSince(dateStr: string | undefined | null): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr + "T12:00:00");
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}

function daysColor(days: number): string {
  if (days > 14) return "text-red-400";
  if (days > 7) return "text-orange-400";
  if (days > 3) return "text-yellow-400";
  return "text-emerald-400";
}

// ── SortHeader ─────────────────────────────────────────────────────────

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: string;
  currentKey: string | null;
  currentDir: SortDir;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = currentKey === sortKey;
  return (
    <th
      className={`p-3 cursor-pointer select-none hover:text-purple-300 transition-colors ${className}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <span className="ml-1 text-xs">{active ? (currentDir === "asc" ? "\u25B2" : "\u25BC") : "\u21C5"}</span>
    </th>
  );
}

// ── Section skeleton ───────────────────────────────────────────────────

function SectionSkeleton({ title }: { title: string }) {
  return (
    <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
      <div className="px-5 py-4 border-b border-t-border">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div className="p-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}

// ── DA Status badge ────────────────────────────────────────────────────

function DAStatusBadge({ status }: { status: string }) {
  const isSent = DA_SENT_STATUSES.includes(status);
  const cls = isSent
    ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
    : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}>
      {status}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function DesignApprovalQueuePage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  // Data
  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  // Filter state (persisted)
  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = usePendingApprovalFilters();
  const [searchQuery, setSearchQuery] = useState("");

  // Per-section sort state — must be called before any early return
  const sort1 = useSort("daysWaiting", "desc");
  const sort2 = useSort("daysWaiting", "desc");
  const sort3 = useSort("daysWaiting", "desc");

  // Activity tracking
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("pending-approval", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // ── Base pool: exclude terminal stages ─────────────────────────────
  const baseProjects = useMemo(
    () => safeProjects.filter((p) => !EXCLUDED_STAGES.includes(p.stage)),
    [safeProjects]
  );

  // ── Filter options (built from base pool) ──────────────────────────
  const locationOptions: FilterOption[] = useMemo(() => {
    const locs = [...new Set(baseProjects.map((p) => p.pbLocation).filter(Boolean))] as string[];
    return locs.sort().map((l) => ({ value: l, label: l }));
  }, [baseProjects]);

  const ownerOptions: FilterOption[] = useMemo(() => {
    const owners = [...new Set(baseProjects.map((p) => p.projectManager || "Unknown"))] as string[];
    return owners.sort().map((o) => ({ value: o, label: o }));
  }, [baseProjects]);

  const surveyorOptions: FilterOption[] = useMemo(() => {
    const surveyors = [...new Set(baseProjects.map((p) => p.siteSurveyor || "Unknown"))];
    return surveyors.sort().map((s) => ({ value: s, label: s }));
  }, [baseProjects]);

  const designLeadOptions: FilterOption[] = useMemo(() => {
    const leads = [...new Set(baseProjects.map((p) => p.designLead || "Unknown"))];
    return leads.sort().map((s) => ({ value: s, label: s }));
  }, [baseProjects]);

  const stageOptions: FilterOption[] = useMemo(() => {
    const stages = [...new Set(baseProjects.map((p) => p.stage || ""))].filter(Boolean);
    return stages.sort().map((s) => ({ value: s, label: s }));
  }, [baseProjects]);

  const hasActiveFilters =
    persistedFilters.locations.length > 0 ||
    persistedFilters.owners.length > 0 ||
    persistedFilters.stages.length > 0 ||
    persistedFilters.surveyors.length > 0 ||
    persistedFilters.designLeads.length > 0 ||
    searchQuery.length > 0;

  // ── Apply user filters ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = baseProjects;
    if (persistedFilters.locations.length > 0) {
      result = result.filter((p) => persistedFilters.locations.includes(p.pbLocation || ""));
    }
    if (persistedFilters.owners.length > 0) {
      result = result.filter((p) => persistedFilters.owners.includes(p.projectManager || "Unknown"));
    }
    if (persistedFilters.stages.length > 0) {
      result = result.filter((p) => persistedFilters.stages.includes(p.stage || ""));
    }
    if (persistedFilters.surveyors.length > 0) {
      result = result.filter((p) => persistedFilters.surveyors.includes(p.siteSurveyor || "Unknown"));
    }
    if (persistedFilters.designLeads.length > 0) {
      result = result.filter((p) => persistedFilters.designLeads.includes(p.designLead || "Unknown"));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.projectManager || "").toLowerCase().includes(q) ||
          (p.pbLocation || "").toLowerCase().includes(q) ||
          (p.layoutStatus || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [baseProjects, persistedFilters, searchQuery]);

  // ── Section 1: Survey Done — Needs Design ──────────────────────────
  const section1Rows = useMemo(
    () =>
      filtered
        .filter((p) => {
          if (!p.siteSurveyCompletionDate) return false;
          if (p.layoutStatus && DESIGN_READY_STATUSES.includes(p.layoutStatus)) return false;
          if (p.layoutStatus && DA_SENT_STATUSES.includes(p.layoutStatus)) return false;
          if (p.designApprovalSentDate) return false;
          if (p.designApprovalDate) return false;
          if (p.layoutStatus && APPROVED_STATUSES.includes(p.layoutStatus)) return false;
          return true;
        })
        .map((p) => ({
          ...p,
          daysWaiting: daysSince(p.siteSurveyCompletionDate),
        })),
    [filtered]
  );

  // ── Section 2: Design Ready — Send to Customer ─────────────────────
  const section2Rows = useMemo(
    () =>
      filtered
        .filter((p) =>
          p.layoutStatus &&
          DESIGN_READY_STATUSES.includes(p.layoutStatus) &&
          !p.designApprovalSentDate && // not already sent
          !p.designApprovalDate         // not already approved
        )
        .map((p) => ({
          ...p,
          daysWaiting: p.designCompletionDate
            ? daysSince(p.designCompletionDate)
            : p.daysSinceStageMovement ?? 0,
        })),
    [filtered]
  );

  // ── Section 3: DA Sent — Awaiting Customer ─────────────────────────
  const section3Rows = useMemo(
    () =>
      filtered
        .filter((p) =>
          p.layoutStatus &&
          DA_SENT_STATUSES.includes(p.layoutStatus) &&
          !p.designApprovalDate // not already approved
        )
        .map((p) => ({
          ...p,
          daysWaiting: daysSince(p.designApprovalSentDate),
        })),
    [filtered]
  );

  // ── Sorted rows ────────────────────────────────────────────────────
  const sorted1 = useMemo(() => sortRows(section1Rows, sort1.sortKey, sort1.sortDir), [section1Rows, sort1.sortKey, sort1.sortDir]);
  const sorted2 = useMemo(() => sortRows(section2Rows, sort2.sortKey, sort2.sortDir), [section2Rows, sort2.sortKey, sort2.sortDir]);
  const sorted3 = useMemo(() => sortRows(section3Rows, sort3.sortKey, sort3.sortDir), [section3Rows, sort3.sortKey, sort3.sortDir]);

  // ── Export ─────────────────────────────────────────────────────────
  const exportRows = useMemo(
    () =>
      [...section1Rows, ...section2Rows, ...section3Rows].map((p) => ({
        name: p.name,
        pm: p.projectManager || "Unknown",
        siteSurveyor: p.siteSurveyor || "",
        designLead: p.designLead || "",
        location: p.pbLocation || "",
        stage: p.stage || "",
        layoutStatus: p.layoutStatus || "",
        daysWaiting: p.daysWaiting,
        surveyCompleted: p.siteSurveyCompletionDate || "",
        designCompleted: p.designCompletionDate || "",
        daSent: p.designApprovalSentDate || "",
      })),
    [section1Rows, section2Rows, section3Rows]
  );

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <DashboardShell
      title="Design Approval Queue"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "design-approval-queue.csv" }}
      fullWidth
    >
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 stagger-grid mb-6">
        <MiniStat label="Needs Design" value={loading ? null : section1Rows.length} />
        <MiniStat label="Ready to Send" value={loading ? null : section2Rows.length} />
        <MiniStat label="Awaiting Customer" value={loading ? null : section3Rows.length} />
      </div>

      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, PM, location..."
            className="w-full pl-10 pr-8 py-2 bg-surface-2 border border-t-border rounded-lg text-sm focus:outline-none focus:border-muted focus:ring-1 focus:ring-muted"
          />
          {searchQuery && (
            <button
              aria-label="Clear search"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={persistedFilters.locations}
          onChange={(locations) => setPersisted({ ...persistedFilters, locations })}
          accentColor="indigo"
        />
        <MultiSelectFilter
          label="PM"
          options={ownerOptions}
          selected={persistedFilters.owners}
          onChange={(owners) => setPersisted({ ...persistedFilters, owners })}
          accentColor="indigo"
        />
        <MultiSelectFilter
          label="Deal Stage"
          options={stageOptions}
          selected={persistedFilters.stages}
          onChange={(stages) => setPersisted({ ...persistedFilters, stages })}
          accentColor="indigo"
        />
        <MultiSelectFilter
          label="Surveyor"
          options={surveyorOptions}
          selected={persistedFilters.surveyors}
          onChange={(surveyors) => setPersisted({ ...persistedFilters, surveyors })}
          accentColor="indigo"
        />
        <MultiSelectFilter
          label="Design Lead"
          options={designLeadOptions}
          selected={persistedFilters.designLeads}
          onChange={(designLeads) => setPersisted({ ...persistedFilters, designLeads })}
          accentColor="indigo"
        />

        {hasActiveFilters && (
          <button
            onClick={() => {
              clearFilters();
              setSearchQuery("");
            }}
            className="text-xs px-3 py-2 rounded-lg border border-t-border text-muted hover:text-foreground hover:border-muted transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* ── Section 1: Survey Done — Needs Design ───────────────── */}
      {loading ? (
        <SectionSkeleton title="Survey Done \u2014 Needs Design" />
      ) : (
        <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
          <div className="px-5 py-4 border-b border-t-border">
            <h2 className="text-lg font-semibold text-foreground">
              Survey Done &mdash; Needs Design
              <span className="ml-2 text-sm font-normal text-muted">({section1Rows.length})</span>
            </h2>
            <p className="text-xs text-muted mt-1">
              Active projects where site survey is complete but design hasn&apos;t been drafted or sent &middot; Excludes completed and cancelled projects
            </p>
          </div>
          {sorted1.length === 0 ? (
            <div className="p-8 text-center text-emerald-400">No projects in this stage</div>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                    <SortHeader label="Project" sortKey="name" currentKey={sort1.sortKey} currentDir={sort1.sortDir} onSort={sort1.toggle} />
                    <SortHeader label="PM" sortKey="projectManager" currentKey={sort1.sortKey} currentDir={sort1.sortDir} onSort={sort1.toggle} />
                    <SortHeader label="Location" sortKey="pbLocation" currentKey={sort1.sortKey} currentDir={sort1.sortDir} onSort={sort1.toggle} />
                    <SortHeader label="Surveyor" sortKey="siteSurveyor" currentKey={sort1.sortKey} currentDir={sort1.sortDir} onSort={sort1.toggle} />
                    <SortHeader label="Designer" sortKey="designLead" currentKey={sort1.sortKey} currentDir={sort1.sortDir} onSort={sort1.toggle} />
                    <SortHeader label="Stage" sortKey="stage" currentKey={sort1.sortKey} currentDir={sort1.sortDir} onSort={sort1.toggle} />
                    <SortHeader label="Survey Completed" sortKey="siteSurveyCompletionDate" currentKey={sort1.sortKey} currentDir={sort1.sortDir} onSort={sort1.toggle} />
                    <SortHeader label="Layout Status" sortKey="layoutStatus" currentKey={sort1.sortKey} currentDir={sort1.sortDir} onSort={sort1.toggle} />
                    <SortHeader label="Days Since Survey" sortKey="daysWaiting" currentKey={sort1.sortKey} currentDir={sort1.sortDir} onSort={sort1.toggle} className="text-right" />
                  </tr>
                </thead>
                <tbody>
                  {sorted1.map((p) => (
                    <tr key={p.id} className="border-b border-t-border/50 hover:bg-surface-2/50">
                      <td className="p-3">
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 hover:underline">
                            {p.name}
                          </a>
                        ) : (
                          <span className="text-foreground">{p.name}</span>
                        )}
                      </td>
                      <td className="p-3 text-muted">{p.projectManager || "Unknown"}</td>
                      <td className="p-3 text-muted">{p.pbLocation || "\u2014"}</td>
                      <td className="p-3 text-muted">{p.siteSurveyor || "\u2014"}</td>
                      <td className="p-3 text-muted">{p.designLead || "\u2014"}</td>
                      <td className="p-3 text-muted">{p.stage || "\u2014"}</td>
                      <td className="p-3 text-muted">{formatDate(p.siteSurveyCompletionDate)}</td>
                      <td className="p-3 text-muted">{p.layoutStatus || "\u2014"}</td>
                      <td className="p-3 text-right">
                        <span className={`font-semibold ${daysColor(p.daysWaiting)}`}>{p.daysWaiting}d</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Section 2: Design Ready — Send to Customer ──────────── */}
      {loading ? (
        <SectionSkeleton title="Design Ready \u2014 Send to Customer" />
      ) : (
        <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
          <div className="px-5 py-4 border-b border-t-border">
            <h2 className="text-lg font-semibold text-foreground">
              Design Ready &mdash; Send to Customer
              <span className="ml-2 text-sm font-normal text-muted">({section2Rows.length})</span>
            </h2>
            <p className="text-xs text-muted mt-1">
              Design is drafted or ready but hasn&apos;t been submitted to the customer yet &middot; Excludes completed and cancelled projects
            </p>
          </div>
          {sorted2.length === 0 ? (
            <div className="p-8 text-center text-emerald-400">No projects in this stage</div>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                    <SortHeader label="Project" sortKey="name" currentKey={sort2.sortKey} currentDir={sort2.sortDir} onSort={sort2.toggle} />
                    <SortHeader label="PM" sortKey="projectManager" currentKey={sort2.sortKey} currentDir={sort2.sortDir} onSort={sort2.toggle} />
                    <SortHeader label="Location" sortKey="pbLocation" currentKey={sort2.sortKey} currentDir={sort2.sortDir} onSort={sort2.toggle} />
                    <SortHeader label="Designer" sortKey="designLead" currentKey={sort2.sortKey} currentDir={sort2.sortDir} onSort={sort2.toggle} />
                    <SortHeader label="Stage" sortKey="stage" currentKey={sort2.sortKey} currentDir={sort2.sortDir} onSort={sort2.toggle} />
                    <SortHeader label="Layout Status" sortKey="layoutStatus" currentKey={sort2.sortKey} currentDir={sort2.sortDir} onSort={sort2.toggle} />
                    <SortHeader label="Design Completed" sortKey="designCompletionDate" currentKey={sort2.sortKey} currentDir={sort2.sortDir} onSort={sort2.toggle} />
                    <SortHeader label="Days Waiting" sortKey="daysWaiting" currentKey={sort2.sortKey} currentDir={sort2.sortDir} onSort={sort2.toggle} className="text-right" />
                  </tr>
                </thead>
                <tbody>
                  {sorted2.map((p) => (
                    <tr key={p.id} className="border-b border-t-border/50 hover:bg-surface-2/50">
                      <td className="p-3">
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 hover:underline">
                            {p.name}
                          </a>
                        ) : (
                          <span className="text-foreground">{p.name}</span>
                        )}
                      </td>
                      <td className="p-3 text-muted">{p.projectManager || "Unknown"}</td>
                      <td className="p-3 text-muted">{p.pbLocation || "\u2014"}</td>
                      <td className="p-3 text-muted">{p.designLead || "\u2014"}</td>
                      <td className="p-3 text-muted">{p.stage || "\u2014"}</td>
                      <td className="p-3">
                        <DAStatusBadge status={p.layoutStatus || ""} />
                      </td>
                      <td className="p-3 text-muted">{formatDate(p.designCompletionDate)}</td>
                      <td className="p-3 text-right">
                        <span className={`font-semibold ${daysColor(p.daysWaiting)}`}>{p.daysWaiting}d</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Section 3: DA Sent — Awaiting Customer ──────────────── */}
      {loading ? (
        <SectionSkeleton title="DA Sent \u2014 Awaiting Customer" />
      ) : (
        <div className="bg-surface border border-t-border rounded-xl overflow-hidden mb-8">
          <div className="px-5 py-4 border-b border-t-border">
            <h2 className="text-lg font-semibold text-foreground">
              DA Sent &mdash; Awaiting Customer
              <span className="ml-2 text-sm font-normal text-muted">({section3Rows.length})</span>
            </h2>
            <p className="text-xs text-muted mt-1">
              DA has been sent and is waiting on customer approval &middot; Excludes completed and cancelled projects
            </p>
          </div>
          {sorted3.length === 0 ? (
            <div className="p-8 text-center text-emerald-400">No projects in this stage</div>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                    <SortHeader label="Project" sortKey="name" currentKey={sort3.sortKey} currentDir={sort3.sortDir} onSort={sort3.toggle} />
                    <SortHeader label="PM" sortKey="projectManager" currentKey={sort3.sortKey} currentDir={sort3.sortDir} onSort={sort3.toggle} />
                    <SortHeader label="Location" sortKey="pbLocation" currentKey={sort3.sortKey} currentDir={sort3.sortDir} onSort={sort3.toggle} />
                    <SortHeader label="Designer" sortKey="designLead" currentKey={sort3.sortKey} currentDir={sort3.sortDir} onSort={sort3.toggle} />
                    <SortHeader label="Surveyor" sortKey="siteSurveyor" currentKey={sort3.sortKey} currentDir={sort3.sortDir} onSort={sort3.toggle} />
                    <SortHeader label="Stage" sortKey="stage" currentKey={sort3.sortKey} currentDir={sort3.sortDir} onSort={sort3.toggle} />
                    <SortHeader label="DA Status" sortKey="layoutStatus" currentKey={sort3.sortKey} currentDir={sort3.sortDir} onSort={sort3.toggle} />
                    <SortHeader label="DA Sent" sortKey="designApprovalSentDate" currentKey={sort3.sortKey} currentDir={sort3.sortDir} onSort={sort3.toggle} />
                    <SortHeader label="Days Waiting" sortKey="daysWaiting" currentKey={sort3.sortKey} currentDir={sort3.sortDir} onSort={sort3.toggle} className="text-right" />
                  </tr>
                </thead>
                <tbody>
                  {sorted3.map((p) => (
                    <tr key={p.id} className="border-b border-t-border/50 hover:bg-surface-2/50">
                      <td className="p-3">
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 hover:underline">
                            {p.name}
                          </a>
                        ) : (
                          <span className="text-foreground">{p.name}</span>
                        )}
                      </td>
                      <td className="p-3 text-muted">{p.projectManager || "Unknown"}</td>
                      <td className="p-3 text-muted">{p.pbLocation || "\u2014"}</td>
                      <td className="p-3 text-muted">{p.designLead || "\u2014"}</td>
                      <td className="p-3 text-muted">{p.siteSurveyor || "\u2014"}</td>
                      <td className="p-3 text-muted">{p.stage || "\u2014"}</td>
                      <td className="p-3">
                        <DAStatusBadge status={p.layoutStatus || ""} />
                      </td>
                      <td className="p-3 text-muted">{formatDate(p.designApprovalSentDate)}</td>
                      <td className="p-3 text-right">
                        <span className={`font-semibold ${daysColor(p.daysWaiting)}`}>{p.daysWaiting}d</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </DashboardShell>
  );
}
