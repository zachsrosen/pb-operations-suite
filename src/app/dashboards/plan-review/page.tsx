"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { formatMoney, formatDate } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { usePlanReviewFilters } from "@/stores/dashboard-filters";

// ---- Types ----

interface FullEquipment {
  modules: { brand: string; model: string; count: number; wattage: number };
  inverter: { brand: string; model: string; count: number; sizeKwac: number };
  battery: { brand: string; model: string; count: number; sizeKwh: number; expansionCount: number };
  evCount: number;
  systemSizeKwdc: number;
  systemSizeKwac: number;
}

// Statuses that indicate "in review" (raw HubSpot designStatus values)
const REVIEW_STATUSES = [
  "Initial Review",           // Initial design review
  "Ready for Review",         // Final review / stamping
  "DA Approved",              // DA approved, pending engineering
  "Submitted To Engineering", // In engineering review
];

type SortField =
  | "name"
  | "owner"
  | "reviewType"
  | "daysWaiting"
  | "dcAcRatio"
  | "ahj"
  | "location"
  | "stage"
  | "designDraftDate"
  | "designComplete"
  | "daDate"
  | "amount";
type SortDir = "asc" | "desc";

export default function PlanReviewPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  // Toggle state for system performance review
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [localOverrides, setLocalOverrides] = useState<Record<string, boolean>>({});

  const [sortField, setSortField] = useState<SortField>("daysWaiting");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Filter state
  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = usePlanReviewFilters();
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("plan-review", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  const handleTogglePerformanceReview = useCallback(
    async (project: RawProject) => {
      const current = localOverrides[project.id] ?? project.systemPerformanceReview ?? false;
      const newValue = !current;
      setTogglingIds((prev) => new Set(prev).add(project.id));
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            properties: { system_performance_review: newValue ? "true" : "false" },
          }),
        });
        if (res.ok) {
          setLocalOverrides((prev) => ({ ...prev, [project.id]: newValue }));
        }
      } catch (err) {
        console.error("Failed to update system performance review:", err);
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(project.id);
          return next;
        });
      }
    },
    [localOverrides]
  );

  // Projects in review
  const reviewProjects = useMemo(() => {
    return safeProjects.filter(
      (p) => p.designStatus && REVIEW_STATUSES.includes(p.designStatus)
    );
  }, [safeProjects]);

  // Build filter option lists from review projects
  const locationOptions: FilterOption[] = useMemo(() => {
    const locs = [...new Set(reviewProjects.map((p) => p.pbLocation).filter(Boolean))] as string[];
    return locs.sort().map((l) => ({ value: l, label: l }));
  }, [reviewProjects]);

  const ownerOptions: FilterOption[] = useMemo(() => {
    const owners = [...new Set(reviewProjects.map((p) => p.designLead || "Unknown"))] as string[];
    return owners.sort().map((o) => ({ value: o, label: o }));
  }, [reviewProjects]);

  const stageOptions: FilterOption[] = useMemo(() => {
    const stages = [...new Set(reviewProjects.map((p) => p.stage || ""))].filter(Boolean);
    return stages.sort().map((s) => ({ value: s, label: s }));
  }, [reviewProjects]);

  const hasActiveFilters =
    persistedFilters.locations.length > 0 ||
    persistedFilters.owners.length > 0 ||
    persistedFilters.stages.length > 0 ||
    searchQuery.length > 0;

  // Enrich with computed fields
  const enrichedProjects = useMemo(() => {
    return reviewProjects.map((p) => {
      const eq = p.equipment as FullEquipment | undefined;
      const dcKw = eq?.systemSizeKwdc || ((eq?.modules?.count || 0) * (eq?.modules?.wattage || 0)) / 1000;
      const acKw = eq?.systemSizeKwac || ((eq?.inverter?.count || 0) * (eq?.inverter?.sizeKwac || 0));
      const dcAcRatio = acKw > 0 ? dcKw / acKw : 0;
      const daysWaiting = p.daysSinceStageMovement ?? 0;

      const reviewType = p.designStatus === "Initial Review"
        ? "Initial Design Review"
        : p.designStatus === "Ready for Review"
        ? "Final Review / Stamping"
        : p.designStatus === "DA Approved"
        ? "DA Approved — Pending Engineering"
        : "In Engineering";

      const eqSummary = eq
        ? `${eq.modules?.count || 0}\u00d7 ${eq.modules?.wattage || 0}W, ${eq.inverter?.count || 0}\u00d7 inv`
        : "\u2014";

      return { ...p, dcAcRatio, daysWaiting, reviewType, eqSummary };
    });
  }, [reviewProjects]);

  // Filter
  const filteredProjects = useMemo(() => {
    return enrichedProjects.filter((p) => {
      // Location filter
      if (persistedFilters.locations.length > 0 && !persistedFilters.locations.includes(p.pbLocation || "")) {
        return false;
      }
      // Owner filter
      if (persistedFilters.owners.length > 0 && !persistedFilters.owners.includes(p.designLead || "Unknown")) {
        return false;
      }
      // Stage filter
      if (persistedFilters.stages.length > 0 && !persistedFilters.stages.includes(p.stage || "")) {
        return false;
      }
      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const searchable = [p.name, p.designLead, p.ahj, p.pbLocation].filter(Boolean).join(" ").toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [enrichedProjects, persistedFilters, searchQuery]);

  // Sort
  const sortedProjects = useMemo(() => {
    const sorted = [...filteredProjects];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "owner": cmp = (a.designLead || "Unknown").localeCompare(b.designLead || "Unknown"); break;
        case "reviewType": cmp = a.reviewType.localeCompare(b.reviewType); break;
        case "daysWaiting": cmp = a.daysWaiting - b.daysWaiting; break;
        case "dcAcRatio": cmp = a.dcAcRatio - b.dcAcRatio; break;
        case "ahj": cmp = (a.ahj || "").localeCompare(b.ahj || ""); break;
        case "location": cmp = (a.pbLocation || "").localeCompare(b.pbLocation || ""); break;
        case "stage": cmp = (a.stage || "").localeCompare(b.stage || ""); break;
        case "designDraftDate": cmp = (a.designDraftDate || "").localeCompare(b.designDraftDate || ""); break;
        case "designComplete": cmp = (a.designCompletionDate || "").localeCompare(b.designCompletionDate || ""); break;
        case "daDate": cmp = (a.designApprovalDate || "").localeCompare(b.designApprovalDate || ""); break;
        case "amount": cmp = (a.amount || 0) - (b.amount || 0); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredProjects, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortField(field); setSortDir("desc"); }
    },
    [sortField]
  );

  // Stats (computed from filtered set)
  const stats = useMemo(() => {
    const initial = filteredProjects.filter((p) => p.reviewType === "Initial Design Review").length;
    const finalEng = filteredProjects.filter((p) => p.reviewType !== "Initial Design Review").length;
    const avgDays = filteredProjects.length > 0
      ? Math.round(filteredProjects.reduce((s, p) => s + p.daysWaiting, 0) / filteredProjects.length)
      : 0;
    return { initial, final: finalEng, avgDays };
  }, [filteredProjects]);

  // Export
  const exportRows = useMemo(
    () => sortedProjects.map((p) => ({
      name: p.name,
      designLead: p.designLead || "Unknown",
      reviewType: p.reviewType,
      designStatus: p.designStatus || "",
      daysWaiting: p.daysWaiting,
      dcAcRatio: p.dcAcRatio.toFixed(2),
      equipment: p.eqSummary,
      tags: (p.tags || []).join(", "),
      ahj: p.ahj || "",
      stage: p.stage || "",
      location: p.pbLocation || "",
      designDraftDate: p.designDraftDate || "",
      amount: p.amount || 0,
      designCompletionDate: p.designCompletionDate || "",
      designApprovalDate: p.designApprovalDate || "",
      systemPerformanceReview: (localOverrides[p.id] ?? p.systemPerformanceReview) ? "Yes" : "No",
    })),
    [sortedProjects, localOverrides]
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " \u2191" : " \u2193") : " \u21C5";

  return (
    <DashboardShell
      title="Plan Review Queue"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "plan-review-queue.csv" }}
      fullWidth
    >
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 stagger-grid mb-6">
        <MiniStat label="Initial Design Review" value={loading ? null : stats.initial} />
        <MiniStat label="Final / Engineering" value={loading ? null : stats.final} />
        <MiniStat label="Avg Days Waiting" value={loading ? null : `${stats.avgDays}d`} alert={stats.avgDays > 14} />
      </div>

      {/* Filters */}
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
            placeholder="Search by PROJ #, name, or AHJ..."
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
          label="Lead"
          options={ownerOptions}
          selected={persistedFilters.owners}
          onChange={(v) => setPersisted({ ...persistedFilters, owners: v })}
          accentColor="indigo"
        />

        <MultiSelectFilter
          label="Deal Stage"
          options={stageOptions}
          selected={persistedFilters.stages}
          onChange={(v) => setPersisted({ ...persistedFilters, stages: v })}
          accentColor="indigo"
        />

        {hasActiveFilters && (
          <button
            onClick={() => { clearFilters(); setSearchQuery(""); }}
            className="text-xs px-3 py-2 text-muted hover:text-foreground border border-t-border rounded-lg hover:bg-surface-2 transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden mb-6">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="p-8 text-center text-muted">
            {hasActiveFilters ? "No projects match the current filters." : "No projects currently in plan review."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Project{sortIndicator("name")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("owner")}>
                    Design Lead{sortIndicator("owner")}
                  </th>
                  <th className="p-3">Reviews</th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("reviewType")}>
                    Review Type{sortIndicator("reviewType")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("daysWaiting")}>
                    Days Waiting{sortIndicator("daysWaiting")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("dcAcRatio")}>
                    DC/AC{sortIndicator("dcAcRatio")}
                  </th>
                  <th className="p-3">Equipment</th>
                  <th className="p-3">Tags</th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("ahj")}>
                    AHJ{sortIndicator("ahj")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("stage")}>
                    Deal Stage{sortIndicator("stage")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("designDraftDate")}>
                    Draft Date{sortIndicator("designDraftDate")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("designComplete")}>
                    Design Complete{sortIndicator("designComplete")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("daDate")}>
                    DA Date{sortIndicator("daDate")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("amount")}>
                    Amount{sortIndicator("amount")}
                  </th>
                  <th className="p-3 text-center">SPR</th>
                </tr>
              </thead>
              <tbody>
                {sortedProjects.map((p) => {
                  const sprValue = localOverrides[p.id] ?? p.systemPerformanceReview ?? false;
                  const isToggling = togglingIds.has(p.id);
                  return (
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
                      <td className="p-3 text-muted">{p.designLead || "Unknown"}</td>
                      <td className="p-3">
                        <a
                          href={`/dashboards/reviews/${String(p.id)}`}
                          className="text-xs font-medium text-orange-400 hover:text-orange-300 hover:underline"
                        >
                          View
                        </a>
                      </td>
                      <td className="p-3">
                        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                          p.reviewType === "Initial Design Review"
                            ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                            : p.reviewType === "Final Review / Stamping"
                            ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                            : p.reviewType === "DA Approved — Pending Engineering"
                            ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                            : "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                        }`}>
                          {p.reviewType}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <span className={`font-semibold ${p.daysWaiting > 14 ? "text-red-400" : p.daysWaiting > 7 ? "text-yellow-400" : "text-foreground"}`}>
                          {p.daysWaiting}d
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono text-foreground">
                        {p.dcAcRatio > 0 ? p.dcAcRatio.toFixed(2) : "\u2014"}
                      </td>
                      <td className="p-3 text-muted text-xs">{p.eqSummary}</td>
                      <td className="p-3">
                        {p.tags && p.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {p.tags.map((tag) => (
                              <span key={tag} className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-surface-2 text-muted border border-t-border">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : "\u2014"}
                      </td>
                      <td className="p-3 text-muted">{p.ahj || "\u2014"}</td>
                      <td className="p-3 text-muted">{p.stage || "\u2014"}</td>
                      <td className="p-3 text-muted">{p.designDraftDate || "\u2014"}</td>
                      <td className="p-3 text-muted">{formatDate(p.designCompletionDate)}</td>
                      <td className="p-3 text-muted">{formatDate(p.designApprovalDate)}</td>
                      <td className="p-3 text-right text-foreground">{formatMoney(p.amount || 0)}</td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleTogglePerformanceReview(p)}
                          disabled={isToggling}
                          className={`w-8 h-5 rounded-full relative transition-colors ${
                            sprValue ? "bg-purple-500" : "bg-zinc-600"
                          } ${isToggling ? "opacity-50" : "cursor-pointer"}`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                              sprValue ? "translate-x-3" : ""
                            }`}
                          />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
