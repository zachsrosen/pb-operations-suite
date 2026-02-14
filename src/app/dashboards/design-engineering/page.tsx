"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard, MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// --------------- Types ---------------

interface Project {
  id: number;
  name: string;
  pbLocation: string;
  ahj: string;
  utility: string;
  stage: string;
  amount: number;
  url?: string;
  projectManager: string;
  operationsManager: string;
  designStatus: string | null;
  layoutStatus: string | null;
  designCompletionDate: string | null;
  designApprovalDate: string | null;
  designTurnaroundTime: number | null;
  daysSinceStageMovement: number;
}

// --------------- Constants ---------------

const CO_LOCATIONS = [
  "Westminster",
  "Centennial",
  "Colorado Springs",
  "Colorado",
];
const CA_LOCATIONS = ["San Luis Obispo", "Camarillo", "California"];

const DESIGN_STATUS_COLORS: Record<string, string> = {
  complete: "bg-green-500",
  approved: "bg-green-500",
  "in progress": "bg-blue-500",
  "design in progress": "bg-blue-500",
  "drafts complete": "bg-emerald-500",
  "design complete": "bg-emerald-500",
  awaiting: "bg-yellow-500",
  "awaiting info": "bg-yellow-500",
  "pending review": "bg-yellow-500",
  "pending approval": "bg-yellow-500",
  revisions: "bg-orange-500",
  "revisions needed": "bg-orange-500",
  "revision requested": "bg-orange-500",
  "not started": "bg-zinc-400",
  "on hold": "bg-zinc-500",
  "needs ops clarification": "bg-red-400",
};

