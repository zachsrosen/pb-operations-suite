"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { usePIICActionQueueFilters } from "@/stores/dashboard-filters";
import {
  getICAction,
  getPTOAction,
  getICStatusDisplayName,
  getPTOStatusDisplayName,
  isICActiveStatus,
  isPTOPipelineStatus,
  STALE_THRESHOLD_DAYS,
} from "@/lib/pi-statuses";

type ActionType = "interconnection" | "pto" | "stale";
type SortField = "name" | "type" | "status" | "action" | "daysInStatus" | "icLead" | "pm" | "location" | "amount";
type SortDir = "asc" | "desc";

interface ActionItem {
  project: RawProject;
  type: ActionType;
  status: string;
  action: string;
  daysInStatus: number;
  isStale: boolean;
}

export default function PIICActionQueuePage() {
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
  const [searchQuery, setSearchQuery] = useState("");

  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = usePIICActionQueueFilters();

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("pi-ic-action-queue", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  const locationOptions: FilterOption[] = useMemo(() => {
    const locs = new Set<string>();
    safeProjects.forEach((p) => { if (p.pbLocation) locs.add(p.pbLocation); });
    return Array.from(locs).sort().map(loc => ({ value: loc, label: loc }));
  }, [safeProjects]);

  const icLeadOptions: FilterOption[] = useMemo(() => {
    const names = new Set<string>();
    safeProjects.forEach((p) => { names.add(p.interconnectionsLead || "Unknown"); });
    return Array.from(names).sort().map(name => ({ value: name, label: name }));
  }, [safeProjects]);

  const filteredProjects = useMemo(() => {
    const result: RawProject[] = [];
    for (const p of safeProjects) {
      if (persistedFilters.locations.length > 0 && !persistedFilters.locations.includes(p.pbLocation || "")) continue;
      if (persistedFilters.icLeads.length > 0 && !persistedFilters.icLeads.includes(p.interconnectionsLead || "Unknown")) continue;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (
          !p.name?.toLowerCase().includes(q) &&
          !p.pbLocation?.toLowerCase().includes(q) &&
          !p.interconnectionsLead?.toLowerCase().includes(q) &&
          !p.interconnectionStatus?.toLowerCase().includes(q) &&
          !p.ptoStatus?.toLowerCase().includes(q)
        ) continue;
      }
      result.push(p);
    }
    return result;
  }, [safeProjects, persistedFilters, searchQuery]);

  // Build IC + PTO action items
  const actionItems = useMemo(() => {
    const items: ActionItem[] = [];
    const seen = new Set<string>();

    filteredProjects.forEach((p) => {
      const days = p.daysSinceStageMovement ?? 0;

      // IC actions
      const icAction = getICAction(p.interconnectionStatus);
      if (p.interconnectionStatus && icAction) {
        items.push({
          project: p,
          type: "interconnection",
          status: getICStatusDisplayName(p.interconnectionStatus),
          action: icAction,
          daysInStatus: days,
          isStale: days > STALE_THRESHOLD_DAYS,
        });
        seen.add(p.id + "-ic");
      }

      // PTO actions
      const ptoAction = getPTOAction(p.ptoStatus);
      if (p.ptoStatus && ptoAction) {
        items.push({
          project: p,
          type: "pto",
          status: getPTOStatusDisplayName(p.ptoStatus),
          action: ptoAction,
          daysInStatus: days,
          isStale: days > STALE_THRESHOLD_DAYS,
        });
        seen.add(p.id + "-pto");
      }

      // Stale detection — IC/PTO active projects not already captured
      if (days > STALE_THRESHOLD_DAYS) {
        if (!seen.has(p.id + "-ic") && p.interconnectionStatus && isICActiveStatus(p.interconnectionStatus)) {
          items.push({
            project: p,
            type: "stale",
            status: getICStatusDisplayName(p.interconnectionStatus),
            action: "Follow up — stale IC",
            daysInStatus: days,
            isStale: true,
          });
        }
        if (!seen.has(p.id + "-pto") && p.ptoStatus && isPTOPipelineStatus(p.ptoStatus)) {
          items.push({
            project: p,
            type: "stale",
            status: getPTOStatusDisplayName(p.ptoStatus),
            action: "Follow up — stale PTO",
            daysInStatus: days,
            isStale: true,
          });
        }
      }
    });

    return items;
  }, [filteredProjects]);

  // Filter by type tab
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
        case "status": cmp = a.status.localeCompare(b.status); break;
        case "action": cmp = a.action.localeCompare(b.action); break;
        case "daysInStatus": cmp = a.daysInStatus - b.daysInStatus; break;
        case "icLead": cmp = (a.project.interconnectionsLead || "").localeCompare(b.project.interconnectionsLead || ""); break;
        case "pm": cmp = (a.project.projectManager || "").localeCompare(b.project.projectManager || ""); break;
        case "location": cmp = (a.project.pbLocation || "").localeCompare(b.project.pbLocation || ""); break;
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

  const stats = useMemo(() => {
    const byType: Record<string, number> = {};
    let staleCount = 0;
    actionItems.forEach((i) => {
      byType[i.type] = (byType[i.type] || 0) + 1;
      if (i.isStale) staleCount++;
    });
    return { total: actionItems.length, byType, staleCount };
  }, [actionItems]);

  const exportRows = useMemo(
    () => sortedItems.map((i) => ({
      name: i.project.name,
      type: i.type,
      status: i.status,
      action: i.action,
      daysInStatus: i.daysInStatus,
      isStale: i.isStale ? "Yes" : "No",
      icLead: i.project.interconnectionsLead || "",
      projectManager: i.project.projectManager || "",
      location: i.project.pbLocation || "",
      utility: i.project.utility || "",
      amount: i.project.amount || 0,
    })),
    [sortedItems]
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅";

  const TYPE_COLORS: Record<string, string> = {
    interconnection: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    pto: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    stale: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const hasActiveFilters = persistedFilters.locations.length > 0 || persistedFilters.icLeads.length > 0 || searchQuery.trim().length > 0;

  return (
    <DashboardShell
      title="IC & PTO Action Queue"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "pi-ic-action-queue.csv" }}
      fullWidth
    >
      {/* Cross-nav */}
      <div className="flex items-center gap-2 text-sm mb-4">
        <span className="text-muted">View:</span>
        <Link href="/dashboards/pi-permit-action-queue" className="text-cyan-400 hover:underline">Permit</Link>
        <span className="text-muted">|</span>
        <span className="text-foreground font-medium">IC & PTO</span>
        <span className="text-muted">|</span>
        <Link href="/dashboards/pi-action-queue" className="text-cyan-400 hover:underline">All Pipelines</Link>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid mb-6">
        <MiniStat label="Total Items" value={loading ? null : stats.total} />
        <MiniStat label="IC Actions" value={loading ? null : stats.byType.interconnection || 0} />
        <MiniStat label="PTO Actions" value={loading ? null : stats.byType.pto || 0} />
        <MiniStat label={`Stale (>${STALE_THRESHOLD_DAYS}d)`} value={loading ? null : stats.staleCount} alert={stats.staleCount > 5} />
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center mb-6">
        <input
          type="text"
          placeholder="Search project, status, or lead..."
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
          label="IC Lead"
          options={icLeadOptions}
          selected={persistedFilters.icLeads}
          onChange={(v) => setPersisted({ ...persistedFilters, icLeads: v })}
          accentColor="cyan"
        />
        {hasActiveFilters && (
          <button
            onClick={() => { clearFilters(); setSearchQuery(""); }}
            className="text-xs px-2 py-1 text-red-400 hover:text-red-300"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Type tabs */}
      <div className="flex gap-2 flex-wrap mb-6">
        {(["all", "interconnection", "pto", "stale"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filterType === t
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                : "bg-surface-2/50 text-muted border border-t-border hover:text-foreground"
            }`}
          >
            {t === "all" ? "All" : t === "interconnection" ? "IC" : t === "pto" ? "PTO" : "Stale"}
            {t !== "all" && ` (${t === "stale" ? stats.staleCount : stats.byType[t] || 0})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden mb-6">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="p-8 text-center text-muted">No IC or PTO action items found.</div>
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
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("status")}>
                    Status{sortIndicator("status")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("action")}>
                    Action Needed{sortIndicator("action")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("daysInStatus")}>
                    Days{sortIndicator("daysInStatus")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("icLead")}>
                    IC Lead{sortIndicator("icLead")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("pm")}>
                    PM{sortIndicator("pm")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("location")}>
                    Location{sortIndicator("location")}
                  </th>
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
                        {item.type === "interconnection" ? "IC" : item.type === "pto" ? "PTO" : "Stale"}
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
                    <td className="p-3 text-muted text-xs">{item.project.interconnectionsLead || "Unknown"}</td>
                    <td className="p-3 text-muted text-xs">{item.project.projectManager || "Unknown"}</td>
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
