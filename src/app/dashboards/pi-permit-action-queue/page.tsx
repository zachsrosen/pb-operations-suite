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
import { usePIPermitActionQueueFilters } from "@/stores/dashboard-filters";
import {
  getPermitAction,
  getPermitStatusDisplayName,
  isPermitActiveStatus,
  STALE_THRESHOLD_DAYS,
} from "@/lib/pi-statuses";

type SortField = "name" | "status" | "action" | "daysInStatus" | "permitLead" | "pm" | "location" | "amount";
type SortDir = "asc" | "desc";

interface ActionItem {
  project: RawProject;
  status: string;
  action: string;
  daysInStatus: number;
  isStale: boolean;
}

export default function PIPermitActionQueuePage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  const [sortField, setSortField] = useState<SortField>("daysInStatus");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [searchQuery, setSearchQuery] = useState("");

  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = usePIPermitActionQueueFilters();

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("pi-permit-action-queue", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  const locationOptions: FilterOption[] = useMemo(() => {
    const locs = new Set<string>();
    safeProjects.forEach((p) => { if (p.pbLocation) locs.add(p.pbLocation); });
    return Array.from(locs).sort().map(loc => ({ value: loc, label: loc }));
  }, [safeProjects]);

  const permitLeadOptions: FilterOption[] = useMemo(() => {
    const names = new Set<string>();
    safeProjects.forEach((p) => { names.add(p.permitLead || "Unknown"); });
    return Array.from(names).sort().map(name => ({ value: name, label: name }));
  }, [safeProjects]);

  const filteredProjects = useMemo(() => {
    const result: RawProject[] = [];
    for (const p of safeProjects) {
      if (persistedFilters.locations.length > 0 && !persistedFilters.locations.includes(p.pbLocation || "")) continue;
      if (persistedFilters.permitLeads.length > 0 && !persistedFilters.permitLeads.includes(p.permitLead || "Unknown")) continue;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (
          !p.name?.toLowerCase().includes(q) &&
          !p.pbLocation?.toLowerCase().includes(q) &&
          !p.permitLead?.toLowerCase().includes(q) &&
          !p.permittingStatus?.toLowerCase().includes(q)
        ) continue;
      }
      result.push(p);
    }
    return result;
  }, [safeProjects, persistedFilters, searchQuery]);

  // Build permit-only action items
  const actionItems = useMemo(() => {
    const items: ActionItem[] = [];
    const seen = new Set<string>();

    filteredProjects.forEach((p) => {
      const days = p.daysSinceStageMovement ?? 0;

      const permitAction = getPermitAction(p.permittingStatus);
      if (p.permittingStatus && permitAction) {
        items.push({
          project: p,
          status: getPermitStatusDisplayName(p.permittingStatus),
          action: permitAction,
          daysInStatus: days,
          isStale: days > STALE_THRESHOLD_DAYS,
        });
        seen.add(p.id);
      }

      // Stale detection — permit-stage projects not already captured
      if (
        !seen.has(p.id) &&
        days > STALE_THRESHOLD_DAYS &&
        p.permittingStatus &&
        isPermitActiveStatus(p.permittingStatus)
      ) {
        items.push({
          project: p,
          status: getPermitStatusDisplayName(p.permittingStatus),
          action: "Follow up — stale",
          daysInStatus: days,
          isStale: true,
        });
      }
    });

    return items;
  }, [filteredProjects]);

  // Sort
  const sortedItems = useMemo(() => {
    const sorted = [...actionItems];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.project.name.localeCompare(b.project.name); break;
        case "status": cmp = a.status.localeCompare(b.status); break;
        case "action": cmp = a.action.localeCompare(b.action); break;
        case "daysInStatus": cmp = a.daysInStatus - b.daysInStatus; break;
        case "permitLead": cmp = (a.project.permitLead || "").localeCompare(b.project.permitLead || ""); break;
        case "pm": cmp = (a.project.projectManager || "").localeCompare(b.project.projectManager || ""); break;
        case "location": cmp = (a.project.pbLocation || "").localeCompare(b.project.pbLocation || ""); break;
        case "amount": cmp = (a.project.amount || 0) - (b.project.amount || 0); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [actionItems, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortField(field); setSortDir("desc"); }
    },
    [sortField]
  );

  const stats = useMemo(() => {
    const uniqueProjects = new Set<string>();
    const staleProjects = new Set<string>();
    const actionCounts: Record<string, number> = {};
    actionItems.forEach((i) => {
      uniqueProjects.add(i.project.id);
      if (i.isStale) staleProjects.add(i.project.id);
      actionCounts[i.action] = (actionCounts[i.action] || 0) + 1;
    });
    return { total: uniqueProjects.size, staleCount: staleProjects.size, actionCounts };
  }, [actionItems]);

  const exportRows = useMemo(
    () => sortedItems.map((i) => ({
      name: i.project.name,
      status: i.status,
      action: i.action,
      daysInStatus: i.daysInStatus,
      isStale: i.isStale ? "Yes" : "No",
      permitLead: i.project.permitLead || "",
      projectManager: i.project.projectManager || "",
      location: i.project.pbLocation || "",
      ahj: i.project.ahj || "",
      amount: i.project.amount || 0,
    })),
    [sortedItems]
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅";

  const hasActiveFilters = persistedFilters.locations.length > 0 || persistedFilters.permitLeads.length > 0 || searchQuery.trim().length > 0;

  return (
    <DashboardShell
      title="Permit Action Queue"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "pi-permit-action-queue.csv" }}
      fullWidth
    >
      {/* Cross-nav */}
      <div className="flex items-center gap-2 text-sm mb-4">
        <span className="text-muted">View:</span>
        <span className="text-foreground font-medium">Permit</span>
        <span className="text-muted">|</span>
        <Link href="/dashboards/pi-ic-action-queue" className="text-cyan-400 hover:underline">IC & PTO</Link>
        <span className="text-muted">|</span>
        <Link href="/dashboards/pi-action-queue" className="text-cyan-400 hover:underline">All Pipelines</Link>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 stagger-grid mb-6">
        <MiniStat label="Total Items" value={loading ? null : stats.total} />
        <MiniStat label="Action Items" value={loading ? null : actionItems.length} />
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
          label="Permit Lead"
          options={permitLeadOptions}
          selected={persistedFilters.permitLeads}
          onChange={(v) => setPersisted({ ...persistedFilters, permitLeads: v })}
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

      {/* Table */}
      <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden mb-6">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="p-8 text-center text-muted">No permit action items found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Project{sortIndicator("name")}
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
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("permitLead")}>
                    Permit Lead{sortIndicator("permitLead")}
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
                  <tr key={`${item.project.id}-${idx}`} className="border-b border-t-border/50 hover:bg-surface-2/50">
                    <td className="p-3">
                      {item.project.url ? (
                        <a href={item.project.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 hover:underline">
                          {item.project.name}
                        </a>
                      ) : (
                        <span className="text-foreground">{item.project.name}</span>
                      )}
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
                    <td className="p-3 text-muted text-xs">{item.project.permitLead || "Unknown"}</td>
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
