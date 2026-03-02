"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useDEOverviewFilters } from "@/stores/dashboard-filters";
import Link from "next/link";

// Design status funnel order — keys are HubSpot `design_status` values, labels are display names
const STATUS_FUNNEL = [
  // Core pipeline
  { key: "Ready for Design", label: "Ready for Design", color: "bg-slate-500" },
  { key: "In Progress", label: "In Progress", color: "bg-blue-500" },
  { key: "Initial Review", label: "Ready For Review", color: "bg-yellow-500" },
  { key: "Ready for Review", label: "Final Review/Stamping", color: "bg-orange-500" },
  { key: "Draft Complete", label: "Draft Complete — Waiting on Approvals", color: "bg-purple-500" },
  { key: "DA Approved", label: "DA Approved", color: "bg-indigo-500" },
  { key: "Submitted To Engineering", label: "Submitted To Engineering", color: "bg-cyan-500" },
  { key: "Complete", label: "Design Complete", color: "bg-emerald-500" },
  // DA revisions
  { key: "Revision Needed - DA Rejected", label: "Revision Needed — DA Rejected", color: "bg-red-500" },
  { key: "DA Revision In Progress", label: "DA Revision In Progress", color: "bg-red-400" },
  { key: "DA Revision Completed", label: "DA Revision Completed", color: "bg-red-300" },
  // AHJ revisions
  { key: "Revision Needed - Rejected by AHJ", label: "Revision Needed — AHJ Rejected", color: "bg-rose-500" },
  { key: "Permit Revision In Progress", label: "Permit Revision In Progress", color: "bg-rose-400" },
  { key: "Permit Revision Completed", label: "Permit Revision Completed", color: "bg-rose-300" },
  // Utility revisions
  { key: "Revision Needed - Rejected by Utility", label: "Revision Needed — Utility Rejected", color: "bg-pink-500" },
  { key: "Utility Revision In Progress", label: "Utility Revision In Progress", color: "bg-pink-400" },
  { key: "Utility Revision Completed", label: "Utility Revision Completed", color: "bg-pink-300" },
  // As-built revisions
  { key: "Revision Needed - Rejected", label: "Revision Needed — As-Built", color: "bg-fuchsia-500" },
  { key: "As-Built Revision In Progress", label: "As-Built Revision In Progress", color: "bg-fuchsia-400" },
  { key: "As-Built Revision Completed", label: "As-Built Revision Completed", color: "bg-fuchsia-300" },
  // Clarification
  { key: "Needs Clarification", label: "Needs Clarification", color: "bg-amber-500" },
  { key: "Needs Clarification from Customer", label: "Needs Clarification — Customer", color: "bg-amber-400" },
  { key: "Needs Clarification from Sales", label: "Needs Clarification — Sales", color: "bg-amber-400" },
  { key: "Needs Clarification from Operations", label: "Needs Clarification — Operations", color: "bg-amber-400" },
  // Holds & special
  { key: "Pending Resurvey", label: "Pending Resurvey", color: "bg-zinc-500" },
  { key: "On Hold", label: "On Hold", color: "bg-zinc-400" },
  { key: "No Design Needed", label: "No Design Needed", color: "bg-zinc-300" },
  // New construction
  { key: "New Construction - Design Needed", label: "New Construction — Design Needed", color: "bg-teal-500" },
  { key: "New Construction - In Progress", label: "New Construction — In Progress", color: "bg-teal-400" },
  { key: "New Construction - Ready for Review", label: "New Construction — Ready for Review", color: "bg-teal-300" },
  { key: "New Construction - Design Completed", label: "New Construction — Completed", color: "bg-teal-200" },
  // Xcel
  { key: "Xcel - Design Needed", label: "Xcel — Design Needed", color: "bg-sky-500" },
  { key: "Xcel - In Progress", label: "Xcel — In Progress", color: "bg-sky-400" },
  { key: "Xcel - Site Plan & SLD Completed", label: "Xcel — Site Plan & SLD Completed", color: "bg-sky-300" },
  // Archived
  { key: "In Revision", label: "(Archived) Revision In Progress", color: "bg-stone-500" },
  { key: "Revision Complete", label: "(Archived) Revision Complete", color: "bg-stone-400" },
  { key: "Revision Initial Review", label: "(Archived) Revision Initial Review", color: "bg-stone-400" },
  { key: "Revision Final Review", label: "(Archived) Revision Final Review", color: "bg-stone-400" },
  { key: "Revision In Engineering", label: "(Archived) Revision In Engineering", color: "bg-stone-400" },
];

