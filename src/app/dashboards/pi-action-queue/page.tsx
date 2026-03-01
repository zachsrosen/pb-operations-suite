"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import {
  PERMIT_ACTION_STATUSES,
  IC_ACTION_STATUSES,
  PTO_ACTION_STATUSES,
  STALE_THRESHOLD_DAYS,
} from "@/lib/pi-statuses";

type ActionType = "permit" | "interconnection" | "pto" | "stale";
type SortField = "name" | "type" | "daysInStatus" | "amount";
type SortDir = "asc" | "desc";

interface ActionItem {
  project: RawProject;
  type: ActionType;
  status: string;
  action: string;
  daysInStatus: number;
  isStale: boolean;
}

export default function PIActionQueuePage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  const [sortField, setSortField] = useState<SortField>("daysInStatus");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterType, setFilterType] = useState<ActionType | "all">("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [leadFilter, setLeadFilter] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("pi-action-queue", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  const locations = useMemo(() => {
    const locs = new Set<string>();
    safeProjects.forEach((p) => { if (p.pbLocation) locs.add(p.pbLocation); });
    return Array.from(locs).sort();
  }, [safeProjects]);

  const leads = useMemo(() => {
    const names = new Set<string>();
    safeProjects.forEach((p) => {
      if (p.permitLead) names.add(p.permitLead);
      if (p.interconnectionsLead) names.add(p.interconnectionsLead);
      if (p.projectManager) names.add(p.projectManager);
    });
    return Array.from(names).sort();
  }, [safeProjects]);

  const stages = useMemo(() => {
    const s = new Set<string>();
    safeProjects.forEach((p) => { if (p.stage) s.add(p.stage); });
    return Array.from(s).sort();
  }, [safeProjects]);

  const filteredProjects = useMemo(() => {
    let result = safeProjects;
    if (locationFilter !== "all") result = result.filter((p) => p.pbLocation === locationFilter);
    if (leadFilter !== "all") result = result.filter((p) => p.permitLead === leadFilter || p.interconnectionsLead === leadFilter || p.projectManager === leadFilter);
    if (stageFilter !== "all") result = result.filter((p) => p.stage === stageFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) =>
        (p.name?.toLowerCase().includes(q) || p.stage?.toLowerCase().includes(q) || p.pbLocation?.toLowerCase().includes(q) || p.permitLead?.toLowerCase().includes(q) || p.interconnectionsLead?.toLowerCase().includes(q) || p.projectManager?.toLowerCase().includes(q))
      );
    }
    return result;
  }, [safeProjects, locationFilter, leadFilter, stageFilter, searchQuery]);

  // Build action items
  const actionItems = useMemo(() => {
    const items: ActionItem[] = [];
    const seen = new Set<string>(); // avoid duplicates per project

    filteredProjects.forEach((p) => {
      const days = p.daysSinceStageMovement ?? 0;

      // Permit actions
      if (p.permittingStatus && PERMIT_ACTION_STATUSES[p.permittingStatus]) {
        items.push({
          project: p,
          type: "permit",
          status: p.permittingStatus,
          action: PERMIT_ACTION_STATUSES[p.permittingStatus],
          daysInStatus: days,
          isStale: days > STALE_THRESHOLD_DAYS,
        });
        seen.add(p.id);
      }

      // IC actions
      if (p.interconnectionStatus && IC_ACTION_STATUSES[p.interconnectionStatus]) {
        items.push({
          project: p,
          type: "interconnection",
          status: p.interconnectionStatus,
          action: IC_ACTION_STATUSES[p.interconnectionStatus],
          daysInStatus: days,
          isStale: days > STALE_THRESHOLD_DAYS,
        });
        seen.add(p.id);
      }

      // PTO actions
      if (p.ptoStatus && PTO_ACTION_STATUSES[p.ptoStatus]) {
        items.push({
          project: p,
          type: "pto",
          status: p.ptoStatus,
          action: PTO_ACTION_STATUSES[p.ptoStatus],
          daysInStatus: days,
          isStale: days > STALE_THRESHOLD_DAYS,
        });
        seen.add(p.id);
      }

      // Stale detection — P&I stage projects not already captured
      if (
        !seen.has(p.id) &&
        days > STALE_THRESHOLD_DAYS &&
        (p.stage === "Permitting & Interconnection" || p.stage === "Permission To Operate")
      ) {
        const statusLabel = p.permittingStatus || p.interconnectionStatus || p.ptoStatus || p.stage;
        items.push({
          project: p,
          type: "stale",
          status: statusLabel,
          action: "Follow up — stale",
          daysInStatus: days,
          isStale: true,
        });
      }
    });

    return items;
  }, [filteredProjects]);

  // Filter — stale tab shows all items where isStale is true (any type), not just type === "stale"
  const filteredItems = useMemo(() => {
    if (filterType === "all") return actionItems;
    if (filterType === "stale") return actionItems.filter((i) => i.isStale);
    return actionItems.filter((i) => i.type === filterType);
  }, [actionItems, filterType]);

  // Sort
  const sortedItems = useMemo(() => {
    const sorted = [...filteredItems];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.project.name.localeCompare(b.project.name); break;
        case "type": cmp = a.type.localeCompare(b.type); break;
        case "daysInStatus": cmp = a.daysInStatus - b.daysInStatus; break;
        case "amount": cmp = (a.project.amount || 0) - (b.project.amount || 0); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredItems, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortField(field); setSortDir("desc"); }
    },
    [sortField]
  );

  // Stats — unique project counts for total and stale; action-item counts for type tabs
  const stats = useMemo(() => {
    const byType: Record<string, number> = {};
    const uniqueProjects = new Set<string>();
    const staleProjects = new Set<string>();
    actionItems.forEach((i) => {
      byType[i.type] = (byType[i.type] || 0) + 1;
      uniqueProjects.add(i.project.id);
      if (i.isStale) staleProjects.add(i.project.id);
    });
    return { total: uniqueProjects.size, byType, staleCount: staleProjects.size };
  }, [actionItems]);

  // Export
  const exportRows = useMemo(
    () => sortedItems.map((i) => ({
      name: i.project.name,
      type: i.type,
      status: i.status,
      action: i.action,
      daysInStatus: i.daysInStatus,
      isStale: i.isStale ? "Yes" : "No",
      lead: i.project.permitLead || i.project.interconnectionsLead || "",
      location: i.project.pbLocation || "",
      ahj: i.project.ahj || "",
      utility: i.project.utility || "",
      amount: i.project.amount || 0,
    })),
    [sortedItems]
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅";

  const TYPE_COLORS: Record<string, string> = {
    permit: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    interconnection: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    pto: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    stale: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  return (
    <DashboardShell
      title="Action Queue"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "pi-action-queue.csv" }}
      fullWidth
    >
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-grid">
        <MiniStat label="Total Actions" value={loading ? null : stats.total} />
        <MiniStat label="Permit Actions" value={loading ? null : stats.byType.permit || 0} />
        <MiniStat label="IC Actions" value={loading ? null : stats.byType.interconnection || 0} />
        <MiniStat label="PTO Actions" value={loading ? null : stats.byType.pto || 0} />
        <MiniStat label="Stale (>14d)" value={loading ? null : stats.staleCount} alert={stats.staleCount > 10} />
      </div>

      {/* Location / Lead / Stage Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search project, status, or lead..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted w-full max-w-xs"
        />
        <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground">
          <option value="all">All Locations</option>
          {locations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
        </select>
        <select value={leadFilter} onChange={(e) => setLeadFilter(e.target.value)} className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground">
          <option value="all">All Leads</option>
          {leads.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground">
          <option value="all">All Stages</option>
          {stages.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "permit", "interconnection", "pto", "stale"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filterType === t
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                : "bg-surface-2/50 text-muted border border-t-border hover:text-foreground"
            }`}
          >
            {t === "all" ? "All" : t === "interconnection" ? "IC" : t.charAt(0).toUpperCase() + t.slice(1)}
            {t !== "all" && ` (${t === "stale" ? stats.staleCount : stats.byType[t] || 0})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="p-8 text-center text-muted">No action items found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Project{sortIndicator("name")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("type")}>
                    Type{sortIndicator("type")}
                  </th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Action Needed</th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("daysInStatus")}>
                    Days{sortIndicator("daysInStatus")}
                  </th>
                  <th className="p-3">Lead</th>
                  <th className="p-3">Location</th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("amount")}>
                    Amount{sortIndicator("amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item, idx) => (
                  <tr key={`${item.project.id}-${item.type}-${idx}`} className="border-b border-t-border/50 hover:bg-surface-2/50">
                    <td className="p-3">
                      {item.project.url ? (
                        <a href={item.project.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 hover:underline">
                          {item.project.name}
                        </a>
                      ) : (
                        <span className="text-foreground">{item.project.name}</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full border ${TYPE_COLORS[item.type]}`}>
                        {item.type === "interconnection" ? "IC" : item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                      </span>
                    </td>
                    <td className="p-3 text-muted text-xs">{item.status}</td>
                    <td className="p-3">
                      <span className="text-sm font-medium text-foreground">{item.action}</span>
                    </td>
                    <td className="p-3 text-right">
                      <span className={`font-semibold ${item.daysInStatus > 21 ? "text-red-400" : item.daysInStatus > STALE_THRESHOLD_DAYS ? "text-yellow-400" : "text-foreground"}`}>
                        {item.daysInStatus}d
                      </span>
                    </td>
                    <td className="p-3 text-muted">{item.project.permitLead || item.project.interconnectionsLead || "—"}</td>
                    <td className="p-3 text-muted text-xs">{item.project.pbLocation || "—"}</td>
                    <td className="p-3 text-right text-foreground">{formatMoney(item.project.amount || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
