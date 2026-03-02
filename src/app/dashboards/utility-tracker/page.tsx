"use client";

import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useUtilityTrackerFilters } from "@/stores/dashboard-filters";
import {
  isICActiveStatus,
  isPTOPipelineStatus,
  getICStatusDisplayName,
  getPTOStatusDisplayName,
} from "@/lib/pi-statuses";

// ---- Types ----

interface UtilityRecord {
  id: string;
  properties: Record<string, string | null>;
}

type SortField = "name" | "dealCount" | "activeIC" | "ptoPipeline" | "icTurnaround" | "revenue";
type DrillSortField = "name" | "stage" | "icStatus" | "ptoStatus" | "lead" | "days" | "amount";
type SortDir = "asc" | "desc";

export default function UtilityTrackerPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading: projectsLoading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  // Fetch Utility custom object data
  const [utilities, setUtilities] = useState<UtilityRecord[]>([]);
  const [utilLoading, setUtilLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchUtilities() {
      try {
        const res = await fetch("/api/utility");
        if (!res.ok) throw new Error("Failed to fetch Utilities");
        const data = await res.json();
        if (!cancelled) setUtilities(data.utilities || []);
      } catch (err) {
        console.error("Utility fetch error:", err);
      } finally {
        if (!cancelled) setUtilLoading(false);
      }
    }
    fetchUtilities();
    return () => { cancelled = true; };
  }, []);

  const loading = projectsLoading || utilLoading;

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("utility-tracker", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  const [sortField, setSortField] = useState<SortField>("dealCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [drillSortField, setDrillSortField] = useState<DrillSortField | null>(null);
  const [drillSortDir, setDrillSortDir] = useState<SortDir>("asc");
  const [expandedUtility, setExpandedUtility] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Persisted multi-select filters
  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = useUtilityTrackerFilters();

  const locationOptions: FilterOption[] = useMemo(() => {
    const locs = new Set<string>();
    safeProjects.forEach((p) => { if (p.pbLocation) locs.add(p.pbLocation); });
    return Array.from(locs).sort().map((loc) => ({ value: loc, label: loc }));
  }, [safeProjects]);

  const leadOptions: FilterOption[] = useMemo(() => {
    const names = new Set<string>();
    safeProjects.forEach((p) => {
      if (p.interconnectionsLead) names.add(p.interconnectionsLead);
    });
    return Array.from(names).sort().map((name) => ({ value: name, label: name }));
  }, [safeProjects]);

  const stageOptions: FilterOption[] = useMemo(() => {
    const s = new Set<string>();
    safeProjects.forEach((p) => { if (p.stage) s.add(p.stage); });
    return Array.from(s).sort().map((stage) => ({ value: stage, label: stage }));
  }, [safeProjects]);

  const hasActiveFilters = persistedFilters.locations.length > 0 ||
    persistedFilters.leads.length > 0 ||
    persistedFilters.stages.length > 0 ||
    searchQuery.trim().length > 0;

  const filteredProjects = useMemo(() => {
    const result: RawProject[] = [];
    for (const p of safeProjects) {
      if (persistedFilters.locations.length > 0 && !persistedFilters.locations.includes(p.pbLocation || "")) continue;
      if (persistedFilters.leads.length > 0 && !persistedFilters.leads.includes(p.interconnectionsLead || "")) continue;
      if (persistedFilters.stages.length > 0 && !persistedFilters.stages.includes(p.stage || "")) continue;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!(p.name?.toLowerCase().includes(q) || p.utility?.toLowerCase().includes(q) || p.stage?.toLowerCase().includes(q) || p.pbLocation?.toLowerCase().includes(q) || p.interconnectionsLead?.toLowerCase().includes(q))) continue;
      }
      result.push(p);
    }
    return result;
  }, [safeProjects, persistedFilters, searchQuery]);

  // Group projects by utility (case-insensitive)
  const projectsByUtility = useMemo(() => {
    const map: Record<string, { display: string; projects: RawProject[] }> = {};
    filteredProjects.forEach((p) => {
      const util = p.utility?.trim();
      if (util) {
        const key = util.toLowerCase();
        if (!map[key]) map[key] = { display: util, projects: [] };
        map[key].projects.push(p);
      }
    });
    return map;
  }, [filteredProjects]);

  // Utility custom object records by name
  const utilityByKey = useMemo(() => {
    const map: Record<string, { display: string; record: UtilityRecord }> = {};
    utilities.forEach((u) => {
      const name = (u.properties.record_name ?? u.properties.utility_company_name)?.trim();
      if (name) map[name.toLowerCase()] = { display: name, record: u };
    });
    return map;
  }, [utilities]);

  // Build merged utility rows
  const utilityRows = useMemo(() => {
    const allKeys = new Set([
      ...Object.keys(projectsByUtility),
      ...Object.keys(utilityByKey),
    ]);

    return Array.from(allKeys).map((key) => {
      const dealEntry = projectsByUtility[key];
      const recordEntry = utilityByKey[key];
      const deals = dealEntry?.projects || [];
      const record = recordEntry?.record;
      const name = recordEntry?.display || dealEntry?.display || key;

      const activeIC = deals.filter(
        (p) => isICActiveStatus(p.interconnectionStatus)
      ).length;
      const ptoPipeline = deals.filter(
        (p) => isPTOPipelineStatus(p.ptoStatus)
      ).length;
      const revenue = deals.reduce((s, p) => s + (p.amount || 0), 0);

      // From custom object
      const icTurnaroundMs = parseFloat(record?.properties.interconnection_turnaround_average__365_days_ || "0") || 0;
      const icTurnaround = icTurnaroundMs > 0 ? Math.round(icTurnaroundMs / 86_400_000) : 0;
      const rejections = parseInt(record?.properties.rejection_count || "0", 10) || 0;
      const approvals = parseInt(record?.properties.utility_approval_count || "0", 10) || 0;

      return {
        key,
        name,
        record,
        deals,
        dealCount: deals.length,
        activeIC,
        ptoPipeline,
        revenue,
        icTurnaround,
        rejections,
        approvals,
        state: record?.properties.state || null,
        serviceArea: record?.properties.service_area || null,
      };
    });
  }, [projectsByUtility, utilityByKey]);

  // Only rows with deals
  const rowsWithDeals = useMemo(() => utilityRows.filter((r) => r.dealCount > 0), [utilityRows]);

  // Average IC turnaround for bottleneck detection
  const avgIcTurnaround = useMemo(() => {
    const withData = rowsWithDeals.filter((r) => r.icTurnaround > 0);
    return withData.length > 0
      ? withData.reduce((s, r) => s + r.icTurnaround, 0) / withData.length
      : 0;
  }, [rowsWithDeals]);

  // Sort
  const sortedRows = useMemo(() => {
    const sorted = [...rowsWithDeals];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "dealCount": cmp = a.dealCount - b.dealCount; break;
        case "activeIC": cmp = a.activeIC - b.activeIC; break;
        case "ptoPipeline": cmp = a.ptoPipeline - b.ptoPipeline; break;
        case "icTurnaround": cmp = a.icTurnaround - b.icTurnaround; break;
        case "revenue": cmp = a.revenue - b.revenue; break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rowsWithDeals, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortField(field); setSortDir("desc"); }
    },
    [sortField]
  );

  const handleDrillSort = useCallback(
    (field: DrillSortField) => {
      if (drillSortField === field) setDrillSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setDrillSortField(field); setDrillSortDir("asc"); }
    },
    [drillSortField]
  );

  const drillSortIndicator = useCallback((field: DrillSortField) => {
    if (drillSortField !== field) return " \u21C5";
    return drillSortDir === "asc" ? " \u2191" : " \u2193";
  }, [drillSortField, drillSortDir]);

  const sortDeals = useCallback((deals: RawProject[]) => {
    if (!drillSortField) return deals;
    const sorted = [...deals];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (drillSortField) {
        case "name": cmp = (a.name || "").localeCompare(b.name || ""); break;
        case "stage": cmp = (a.stage || "").localeCompare(b.stage || ""); break;
        case "icStatus": cmp = (a.interconnectionStatus || "").localeCompare(b.interconnectionStatus || ""); break;
        case "ptoStatus": cmp = (a.ptoStatus || "").localeCompare(b.ptoStatus || ""); break;
        case "lead": cmp = (a.interconnectionsLead || "").localeCompare(b.interconnectionsLead || ""); break;
        case "days": cmp = (a.daysSinceStageMovement ?? 0) - (b.daysSinceStageMovement ?? 0); break;
        case "amount": cmp = (a.amount || 0) - (b.amount || 0); break;
      }
      return drillSortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [drillSortField, drillSortDir]);

  // Hero stats
  const stats = useMemo(() => {
    const utilitiesWithDeals = rowsWithDeals.length;
    const totalActiveIC = rowsWithDeals.reduce((s, r) => s + r.activeIC, 0);
    const totalPtoPipeline = rowsWithDeals.reduce((s, r) => s + r.ptoPipeline, 0);
    const withTurnaround = rowsWithDeals.filter((r) => r.icTurnaround > 0);
    const avgTurnaround = withTurnaround.length > 0
      ? Math.round(withTurnaround.reduce((s, r) => s + r.icTurnaround, 0) / withTurnaround.length)
      : 0;
    return { utilitiesWithDeals, totalActiveIC, totalPtoPipeline, avgTurnaround };
  }, [rowsWithDeals]);

  // Export
  const exportRows = useMemo(
    () => sortedRows.map((r) => ({
      name: r.name,
      state: r.state || "",
      serviceArea: r.serviceArea || "",
      dealCount: r.dealCount,
      activeIC: r.activeIC,
      ptoPipeline: r.ptoPipeline,
      icTurnaround: r.icTurnaround || "",
      rejections: r.rejections,
      approvals: r.approvals,
      revenue: r.revenue,
    })),
    [sortedRows]
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅";

  return (
    <DashboardShell
      title="Utility Tracker"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "utility-tracker.csv" }}
      fullWidth
    >
      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid mb-6">
        <StatCard
          label="Utilities with Deals"
          value={loading ? null : stats.utilitiesWithDeals}
          color="cyan"
        />
        <StatCard
          label="Active IC Apps"
          value={loading ? null : stats.totalActiveIC}
          color="blue"
        />
        <StatCard
          label="PTO Pipeline"
          value={loading ? null : stats.totalPtoPipeline}
          color="emerald"
        />
        <StatCard
          label="Avg IC Turnaround"
          value={loading ? null : stats.avgTurnaround > 0 ? `${stats.avgTurnaround}d` : "—"}
          color="purple"
        />
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center mb-6">
        <input
          type="text"
          placeholder="Search utility, project, or status..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted w-full max-w-xs"
        />
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={persistedFilters.locations}
          onChange={(v) => setPersisted({ ...persistedFilters, locations: v })}
          accentColor="cyan"
        />
        <MultiSelectFilter
          label="Lead"
          options={leadOptions}
          selected={persistedFilters.leads}
          onChange={(v) => setPersisted({ ...persistedFilters, leads: v })}
          accentColor="cyan"
        />
        <MultiSelectFilter
          label="Stage"
          options={stageOptions}
          selected={persistedFilters.stages}
          onChange={(v) => setPersisted({ ...persistedFilters, stages: v })}
          accentColor="cyan"
        />
        {hasActiveFilters && (
          <button
            onClick={() => { clearFilters(); setSearchQuery(""); }}
            className="px-3 py-2 rounded-lg text-sm text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Utility Table */}
      <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="p-8 text-center text-muted">No utility data with active deals.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Utility{sortIndicator("name")}
                  </th>
                  <th className="p-3">Location</th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("dealCount")}>
                    Deals{sortIndicator("dealCount")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("activeIC")}>
                    Active IC{sortIndicator("activeIC")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("ptoPipeline")}>
                    PTO Pipeline{sortIndicator("ptoPipeline")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("icTurnaround")}>
                    IC Turnaround{sortIndicator("icTurnaround")}
                  </th>
                  <th className="p-3 text-right">Rejections</th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("revenue")}>
                    Revenue{sortIndicator("revenue")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const isBottleneck = row.icTurnaround > 0 && avgIcTurnaround > 0 && row.icTurnaround > avgIcTurnaround;
                  return (
                    <Fragment key={row.key}>
                      <tr
                        className={`border-b border-t-border/50 hover:bg-surface-2/50 cursor-pointer ${isBottleneck ? "bg-red-500/5" : ""}`}
                        onClick={() => setExpandedUtility(expandedUtility === row.key ? null : row.key)}
                      >
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-muted text-xs">{expandedUtility === row.key ? "▼" : "▶"}</span>
                            <span className="text-foreground font-medium">{row.name}</span>
                            {isBottleneck && (
                              <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-500/20 text-red-400 border border-red-500/30">
                                Slow
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-muted text-xs">
                          {[row.state, row.serviceArea].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="p-3 text-right text-foreground">{row.dealCount}</td>
                        <td className="p-3 text-right text-foreground">{row.activeIC}</td>
                        <td className="p-3 text-right text-foreground">{row.ptoPipeline}</td>
                        <td className="p-3 text-right">
                          <span className={`font-semibold ${row.icTurnaround > 60 ? "text-red-400" : row.icTurnaround > 45 ? "text-yellow-400" : "text-foreground"}`}>
                            {row.icTurnaround > 0 ? `${row.icTurnaround}d` : "—"}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <span className={row.rejections > 5 ? "text-red-400 font-semibold" : "text-muted"}>
                            {row.rejections}
                          </span>
                        </td>
                        <td className="p-3 text-right text-foreground">{formatMoney(row.revenue)}</td>
                      </tr>
                      {/* Drill-down */}
                      {expandedUtility === row.key && row.deals.length > 0 && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <div className="bg-surface-2/30 border-t border-t-border/30 p-4">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left text-muted text-xs">
                                    <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleDrillSort("name")}>
                                      Project{drillSortIndicator("name")}
                                    </th>
                                    <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleDrillSort("stage")}>
                                      Stage{drillSortIndicator("stage")}
                                    </th>
                                    <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleDrillSort("icStatus")}>
                                      IC Status{drillSortIndicator("icStatus")}
                                    </th>
                                    <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleDrillSort("ptoStatus")}>
                                      PTO Status{drillSortIndicator("ptoStatus")}
                                    </th>
                                    <th className="pb-2 pr-4 cursor-pointer hover:text-foreground" onClick={() => handleDrillSort("lead")}>
                                      Lead{drillSortIndicator("lead")}
                                    </th>
                                    <th className="pb-2 pr-4 text-right cursor-pointer hover:text-foreground" onClick={() => handleDrillSort("days")}>
                                      Days in Stage{drillSortIndicator("days")}
                                    </th>
                                    <th className="pb-2 text-right cursor-pointer hover:text-foreground" onClick={() => handleDrillSort("amount")}>
                                      Amount{drillSortIndicator("amount")}
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortDeals(row.deals).map((p) => (
                                    <tr key={p.id} className="border-t border-t-border/20">
                                      <td className="py-2 pr-4">
                                        {p.url ? (
                                          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 hover:underline">
                                            {p.name}
                                          </a>
                                        ) : (
                                          <span className="text-foreground">{p.name}</span>
                                        )}
                                      </td>
                                      <td className="py-2 pr-4 text-muted">{p.stage}</td>
                                      <td className="py-2 pr-4 text-muted text-xs">{getICStatusDisplayName(p.interconnectionStatus) || "—"}</td>
                                      <td className="py-2 pr-4 text-muted text-xs">{getPTOStatusDisplayName(p.ptoStatus) || "—"}</td>
                                      <td className="py-2 pr-4 text-muted">{p.interconnectionsLead || "Unknown"}</td>
                                      <td className="py-2 pr-4 text-right">
                                        <span className={`font-semibold ${(p.daysSinceStageMovement ?? 0) > 21 ? "text-red-400" : (p.daysSinceStageMovement ?? 0) > 14 ? "text-yellow-400" : "text-foreground"}`}>
                                          {p.daysSinceStageMovement ?? 0}d
                                        </span>
                                      </td>
                                      <td className="py-2 text-right text-foreground">{formatMoney(p.amount || 0)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