function getStatusColor(status: string): string {
  const lower = status.toLowerCase();
  if (DESIGN_STATUS_COLORS[lower]) return DESIGN_STATUS_COLORS[lower];
  for (const [key, color] of Object.entries(DESIGN_STATUS_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return "bg-purple-400";
}

function isDesignStage(stage: string): boolean {
  const lower = stage.toLowerCase();
  return lower.includes("design");
}

function isApprovedLayout(status: string | null): boolean {
  if (!status) return false;
  const lower = status.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  return (
    lower === "approved" ||
    lower === "da approved" ||
    lower === "da_approved"
  );
}

function isDraftsComplete(status: string | null): boolean {
  if (!status) return false;
  const lower = status.toLowerCase();
  return lower.includes("drafts complete") || lower === "design complete";
}

function getStateLabel(location: string): "CO" | "CA" | "Other" {
  if (CO_LOCATIONS.includes(location)) return "CO";
  if (CA_LOCATIONS.includes(location)) return "CA";
  return "Other";
}

type SortDir = "asc" | "desc";

// --------------- Sub-components (outside render to satisfy react-hooks/static-components) ---------------

function HorizontalBar({
  items,
  maxCount,
}: {
  items: { status: string; count: number }[];
  maxCount: number;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted italic">No data for this group</p>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const pct = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
        return (
          <div key={item.status}>
            <div className="flex justify-between text-sm mb-0.5">
              <span className="text-foreground truncate mr-2">
                {item.status}
              </span>
              <span className="text-muted font-medium shrink-0">
                {item.count}
              </span>
            </div>
            <div className="h-4 bg-surface-2 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getStatusColor(item.status)}`}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  onSort,
}: {
  label: string;
  sortKey: string;
  currentSort: { key: string; dir: SortDir };
  onSort: (key: string) => void;
}) {
  const active = currentSort.key === sortKey;
  return (
    <th
      className="text-left text-xs font-medium text-muted uppercase tracking-wider py-3 px-4 cursor-pointer hover:text-foreground transition-colors select-none"
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (
          <span className="text-purple-400">
            {currentSort.dir === "asc" ? "\u2191" : "\u2193"}
          </span>
        )}
      </span>
    </th>
  );
}

// --------------- Component ---------------

export default function DesignEngineeringDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Filters
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterPMs, setFilterPMs] = useState<string[]>([]);
  const [filterDesignStatuses, setFilterDesignStatuses] = useState<string[]>(
    []
  );

  // Sort state for tables
  const [opsQueueSort, setOpsQueueSort] = useState<{
    key: string;
    dir: SortDir;
  }>({ key: "daysSinceStageMovement", dir: "desc" });

  const { trackDashboardView } = useActivityTracking();

  // --------------- Fetch ---------------

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/projects?active=true");
        const json = await res.json();
        if (!cancelled) {
          setProjects(json.data || []);
          setLastUpdated(json.lastUpdated || new Date().toISOString());
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load projects:", err);
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading && projects.length > 0) {
      trackDashboardView("design-engineering", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

  // --------------- Filter options ---------------

  const locationOptions = useMemo(
    () =>
      Array.from(new Set(projects.map((p) => p.pbLocation).filter(Boolean)))
        .sort()
        .map((v) => ({ value: v, label: v })),
    [projects]
  );

  const pmOptions = useMemo(
    () =>
      Array.from(
        new Set(projects.map((p) => p.projectManager).filter(Boolean))
      )
        .sort()
        .map((v) => ({ value: v, label: v })),
    [projects]
  );

  const designStatusOptions = useMemo(
    () =>
      Array.from(
        new Set(
          projects.map((p) => p.designStatus).filter(Boolean) as string[]
        )
      )
        .sort()
        .map((v) => ({ value: v, label: v })),
    [projects]
  );

  // --------------- Filtered projects ---------------

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (
        filterLocations.length > 0 &&
        !filterLocations.includes(p.pbLocation)
      )
        return false;
      if (filterPMs.length > 0 && !filterPMs.includes(p.projectManager))
        return false;
      if (
        filterDesignStatuses.length > 0 &&
        !filterDesignStatuses.includes(p.designStatus || "")
      )
        return false;
      return true;
    });
  }, [projects, filterLocations, filterPMs, filterDesignStatuses]);

  // --------------- Section 1: Summary Stats ---------------

  const summaryStats = useMemo(() => {
    const inDE = filtered.filter((p) => isDesignStage(p.stage));
    const approved = filtered.filter((p) => isApprovedLayout(p.layoutStatus));
    const draftsComplete = filtered.filter((p) =>
      isDraftsComplete(p.layoutStatus)
    );

    const turnaroundValues = filtered
      .map((p) => p.designTurnaroundTime)
      .filter((v): v is number => v !== null && v !== undefined);
    const avgTurnaround =
      turnaroundValues.length > 0
        ? turnaroundValues.reduce((a, b) => a + b, 0) / turnaroundValues.length
        : null;

    return {
      totalInDE: inDE.length,
      designsApproved: approved.length,
      draftsCompleted: draftsComplete.length,
      avgTurnaround,
    };
  }, [filtered]);

  // --------------- Section 2: CO vs CA breakdown ---------------

  const coVsCa = useMemo(() => {
    const coProjects = filtered.filter(
      (p) => getStateLabel(p.pbLocation) === "CO"
    );
    const caProjects = filtered.filter(
      (p) => getStateLabel(p.pbLocation) === "CA"
    );

    function countByDesignStatus(
      list: Project[]
    ): { status: string; count: number }[] {
      const map: Record<string, number> = {};
      list.forEach((p) => {
        const status = p.designStatus || "Unknown";
        map[status] = (map[status] || 0) + 1;
      });
      return Object.entries(map)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count);
    }

    return {
      co: countByDesignStatus(coProjects),
      ca: countByDesignStatus(caProjects),
      coTotal: coProjects.length,
      caTotal: caProjects.length,
    };
  }, [filtered]);

  // --------------- Section 3: Projects by Design Status ---------------

  const designStatusBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((p) => {
      const status = p.designStatus || "Unknown";
      map[status] = (map[status] || 0) + 1;
    });
    return Object.entries(map)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  // --------------- Section 4: Projects by Layout/DA Status ---------------

  const layoutStatusBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((p) => {
      const status = p.layoutStatus || "Unknown";
      map[status] = (map[status] || 0) + 1;
    });
    return Object.entries(map)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  // --------------- Section 5: Needs Ops Clarification Queue ---------------

  const opsQueue = useMemo(() => {
    const queue = filtered.filter((p) => {
      const ls = (p.layoutStatus || "").toLowerCase();
      return (
        ls.includes("needs ops clarification") ||
        ls.includes("ops clarification")
      );
    });

    return [...queue].sort((a, b) => {
      const aVal = a[opsQueueSort.key as keyof Project];
      const bVal = b[opsQueueSort.key as keyof Project];
      const aStr = String(aVal ?? "");
      const bStr = String(bVal ?? "");
      if (typeof aVal === "number" && typeof bVal === "number") {
        return opsQueueSort.dir === "desc" ? bVal - aVal : aVal - bVal;
      }
      return opsQueueSort.dir === "desc"
        ? bStr.localeCompare(aStr)
        : aStr.localeCompare(bStr);
    });
  }, [filtered, opsQueueSort]);

  const handleOpsSort = useCallback(
    (key: string) => {
      setOpsQueueSort((prev) =>
        prev.key === key
          ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
          : { key, dir: "desc" }
      );
    },
    []
  );

  // --------------- Section 6: DA Backlog by PM ---------------

  const daBacklogByPM = useMemo(() => {
    const backlog = filtered.filter(
      (p) =>
        isDesignStage(p.stage) && !isApprovedLayout(p.layoutStatus)
    );
    const map: Record<string, { count: number; stages: Set<string> }> = {};
    backlog.forEach((p) => {
      const pm = p.projectManager || "Unassigned";
      if (!map[pm]) map[pm] = { count: 0, stages: new Set() };
      map[pm].count += 1;
      map[pm].stages.add(p.stage);
    });
    return Object.entries(map)
      .map(([pm, data]) => ({
        pm,
        count: data.count,
        stages: Array.from(data.stages).sort(),
      }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  // --------------- Section 7: Design Status by AHJ ---------------

  const ahjMatrix = useMemo(() => {
    const ahjMap: Record<string, Record<string, number>> = {};
    filtered.forEach((p) => {
      const ahj = p.ahj || "Unknown";
      const status = p.designStatus || "Unknown";
      if (!ahjMap[ahj]) ahjMap[ahj] = {};
      ahjMap[ahj][status] = (ahjMap[ahj][status] || 0) + 1;
    });

    // Get top 15 AHJs by total count
    const ranked = Object.entries(ahjMap)
      .map(([ahj, statuses]) => ({
        ahj,
        statuses,
        total: Object.values(statuses).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    // Collect all statuses present in the top 15
    const allStatuses = new Set<string>();
    ranked.forEach((r) =>
      Object.keys(r.statuses).forEach((s) => allStatuses.add(s))
    );

    return {
      rows: ranked,
      columns: Array.from(allStatuses).sort(),
    };
  }, [filtered]);

  // --------------- CSV export ---------------

  const exportData = useMemo(() => {
    const rows = filtered.map((p) => ({
      Name: p.name,
      Location: p.pbLocation,
      Stage: p.stage,
      "Project Manager": p.projectManager,
      "Operations Manager": p.operationsManager,
      "Design Status": p.designStatus || "",
      "Layout Status": p.layoutStatus || "",
      AHJ: p.ahj,
      Utility: p.utility,
      "Design Turnaround (days)":
        p.designTurnaroundTime != null ? p.designTurnaroundTime : "",
      "Days in Stage": p.daysSinceStageMovement,
    }));
    return { data: rows, filename: "design-engineering-analytics.csv" };
  }, [filtered]);

  // --------------- Skeletons ---------------

  if (loading) {
    return (
      <DashboardShell title="Design & Engineering" accentColor="purple">
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-28 bg-skeleton rounded-xl animate-pulse"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(2)].map((_, i) => (
              <div
                key={i}
                className="h-64 bg-skeleton rounded-xl animate-pulse"
              />
            ))}
          </div>
          <div className="h-72 bg-skeleton rounded-xl animate-pulse" />
          <div className="h-72 bg-skeleton rounded-xl animate-pulse" />
        </div>
      </DashboardShell>
    );
  }

  const globalMax = Math.max(
    ...designStatusBreakdown.map((d) => d.count),
    ...layoutStatusBreakdown.map((d) => d.count),
    1
  );

  return (
    <DashboardShell
      title="Design & Engineering"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={exportData}
    >
      <div className="space-y-8">
        {/* --------------- Filters --------------- */}
        <div className="flex flex-wrap gap-3">
          <MultiSelectFilter
            label="Location"
            options={locationOptions}
            selected={filterLocations}
            onChange={setFilterLocations}
            accentColor="purple"
          />
          <MultiSelectFilter
            label="Project Manager"
            options={pmOptions}
            selected={filterPMs}
            onChange={setFilterPMs}
            accentColor="purple"
          />
          <MultiSelectFilter
            label="Design Status"
            options={designStatusOptions}
            selected={filterDesignStatuses}
            onChange={setFilterDesignStatuses}
            accentColor="purple"
          />
          {(filterLocations.length > 0 ||
            filterPMs.length > 0 ||
            filterDesignStatuses.length > 0) && (
            <button
              onClick={() => {
                setFilterLocations([]);
                setFilterPMs([]);
                setFilterDesignStatuses([]);
              }}
              className="text-sm text-purple-400 hover:text-purple-300 transition-colors self-end pb-1"
            >
              Clear all filters
            </button>
          )}
        </div>

        {/* --------------- Section 1: Summary Stats --------------- */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid">
          <StatCard
            label="Total in D&E"
            value={loading ? null : summaryStats.totalInDE}
            color="purple"
            subtitle={`of ${filtered.length} active`}
          />
          <StatCard
            label="Designs Approved"
            value={loading ? null : summaryStats.designsApproved}
            color="green"
            subtitle="DA / Layout Approved"
          />
          <StatCard
            label="Drafts Completed"
            value={loading ? null : summaryStats.draftsCompleted}
            color="blue"
            subtitle="Drafts or Design Complete"
          />
          <StatCard
            label="Avg Design Turnaround"
            value={
              loading
                ? null
                : summaryStats.avgTurnaround !== null
                  ? `${summaryStats.avgTurnaround.toFixed(1)}d`
                  : "N/A"
            }
            color="cyan"
            subtitle="Average days"
          />
        </div>

        {/* --------------- Section 2: CO vs CA --------------- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Colorado */}
          <div className="bg-surface rounded-xl border border-t-border p-5 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                Colorado Design Status
              </h3>
              <MiniStat label="Projects" value={coVsCa.coTotal} />
            </div>
            <HorizontalBar
              items={coVsCa.co}
              maxCount={Math.max(...coVsCa.co.map((d) => d.count), 1)}
            />
          </div>

          {/* California */}
          <div className="bg-surface rounded-xl border border-t-border p-5 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                California Design Status
              </h3>
              <MiniStat label="Projects" value={coVsCa.caTotal} />
            </div>
            <HorizontalBar
              items={coVsCa.ca}
              maxCount={Math.max(...coVsCa.ca.map((d) => d.count), 1)}
            />
          </div>
        </div>

        {/* --------------- Section 3: Projects by Design Status --------------- */}
        <div className="bg-surface rounded-xl border border-t-border p-5 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">
            Projects by Design Status
          </h3>
          <HorizontalBar items={designStatusBreakdown} maxCount={globalMax} />
        </div>

        {/* --------------- Section 4: Projects by Layout/DA Status --------------- */}
        <div className="bg-surface rounded-xl border border-t-border p-5 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">
            Projects by Layout / DA Status
          </h3>
          <HorizontalBar items={layoutStatusBreakdown} maxCount={globalMax} />
        </div>

        {/* --------------- Section 5: Needs Ops Clarification Queue --------------- */}
        <div className="bg-surface rounded-xl border border-t-border p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">
              Needs Ops Clarification
            </h3>
            <span className="text-sm text-muted">
              {opsQueue.length} project{opsQueue.length !== 1 ? "s" : ""}
            </span>
          </div>
          {opsQueue.length === 0 ? (
            <p className="text-sm text-muted italic py-4">
              No projects currently awaiting ops clarification.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border">
                    <SortHeader
                      label="Project"
                      sortKey="name"
                      currentSort={opsQueueSort}
                      onSort={handleOpsSort}
                    />
                    <SortHeader
                      label="PM"
                      sortKey="projectManager"
                      currentSort={opsQueueSort}
                      onSort={handleOpsSort}
                    />
                    <SortHeader
                      label="Location"
                      sortKey="pbLocation"
                      currentSort={opsQueueSort}
                      onSort={handleOpsSort}
                    />
                    <SortHeader
                      label="Stage"
                      sortKey="stage"
                      currentSort={opsQueueSort}
                      onSort={handleOpsSort}
                    />
                    <SortHeader
                      label="Days in Stage"
                      sortKey="daysSinceStageMovement"
                      currentSort={opsQueueSort}
                      onSort={handleOpsSort}
                    />
                  </tr>
                </thead>
                <tbody>
                  {opsQueue.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-t-border/50 hover:bg-surface-2/50 transition-colors"
                    >
                      <td className="py-2.5 px-4">
                        {p.url ? (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-400 hover:text-purple-300 transition-colors"
                          >
                            {p.name}
                          </a>
                        ) : (
                          <span className="text-foreground">{p.name}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-muted">
                        {p.projectManager || "—"}
                      </td>
                      <td className="py-2.5 px-4 text-muted">
                        {p.pbLocation}
                      </td>
                      <td className="py-2.5 px-4 text-muted">{p.stage}</td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`font-medium ${p.daysSinceStageMovement > 14 ? "text-red-400" : p.daysSinceStageMovement > 7 ? "text-yellow-400" : "text-foreground"}`}
                        >
                          {p.daysSinceStageMovement}d
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* --------------- Section 6: DA Backlog by PM --------------- */}
        <div className="bg-surface rounded-xl border border-t-border p-5 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">
            DA Backlog by Project Manager
          </h3>
          {daBacklogByPM.length === 0 ? (
            <p className="text-sm text-muted italic py-4">
              No unapproved design projects found.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border">
                    <th className="text-left text-xs font-medium text-muted uppercase tracking-wider py-3 px-4">
                      Project Manager
                    </th>
                    <th className="text-left text-xs font-medium text-muted uppercase tracking-wider py-3 px-4">
                      Count
                    </th>
                    <th className="text-left text-xs font-medium text-muted uppercase tracking-wider py-3 px-4">
                      Stages
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {daBacklogByPM.map((row) => (
                    <tr
                      key={row.pm}
                      className="border-b border-t-border/50 hover:bg-surface-2/50 transition-colors"
                    >
                      <td className="py-2.5 px-4 text-foreground font-medium">
                        {row.pm}
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          key={String(row.count)}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 font-bold text-sm animate-value-flash"
                        >
                          {row.count}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex flex-wrap gap-1.5">
                          {row.stages.map((s) => (
                            <span
                              key={s}
                              className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-muted"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* --------------- Section 7: Design Status by AHJ --------------- */}
        <div className="bg-surface rounded-xl border border-t-border p-5 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">
            Design Status by AHJ (Top 15)
          </h3>
          {ahjMatrix.rows.length === 0 ? (
            <p className="text-sm text-muted italic py-4">
              No AHJ data available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border">
                    <th className="text-left text-xs font-medium text-muted uppercase tracking-wider py-3 px-4 sticky left-0 bg-surface z-10">
                      AHJ
                    </th>
                    <th className="text-center text-xs font-medium text-muted uppercase tracking-wider py-3 px-3">
                      Total
                    </th>
                    {ahjMatrix.columns.map((col) => (
                      <th
                        key={col}
                        className="text-center text-xs font-medium text-muted uppercase tracking-wider py-3 px-3 whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ahjMatrix.rows.map((row) => (
                    <tr
                      key={row.ahj}
                      className="border-b border-t-border/50 hover:bg-surface-2/50 transition-colors"
                    >
                      <td className="py-2.5 px-4 text-foreground font-medium sticky left-0 bg-surface whitespace-nowrap">
                        {row.ahj}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="font-bold text-foreground">
                          {row.total}
                        </span>
                      </td>
                      {ahjMatrix.columns.map((col) => {
                        const count = row.statuses[col] || 0;
                        return (
                          <td key={col} className="py-2.5 px-3 text-center">
                            {count > 0 ? (
                              <span
                                className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-medium text-white ${getStatusColor(col)}`}
                              >
                                {count}
                              </span>
                            ) : (
                              <span className="text-muted/40">-</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
