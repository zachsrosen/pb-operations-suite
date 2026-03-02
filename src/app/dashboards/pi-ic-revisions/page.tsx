"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { usePIICRevisionsFilters } from "@/stores/dashboard-filters";
import {
  STALE_THRESHOLD_DAYS,
  getICStatusDisplayName,
} from "@/lib/pi-statuses";

type QueueState = "Ready to Resubmit" | "Resubmitted (Pending Approval)";
type SortField = "name" | "queueState" | "status" | "days" | "lead" | "pm" | "location" | "amount";
type SortDir = "asc" | "desc";

interface RevisionItem {
  project: RawProject;
  queueState: QueueState;
  status: string;
  statusLabel: string;
  lead: string;
  daysInStatus: number;
  isStale: boolean;
}

function getRevisionQueueState(status: string): QueueState | null {
  const s = status.toLowerCase();
  if (s.includes("ready to resubmit") || s.includes("returned from design")) {
    return "Ready to Resubmit";
  }
  if (s.includes("resubmitted")) {
    return "Resubmitted (Pending Approval)";
  }
  return null;
}

export default function PIICRevisionsPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  const { filters: persistedFilters, setFilters: setPersisted, clearFilters } = usePIICRevisionsFilters();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedQueueStates, setSelectedQueueStates] = useState<QueueState[]>([]);
  const [sortField, setSortField] = useState<SortField>("days");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("pi-ic-revisions", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  const locationOptions: FilterOption[] = useMemo(() => {
    const locs = new Set<string>();
    safeProjects.forEach((p) => { if (p.pbLocation) locs.add(p.pbLocation); });
    return Array.from(locs).sort().map((loc) => ({ value: loc, label: loc }));
  }, [safeProjects]);

  const icLeadOptions: FilterOption[] = useMemo(() => {
    const names = new Set<string>();
    safeProjects.forEach((p) => { names.add(p.interconnectionsLead || "Unknown"); });
    return Array.from(names).sort().map((name) => ({ value: name, label: name }));
  }, [safeProjects]);

  const queueStateOptions: FilterOption[] = useMemo(
    () => [
      { value: "Ready to Resubmit", label: "Ready to Resubmit" },
      { value: "Resubmitted (Pending Approval)", label: "Resubmitted (Pending Approval)" },
    ],
    []
  );

  const hasActiveFilters =
    persistedFilters.locations.length > 0 ||
    persistedFilters.icLeads.length > 0 ||
    selectedQueueStates.length > 0 ||
    searchQuery.trim().length > 0;

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
          !p.interconnectionStatus?.toLowerCase().includes(q) &&
          !p.interconnectionsLead?.toLowerCase().includes(q)
        ) continue;
      }
      result.push(p);
    }
    return result;
  }, [safeProjects, persistedFilters, searchQuery]);

  const revisionItems = useMemo(() => {
    const items: RevisionItem[] = [];

    filteredProjects.forEach((p) => {
      const daysInStatus = p.daysSinceStageMovement ?? 0;
      const icStatus = p.interconnectionStatus || "";
      if (icStatus) {
        const icQueueState = getRevisionQueueState(icStatus);
        if (icQueueState) {
          items.push({
            project: p,
            queueState: icQueueState,
            status: icStatus,
            statusLabel: getICStatusDisplayName(icStatus),
            lead: p.interconnectionsLead || "Unknown",
            daysInStatus,
            isStale: daysInStatus > STALE_THRESHOLD_DAYS,
          });
        }
      }
    });

    let filtered = items;
    if (selectedQueueStates.length > 0) {
      filtered = filtered.filter((item) => selectedQueueStates.includes(item.queueState));
    }

    return filtered;
  }, [filteredProjects, selectedQueueStates]);

  const sortedItems = useMemo(() => {
    const sorted = [...revisionItems];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = (a.project.name || "").localeCompare(b.project.name || ""); break;
        case "queueState": cmp = a.queueState.localeCompare(b.queueState); break;
        case "status": cmp = a.statusLabel.localeCompare(b.statusLabel); break;
        case "days": cmp = a.daysInStatus - b.daysInStatus; break;
        case "lead": cmp = a.lead.localeCompare(b.lead); break;
        case "pm": cmp = (a.project.projectManager || "Unknown").localeCompare(b.project.projectManager || "Unknown"); break;
        case "location": cmp = (a.project.pbLocation || "").localeCompare(b.project.pbLocation || ""); break;
        case "amount": cmp = (a.project.amount || 0) - (b.project.amount || 0); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [revisionItems, sortField, sortDir]);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }, [sortField]);

  const sortIndicator = (field: SortField) => (
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅"
  );

  const stats = useMemo(() => {
    const readyCount = revisionItems.filter((item) => item.queueState === "Ready to Resubmit").length;
    const resubmittedCount = revisionItems.filter((item) => item.queueState === "Resubmitted (Pending Approval)").length;
    const staleCount = revisionItems.filter((item) => item.isStale).length;
    return { total: revisionItems.length, readyCount, resubmittedCount, staleCount };
  }, [revisionItems]);

  const exportRows = useMemo(
    () => sortedItems.map((item) => ({
      name: item.project.name,
      queueState: item.queueState,
      status: item.statusLabel,
      statusRaw: item.status,
      daysInStatus: item.daysInStatus,
      stale: item.isStale ? "Yes" : "No",
      icLead: item.lead,
      projectManager: item.project.projectManager || "Unknown",
      location: item.project.pbLocation || "",
      utility: item.project.utility || "",
      amount: item.project.amount || 0,
      stage: item.project.stage || "",
    })),
    [sortedItems]
  );

  return (
    <DashboardShell
      title="IC Revisions"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "pi-ic-revisions.csv" }}
      fullWidth
    >
      {/* Cross-nav */}
      <div className="flex items-center gap-2 text-sm mb-4">
        <span className="text-muted">View:</span>
        <Link href="/dashboards/pi-permit-revisions" className="text-cyan-400 hover:underline">Permit</Link>
        <span className="text-muted">|</span>
        <span className="text-foreground font-medium">IC</span>
        <span className="text-muted">|</span>
        <Link href="/dashboards/pi-revisions" className="text-cyan-400 hover:underline">All Pipelines</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid mb-6">
        <MiniStat label="Queue Items" value={loading ? null : stats.total} />
        <MiniStat label="Ready to Resubmit" value={loading ? null : stats.readyCount} />
        <MiniStat label="Resubmitted Pending" value={loading ? null : stats.resubmittedCount} />
        <MiniStat label={`Stale (>${STALE_THRESHOLD_DAYS}d)`} value={loading ? null : stats.staleCount} alert={stats.staleCount > 5} />
      </div>

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
        <MultiSelectFilter
          label="Queue State"
          options={queueStateOptions}
          selected={selectedQueueStates}
          onChange={(v) => setSelectedQueueStates(v as QueueState[])}
          accentColor="cyan"
        />
        {hasActiveFilters && (
          <button
            onClick={() => {
              clearFilters();
              setSelectedQueueStates([]);
              setSearchQuery("");
            }}
            className="text-xs px-2 py-1 text-red-400 hover:text-red-300"
          >
            Clear All
          </button>
        )}
      </div>

      <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden mb-6">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="p-8 text-center text-muted">No IC revision items found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Project{sortIndicator("name")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("queueState")}>
                    Queue State{sortIndicator("queueState")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("status")}>
                    Status{sortIndicator("status")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("days")}>
                    Days{sortIndicator("days")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("lead")}>
                    IC Lead{sortIndicator("lead")}
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
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full border ${
                          item.queueState === "Ready to Resubmit"
                            ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                            : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                        }`}
                      >
                        {item.queueState}
                      </span>
                    </td>
                    <td className="p-3 text-muted text-xs">{item.statusLabel}</td>
                    <td className="p-3 text-right">
                      <span className={`font-semibold ${item.daysInStatus > 21 ? "text-red-400" : item.daysInStatus > STALE_THRESHOLD_DAYS ? "text-yellow-400" : "text-foreground"}`}>
                        {item.daysInStatus}d
                      </span>
                    </td>
                    <td className="p-3 text-muted text-xs">{item.lead}</td>
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