const DA_STATUS_FUNNEL = [
  { key: "Draft Created", label: "Draft Created", color: "bg-slate-500" },
  { key: "Draft Complete", label: "Draft Complete", color: "bg-blue-500" },
  { key: "Sent For Approval", label: "Sent For Approval", color: "bg-yellow-500" },
  { key: "Resent For Approval", label: "Resent For Approval", color: "bg-orange-500" },
  { key: "Review In Progress", label: "Review In Progress", color: "bg-purple-500" },
  { key: "Approved", label: "Approved", color: "bg-emerald-500" },
];

// pbLocation values: "Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"
const CO_LOCATIONS = ["Westminster", "Centennial", "Colorado Springs"];
const CA_LOCATIONS = ["San Luis Obispo", "Camarillo"];

// D&E sub-dashboard links
const SUB_DASHBOARDS = [
  { href: "/dashboards/plan-review", title: "Plan Review Queue", tag: "REVIEW" },
  { href: "/dashboards/pending-approval", title: "Pending Approval", tag: "APPROVAL" },
  { href: "/dashboards/design-revisions", title: "Design Revisions", tag: "REVISIONS" },
  { href: "/dashboards/de-metrics", title: "D&E Metrics", tag: "METRICS" },
  { href: "/dashboards/clipping-analytics", title: "Clipping Analytics", tag: "CLIPPING" },
  { href: "/dashboards/ahj-requirements", title: "AHJ Requirements", tag: "AHJ" },
  { href: "/dashboards/utility-design-requirements", title: "Utility Requirements", tag: "UTILITY" },
];

type SortKey = "name" | "designStatus" | "layoutStatus" | "stage" | "designLead" | "pbLocation" | "amount" | "daysStale" | "designDraftDate" | "designApprovalSentDate";
type SortDir = "asc" | "desc";

export default function DEOverviewPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("de-overview", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // ---- Filter state ----
  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = useDEOverviewFilters();
  const [searchQuery, setSearchQuery] = useState("");

  // ---- Sort state ----
  const [sortKey, setSortKey] = useState<SortKey>("daysStale");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }, [sortKey]);

  const sortIndicator = useCallback((key: SortKey) => {
    if (sortKey !== key) return " \u21C5";
    return sortDir === "asc" ? " \u2191" : " \u2193";
  }, [sortKey, sortDir]);

  const designProjects = useMemo(
    () => safeProjects.filter((p) => p.stage === "Design & Engineering"),
    [safeProjects]
  );

  // ---- Filter option lists ----
  const locationOptions: FilterOption[] = useMemo(
    () => [...new Set(safeProjects.map((p) => p.pbLocation || ""))].filter(Boolean).sort().map((loc) => ({ value: loc, label: loc })),
    [safeProjects]
  );
  const ownerOptions: FilterOption[] = useMemo(
    () => [...new Set(safeProjects.map((p) => p.designLead || "Unknown"))].sort().map((o) => ({ value: o, label: o })),
    [safeProjects]
  );

  const hasActiveFilters = persistedFilters.locations.length > 0 || persistedFilters.owners.length > 0 || searchQuery.length > 0;

  // ---- Filtered projects ----
  const filteredProjects = useMemo(() => {
    let list = designProjects;

    if (persistedFilters.locations.length > 0) {
      list = list.filter((p) => persistedFilters.locations.includes(p.pbLocation || ""));
    }
    if (persistedFilters.owners.length > 0) {
      list = list.filter((p) => persistedFilters.owners.includes(p.designLead || "Unknown"));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.designStatus || "").toLowerCase().includes(q) ||
          (p.designLead || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [designProjects, persistedFilters, searchQuery]);

  // ---- Hero metrics ----
  const heroMetrics = useMemo(() => {
    const activeCount = filteredProjects.length;
    const readyForDesign = filteredProjects.filter(
      (p) => p.designStatus === "Ready for Design"
    ).length;
    const readyForReview = filteredProjects.filter(
      (p) => p.designStatus === "Initial Review"
    ).length;

    // Pending DA: layoutStatus is a pending-approval status and not yet approved
    const PENDING_DA_STATUSES = [
      "Draft Created", "Draft Complete", "Sent For Approval",
      "Resent For Approval", "Sent to Customer", "Review In Progress",
      "Pending Review", "Ready For Review", "Ready",
    ];
    const pendingDA = filteredProjects.filter(
      (p) => p.layoutStatus && PENDING_DA_STATUSES.includes(p.layoutStatus)
    ).length;

    return { activeCount, readyForDesign, readyForReview, pendingDA };
  }, [filteredProjects]);

  // ---- Status funnel ----
  const funnelData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredProjects.forEach((p) => {
      if (p.designStatus) {
        counts[p.designStatus] = (counts[p.designStatus] || 0) + 1;
      }
    });

    // Build ordered list: known statuses first, then unknowns
    const knownKeys = new Set(STATUS_FUNNEL.map((s) => s.key));
    const known = STATUS_FUNNEL
      .map((s) => ({ ...s, count: counts[s.key] || 0 }))
      .filter((s) => s.count > 0);
    const unknown = Object.entries(counts)
      .filter(([key]) => !knownKeys.has(key))
      .map(([key, count]) => ({ key, label: key, color: "bg-zinc-500", count }));
    const all = [...known, ...unknown];

    const maxCount = Math.max(1, ...all.map((s) => s.count));
    return all.map((s) => ({ ...s, pct: (s.count / maxCount) * 100 }));
  }, [filteredProjects]);

  // ---- DA Status funnel ----
  const daFunnelData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredProjects.forEach((p) => {
      if (p.layoutStatus) {
        counts[p.layoutStatus] = (counts[p.layoutStatus] || 0) + 1;
      }
    });

    // Build ordered list: known statuses first, then unknowns
    const knownKeys = new Set(DA_STATUS_FUNNEL.map((s) => s.key));
    const known = DA_STATUS_FUNNEL
      .map((s) => ({ ...s, count: counts[s.key] || 0 }))
      .filter((s) => s.count > 0);
    const unknown = Object.entries(counts)
      .filter(([key]) => !knownKeys.has(key))
      .map(([key, count]) => ({ key, label: key, color: "bg-zinc-500", count }));
    const all = [...known, ...unknown];

    const maxCount = Math.max(1, ...all.map((s) => s.count));
    return all.map((s) => ({ ...s, pct: (s.count / maxCount) * 100 }));
  }, [filteredProjects]);

  // ---- CO vs CA split ----
  const regionSplit = useMemo(() => {
    const co = filteredProjects.filter((p) => CO_LOCATIONS.includes(p.pbLocation || ""));
    const ca = filteredProjects.filter((p) => CA_LOCATIONS.includes(p.pbLocation || ""));
    return {
      co: { count: co.length, revenue: co.reduce((s, p) => s + (p.amount || 0), 0) },
      ca: { count: ca.length, revenue: ca.reduce((s, p) => s + (p.amount || 0), 0) },
    };
  }, [filteredProjects]);

  // ---- Stale projects (most days in current stage) ----
  const staleProjects = useMemo(() => {
    const list = filteredProjects
      .filter((p) => p.stage === "Design & Engineering" && p.daysSinceStageMovement != null)
      .map((p) => ({
        ...p,
        daysStale: p.daysSinceStageMovement ?? 0,
      }));

    // Sort
    list.sort((a, b) => {
      let aVal: string | number = 0;
      let bVal: string | number = 0;
      switch (sortKey) {
        case "name": aVal = (a.name || "").toLowerCase(); bVal = (b.name || "").toLowerCase(); break;
        case "designStatus": aVal = (a.designStatus || "").toLowerCase(); bVal = (b.designStatus || "").toLowerCase(); break;
        case "layoutStatus": aVal = (a.layoutStatus || "").toLowerCase(); bVal = (b.layoutStatus || "").toLowerCase(); break;
        case "stage": aVal = (a.stage || "").toLowerCase(); bVal = (b.stage || "").toLowerCase(); break;
        case "designLead": aVal = (a.designLead || "Unknown").toLowerCase(); bVal = (b.designLead || "Unknown").toLowerCase(); break;
        case "pbLocation": aVal = (a.pbLocation || "").toLowerCase(); bVal = (b.pbLocation || "").toLowerCase(); break;
        case "amount": aVal = a.amount || 0; bVal = b.amount || 0; break;
        case "daysStale": aVal = a.daysStale; bVal = b.daysStale; break;
        case "designDraftDate": aVal = a.designDraftDate || ""; bVal = b.designDraftDate || ""; break;
        case "designApprovalSentDate": aVal = a.designApprovalSentDate || ""; bVal = b.designApprovalSentDate || ""; break;
      }
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return list.slice(0, 10);
  }, [filteredProjects, sortKey, sortDir]);

  // ---- Export data ----
  const exportRows = useMemo(
    () =>
      filteredProjects.map((p) => ({
        name: p.name,
        stage: p.stage,
        designStatus: p.designStatus || "",
        designLead: p.designLead || "Unknown",
        location: p.pbLocation || "",
        amount: p.amount || 0,
        designDraftDate: p.designDraftDate || "",
        designApprovalSentDate: p.designApprovalSentDate || "",
        daysSinceStageMovement: p.daysSinceStageMovement ?? "",
      })),
    [filteredProjects]
  );

  return (
    <DashboardShell
      title="D&E Overview"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "de-overview.csv" }}
    >
      {/* Filter Row */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by PROJ #, name, or address..."
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
          onChange={(v) => setPersisted({ ...persistedFilters, locations: v })}
          accentColor="indigo"
        />
        <MultiSelectFilter
          label="Design Lead"
          options={ownerOptions}
          selected={persistedFilters.owners}
          onChange={(v) => setPersisted({ ...persistedFilters, owners: v })}
          accentColor="indigo"
        />

        {hasActiveFilters && (
          <button
            onClick={() => { clearFilters(); setSearchQuery(""); }}
            className="px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Hero Metrics */}
      <div className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-grid">
        <StatCard
          label="Active D&E Projects"
          value={loading ? null : heroMetrics.activeCount}
          color="purple"
        />
        <StatCard
          label="Ready for Design"
          value={loading ? null : heroMetrics.readyForDesign}
          color="purple"
        />
        <StatCard
          label="Ready for Review"
          value={loading ? null : heroMetrics.readyForReview}
          color="purple"
        />
        <StatCard
          label="Pending DA"
          value={loading ? null : heroMetrics.pendingDA}
          color="purple"
        />
      </div>

      {/* Status Funnels — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Design Status Funnel */}
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Design Status Funnel</h2>
          <div className="space-y-3">
            {funnelData.length === 0 ? (
              <p className="text-sm text-muted italic">No design status data for current filters.</p>
            ) : (
              funnelData.map((s) => (
                <div key={s.key} className="flex items-center gap-3">
                  <div className="w-36 text-xs text-muted truncate" title={s.label}>{s.label}</div>
                  <div className="flex-1 h-6 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${s.color} rounded-full transition-all duration-500 flex items-center justify-end pr-2`}
                      style={{ width: `${Math.max(s.pct, s.count > 0 ? 8 : 0)}%` }}
                    >
                      {s.count > 0 && (
                        <span className="text-xs font-semibold text-white">{s.count}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* DA Status Funnel */}
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">DA Status Funnel</h2>
          <div className="space-y-3">
            {daFunnelData.length === 0 ? (
              <p className="text-sm text-muted italic">No DA status data for current filters.</p>
            ) : (
              daFunnelData.map((s) => (
                <div key={s.key} className="flex items-center gap-3">
                  <div className="w-36 text-xs text-muted truncate" title={s.label}>{s.label}</div>
                  <div className="flex-1 h-6 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${s.color} rounded-full transition-all duration-500 flex items-center justify-end pr-2`}
                      style={{ width: `${Math.max(s.pct, s.count > 0 ? 8 : 0)}%` }}
                    >
                      {s.count > 0 && (
                        <span className="text-xs font-semibold text-white">{s.count}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* CO vs CA Split */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h3 className="text-sm font-medium text-muted mb-3">Colorado (CO)</h3>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-foreground">{loading ? "\u2014" : regionSplit.co.count}</span>
            <span className="text-sm text-muted">projects</span>
          </div>
          <div className="text-sm text-muted mt-1">{loading ? "\u2014" : formatMoney(regionSplit.co.revenue)} revenue</div>
        </div>
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h3 className="text-sm font-medium text-muted mb-3">California (CA)</h3>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-foreground">{loading ? "\u2014" : regionSplit.ca.count}</span>
            <span className="text-sm text-muted">projects</span>
          </div>
          <div className="text-sm text-muted mt-1">{loading ? "\u2014" : formatMoney(regionSplit.ca.revenue)} revenue</div>
        </div>
      </div>

      {/* Action Needed — Stale Projects */}
      <div className="mb-6 bg-surface border border-t-border rounded-xl p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">Action Needed — Stale Projects</h2>
        <p className="text-sm text-muted mb-4">
          Top 10 projects with the most days in their current design stage.
        </p>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : staleProjects.length === 0 ? (
          <p className="text-sm text-muted italic">No stale projects found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted">
                  <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Project{sortIndicator("name")}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("designStatus")}>
                    Design Status{sortIndicator("designStatus")}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("layoutStatus")}>
                    DA Status{sortIndicator("layoutStatus")}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("stage")}>
                    Deal Stage{sortIndicator("stage")}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("designLead")}>
                    Design Lead{sortIndicator("designLead")}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("pbLocation")}>
                    Location{sortIndicator("pbLocation")}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("designDraftDate")}>
                    Draft Date{sortIndicator("designDraftDate")}
                  </th>
                  <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleSort("designApprovalSentDate")}>
                    DA Sent{sortIndicator("designApprovalSentDate")}
                  </th>
                  <th className="pb-2 pr-4 text-right cursor-pointer hover:text-foreground" onClick={() => handleSort("amount")}>
                    Amount{sortIndicator("amount")}
                  </th>
                  <th className="pb-2 text-right cursor-pointer hover:text-foreground" onClick={() => handleSort("daysStale")}>
                    Days Stale{sortIndicator("daysStale")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {staleProjects.map((p) => (
                  <tr key={p.id} className="border-b border-t-border/50 hover:bg-surface-2/50">
                    <td className="py-2 pr-4">
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 hover:underline">
                          {p.name}
                        </a>
                      ) : (
                        <span className="text-foreground">{p.name}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-muted">{p.designStatus || "\u2014"}</td>
                    <td className="py-2 pr-4 text-muted">{p.layoutStatus || "\u2014"}</td>
                    <td className="py-2 pr-4 text-muted">{p.stage || "\u2014"}</td>
                    <td className="py-2 pr-4 text-muted">{p.designLead || "Unknown"}</td>
                    <td className="py-2 pr-4 text-muted">{p.pbLocation || "\u2014"}</td>
                    <td className="py-2 pr-4 text-muted">{p.designDraftDate || "\u2014"}</td>
                    <td className="py-2 pr-4 text-muted">{p.designApprovalSentDate || "\u2014"}</td>
                    <td className="py-2 pr-4 text-right text-foreground">{formatMoney(p.amount || 0)}</td>
                    <td className="py-2 text-right">
                      <span className={`font-semibold ${p.daysStale > 30 ? "text-red-400" : p.daysStale > 14 ? "text-yellow-400" : "text-foreground"}`}>
                        {p.daysStale}d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="mb-6 bg-surface border border-t-border rounded-xl p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">D&E Dashboards</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 stagger-grid">
          {SUB_DASHBOARDS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="group border border-t-border rounded-lg p-4 hover:border-purple-500/50 hover:bg-surface-2/50 transition-all"
            >
              <span className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 mb-2">
                {d.tag}
              </span>
              <div className="text-sm font-medium text-foreground group-hover:text-purple-400 transition-colors">
                {d.title} →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
