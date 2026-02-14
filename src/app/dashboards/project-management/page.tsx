"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard, MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { formatMoney } from "@/lib/format";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---- Types ----

interface Project {
  id: number;
  name: string;
  pbLocation: string;
  stage: string;
  stageId: string;
  stagePriority: number;
  amount: number;
  projectManager: string;
  operationsManager: string;
  dealOwner: string;
  designStatus: string | null;
  layoutStatus: string | null;
  permittingStatus: string | null;
  interconnectionStatus: string | null;
  constructionStatus: string | null;
  daysSinceStageMovement: number;
  daysSinceClose: number;
  priorityScore: number;
  isActive: boolean;
  isBlocked: boolean;
  isRtb: boolean;
  isSchedulable: boolean;
  constructionCompleteDate: string | null;
  closeDate: string | null;
  tags: string[];
  projectType: string;
  url: string;
}

type SortField = "pm" | "count" | "avgDays" | "value" | "blocked";
type SortDir = "asc" | "desc";

// ---- Helpers ----

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function monthKey(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

// ---- Skeleton ----

function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface/50 border border-t-border rounded-xl p-6 shadow-card">
          <div className="h-9 w-20 bg-skeleton rounded animate-pulse mb-2" />
          <div className="h-4 w-28 bg-skeleton rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="bg-surface border border-t-border rounded-xl p-4 shadow-card space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-8 bg-skeleton rounded animate-pulse" />
      ))}
    </div>
  );
}

// ---- Section Header ----

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 mt-8 first:mt-0">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

// ---- Sortable Table Header ----

function SortHeader({
  label,
  field,
  currentSort,
  currentDir,
  onSort,
}: {
  label: string;
  field: SortField;
  currentSort: SortField;
  currentDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = currentSort === field;
  return (
    <th
      className="text-left text-xs font-semibold text-muted px-3 py-2 cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => onSort(field)}
    >
      {label}
      {active && (
        <span className="ml-1 text-green-500">{currentDir === "asc" ? "\u25B2" : "\u25BC"}</span>
      )}
    </th>
  );
}

// ---- Main Page ----

export default function ProjectManagementPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Filters
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedPMs, setSelectedPMs] = useState<string[]>([]);

  // Table sort state
  const [pmSort, setPmSort] = useState<SortField>("value");
  const [pmDir, setPmDir] = useState<SortDir>("desc");
  const [daSort, setDaSort] = useState<SortField>("count");
  const [daDir, setDaDir] = useState<SortDir>("desc");
  const [stuckSort, setStuckSort] = useState<SortField>("count");
  const [stuckDir, setStuckDir] = useState<SortDir>("desc");

  const { trackDashboardView } = useActivityTracking();

  // ---- Fetch ----

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/projects?active=true");
      const json = await res.json();
      const data: Project[] = json.data || [];
      setProjects(data);
      setLastUpdated(json.lastUpdated || new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (projects.length > 0) {
      trackDashboardView("project-management", { projectCount: projects.length });
    }
  }, [projects.length, trackDashboardView]);

  // ---- Filter options ----

  const locationOptions = useMemo(
    () =>
      [...new Set(projects.map((p) => p.pbLocation))]
        .filter((l) => l && l !== "Unknown")
        .sort()
        .map((l) => ({ value: l, label: l })),
    [projects]
  );

  const pmOptions = useMemo(
    () =>
      [...new Set(projects.map((p) => p.projectManager))]
        .filter(Boolean)
        .sort()
        .map((pm) => ({ value: pm, label: pm })),
    [projects]
  );

  // ---- Filtered projects ----

  const filtered = useMemo(() => {
    let result = projects;
    if (selectedLocations.length > 0) {
      const set = new Set(selectedLocations);
      result = result.filter((p) => set.has(p.pbLocation));
    }
    if (selectedPMs.length > 0) {
      const set = new Set(selectedPMs);
      result = result.filter((p) => set.has(p.projectManager));
    }
    return result;
  }, [projects, selectedLocations, selectedPMs]);

  // ---- 1. Summary Stats ----

  const totalActive = filtered.length;
  const totalValue = useMemo(() => filtered.reduce((s, p) => s + (p.amount || 0), 0), [filtered]);
  const avgDaysInStage = useMemo(() => {
    const days = filtered.map((p) => p.daysSinceStageMovement).filter((d) => d != null);
    return days.length > 0 ? Math.round(avg(days)) : 0;
  }, [filtered]);
  const rtbCount = useMemo(() => filtered.filter((p) => p.isRtb).length, [filtered]);

  // ---- 2. By Location ----

  const byLocation = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of filtered) {
      if (!p.pbLocation || p.pbLocation === "Unknown") continue;
      map.set(p.pbLocation, (map.get(p.pbLocation) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  // ---- 3. By Stage ----

  const byStage = useMemo(() => {
    const map = new Map<string, { count: number; priority: number }>();
    for (const p of filtered) {
      const existing = map.get(p.stage);
      if (existing) {
        existing.count++;
      } else {
        map.set(p.stage, { count: 1, priority: p.stagePriority ?? 999 });
      }
    }
    return [...map.entries()]
      .sort((a, b) => a[1].priority - b[1].priority)
      .map(([stage, { count }]) => ({ stage, count, pct: totalActive > 0 ? (count / totalActive) * 100 : 0 }));
  }, [filtered, totalActive]);

  const maxStageCount = useMemo(
    () => Math.max(...byStage.map((s) => s.count), 1),
    [byStage]
  );

  // ---- 4. By PM ----

  const pmData = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const p of filtered) {
      if (!p.projectManager) continue;
      const list = map.get(p.projectManager) || [];
      list.push(p);
      map.set(p.projectManager, list);
    }
    return [...map.entries()].map(([pm, pList]) => ({
      pm,
      count: pList.length,
      avgDays: Math.round(avg(pList.map((p) => p.daysSinceStageMovement).filter((d) => d != null) as number[])),
      value: pList.reduce((s, p) => s + (p.amount || 0), 0),
      blocked: pList.filter((p) => p.isBlocked).length,
    }));
  }, [filtered]);

  const pmSorted = useMemo(() => {
    const sorted = [...pmData];
    sorted.sort((a, b) => {
      const aVal = a[pmSort];
      const bVal = b[pmSort];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return pmDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return pmDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return sorted;
  }, [pmData, pmSort, pmDir]);

  const handlePmSort = useCallback((field: SortField) => {
    setPmSort((prev) => {
      if (prev === field) {
        setPmDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setPmDir("desc");
      return field;
    });
  }, []);

  // ---- 5. DA Backlog by PM ----

  const daBacklog = useMemo(() => {
    const daDone = new Set(["approved", "da approved", "da_approved"]);
    const needsDA = filtered.filter((p) => {
      const ls = (p.layoutStatus || "").toLowerCase().trim();
      if (!ls) return false;
      return !daDone.has(ls);
    });
    const map = new Map<string, Project[]>();
    for (const p of needsDA) {
      if (!p.projectManager) continue;
      const list = map.get(p.projectManager) || [];
      list.push(p);
      map.set(p.projectManager, list);
    }
    return [...map.entries()].map(([pm, pList]) => ({
      pm,
      count: pList.length,
      stages: [...new Set(pList.map((p) => p.stage))].join(", "),
    }));
  }, [filtered]);

  const daSorted = useMemo(() => {
    const sorted = [...daBacklog];
    sorted.sort((a, b) => {
      if (daSort === "pm") return daDir === "asc" ? a.pm.localeCompare(b.pm) : b.pm.localeCompare(a.pm);
      return daDir === "asc" ? a.count - b.count : b.count - a.count;
    });
    return sorted;
  }, [daBacklog, daSort, daDir]);

  const handleDaSort = useCallback((field: SortField) => {
    setDaSort((prev) => {
      if (prev === field) {
        setDaDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setDaDir("desc");
      return field;
    });
  }, []);

  // ---- 6. Stuck Deals by PM ----

  const stuckData = useMemo(() => {
    const stuck = filtered.filter((p) => p.daysSinceStageMovement > 30);
    const map = new Map<string, Project[]>();
    for (const p of stuck) {
      if (!p.projectManager) continue;
      const list = map.get(p.projectManager) || [];
      list.push(p);
      map.set(p.projectManager, list);
    }
    return [...map.entries()].map(([pm, pList]) => {
      const worst = pList.reduce((w, p) => (p.daysSinceStageMovement > w.daysSinceStageMovement ? p : w), pList[0]);
      return {
        pm,
        count: pList.length,
        avgDays: Math.round(avg(pList.map((p) => p.daysSinceStageMovement))),
        worstName: worst.name.split("|")[0].trim(),
        worstDays: worst.daysSinceStageMovement,
      };
    });
  }, [filtered]);

  const stuckSorted = useMemo(() => {
    const sorted = [...stuckData];
    sorted.sort((a, b) => {
      if (stuckSort === "pm") return stuckDir === "asc" ? a.pm.localeCompare(b.pm) : b.pm.localeCompare(a.pm);
      if (stuckSort === "avgDays") return stuckDir === "asc" ? a.avgDays - b.avgDays : b.avgDays - a.avgDays;
      return stuckDir === "asc" ? a.count - b.count : b.count - a.count;
    });
    return sorted;
  }, [stuckData, stuckSort, stuckDir]);

  const handleStuckSort = useCallback((field: SortField) => {
    setStuckSort((prev) => {
      if (prev === field) {
        setStuckDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setStuckDir("desc");
      return field;
    });
  }, []);

  // ---- 7. Revenue Tracking ----

  const revenueByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of filtered) {
      if (!p.constructionCompleteDate) continue;
      const key = monthKey(p.constructionCompleteDate);
      map.set(key, (map.get(key) || 0) + (p.amount || 0));
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const maxRevenue = useMemo(
    () => Math.max(...revenueByMonth.map(([, v]) => v), 1),
    [revenueByMonth]
  );

  // ---- Export Data ----

  const exportRows = useMemo(
    () =>
      filtered.map((p) => ({
        Name: p.name,
        Location: p.pbLocation,
        Stage: p.stage,
        PM: p.projectManager,
        "Ops Manager": p.operationsManager,
        "Deal Owner": p.dealOwner,
        Amount: p.amount,
        "Days in Stage": p.daysSinceStageMovement,
        RTB: p.isRtb ? "Yes" : "No",
        Blocked: p.isBlocked ? "Yes" : "No",
        "Design Status": p.designStatus || "",
        "Layout Status": p.layoutStatus || "",
        "Permitting Status": p.permittingStatus || "",
        "Construction Complete": p.constructionCompleteDate || "",
      })),
    [filtered]
  );

  // ---- Stage bar colors ----

  const STAGE_COLORS = [
    "bg-green-500", "bg-emerald-500", "bg-teal-500", "bg-cyan-500",
    "bg-blue-500", "bg-indigo-500", "bg-violet-500", "bg-purple-500",
    "bg-fuchsia-500", "bg-pink-500", "bg-rose-500", "bg-orange-500",
    "bg-amber-500", "bg-yellow-500", "bg-lime-500",
  ];

  // ---- Render ----

  return (
    <DashboardShell
      title="Project Management"
      accentColor="green"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "project-management.csv" }}
    >
      {loading && projects.length === 0 ? (
        <div className="space-y-6">
          <SkeletonGrid count={4} />
          <SkeletonTable />
          <SkeletonTable />
        </div>
      ) : error && projects.length === 0 ? (
        <div className="bg-surface border border-red-500 rounded-xl p-8 text-center shadow-card">
          <div className="text-lg text-foreground">Error loading data</div>
          <div className="text-sm text-muted mt-2">{error}</div>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-green-500 border-none rounded-md cursor-pointer text-white font-semibold"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-4 items-end mb-6">
            <MultiSelectFilter
              label="Location"
              options={locationOptions}
              selected={selectedLocations}
              onChange={setSelectedLocations}
              placeholder="All Locations"
              accentColor="green"
            />
            <MultiSelectFilter
              label="Project Manager"
              options={pmOptions}
              selected={selectedPMs}
              onChange={setSelectedPMs}
              placeholder="All PMs"
              accentColor="green"
            />
            {(selectedLocations.length > 0 || selectedPMs.length > 0) && (
              <button
                onClick={() => {
                  setSelectedLocations([]);
                  setSelectedPMs([]);
                }}
                className="text-xs text-muted hover:text-foreground transition-colors px-3 py-2 border border-t-border rounded-md bg-surface cursor-pointer"
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* 1. Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid">
            <StatCard
              label="Total Active Projects"
              value={totalActive}
              color="green"
            />
            <StatCard
              label="Total Pipeline Value"
              value={formatMoney(totalValue)}
              color="emerald"
            />
            <StatCard
              label="Avg Days in Stage"
              value={avgDaysInStage}
              subtitle="across all active deals"
              color="blue"
            />
            <StatCard
              label="RTB Projects"
              value={rtbCount}
              subtitle="ready to build"
              color="cyan"
            />
          </div>

          {/* 2. Projects by Location */}
          <SectionHeader title="Projects by Location" subtitle="Active project count per office" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 stagger-grid">
            {byLocation.map(([loc, count]) => (
              <MiniStat key={loc} label={loc} value={count} />
            ))}
            {byLocation.length === 0 && (
              <div className="col-span-full text-center text-muted text-sm py-4">No location data</div>
            )}
          </div>

          {/* 3. Projects by Deal Stage */}
          <SectionHeader title="Projects by Deal Stage" subtitle="Distribution across pipeline stages" />
          <div className="bg-surface border border-t-border rounded-xl p-5 shadow-card space-y-3">
            {byStage.map((s, i) => (
              <div key={s.stage} className="flex items-center gap-3">
                <div className="w-40 md:w-56 text-sm text-foreground truncate" title={s.stage}>
                  {s.stage}
                </div>
                <div className="flex-1 h-6 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${STAGE_COLORS[i % STAGE_COLORS.length]}`}
                    style={{ width: `${(s.count / maxStageCount) * 100}%` }}
                  />
                </div>
                <div className="w-20 text-right text-sm font-mono font-semibold text-foreground">
                  {s.count}
                </div>
                <div className="w-14 text-right text-xs text-muted">
                  {s.pct.toFixed(0)}%
                </div>
              </div>
            ))}
            {byStage.length === 0 && (
              <div className="text-center text-muted text-sm py-4">No stage data</div>
            )}
          </div>

          {/* 4. Projects by PM */}
          <SectionHeader title="Projects by PM" subtitle="Project manager workload and metrics" />
          <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border bg-background">
                    <SortHeader label="Project Manager" field="pm" currentSort={pmSort} currentDir={pmDir} onSort={handlePmSort} />
                    <SortHeader label="# Projects" field="count" currentSort={pmSort} currentDir={pmDir} onSort={handlePmSort} />
                    <SortHeader label="Avg Days in Stage" field="avgDays" currentSort={pmSort} currentDir={pmDir} onSort={handlePmSort} />
                    <SortHeader label="Pipeline Value" field="value" currentSort={pmSort} currentDir={pmDir} onSort={handlePmSort} />
                    <SortHeader label="# Blocked" field="blocked" currentSort={pmSort} currentDir={pmDir} onSort={handlePmSort} />
                  </tr>
                </thead>
                <tbody>
                  {pmSorted.map((row) => (
                    <tr
                      key={row.pm}
                      className="border-b border-t-border hover:bg-surface-elevated transition-colors"
                    >
                      <td className="px-3 py-2.5 font-medium text-foreground">{row.pm}</td>
                      <td className="px-3 py-2.5 font-mono text-foreground">{row.count}</td>
                      <td className="px-3 py-2.5 font-mono text-foreground">
                        <span className={row.avgDays > 30 ? "text-red-400" : row.avgDays > 14 ? "text-yellow-400" : "text-green-400"}>
                          {row.avgDays}d
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-green-500">{formatMoney(row.value)}</td>
                      <td className="px-3 py-2.5 font-mono">
                        {row.blocked > 0 ? (
                          <span className="text-red-400 font-semibold">{row.blocked}</span>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {pmSorted.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted">No PM data</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 5. DA Backlog by PM */}
          <SectionHeader title="DA Backlog by PM" subtitle="Projects awaiting design approval, grouped by project manager" />
          <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border bg-background">
                    <SortHeader label="Project Manager" field="pm" currentSort={daSort} currentDir={daDir} onSort={handleDaSort} />
                    <SortHeader label="Count" field="count" currentSort={daSort} currentDir={daDir} onSort={handleDaSort} />
                    <th className="text-left text-xs font-semibold text-muted px-3 py-2">Stages</th>
                  </tr>
                </thead>
                <tbody>
                  {daSorted.map((row) => (
                    <tr
                      key={row.pm}
                      className="border-b border-t-border hover:bg-surface-elevated transition-colors"
                    >
                      <td className="px-3 py-2.5 font-medium text-foreground">{row.pm}</td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-orange-400">{row.count}</td>
                      <td className="px-3 py-2.5 text-muted text-xs max-w-xs truncate" title={row.stages}>
                        {row.stages}
                      </td>
                    </tr>
                  ))}
                  {daSorted.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-muted">No pending DA projects</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 6. Stuck Deals by PM */}
          <SectionHeader title="Stuck Deals by PM" subtitle="Projects with no stage movement in 30+ days" />
          <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-t-border bg-background">
                    <SortHeader label="Project Manager" field="pm" currentSort={stuckSort} currentDir={stuckDir} onSort={handleStuckSort} />
                    <SortHeader label="Count" field="count" currentSort={stuckSort} currentDir={stuckDir} onSort={handleStuckSort} />
                    <SortHeader label="Avg Days Stuck" field="avgDays" currentSort={stuckSort} currentDir={stuckDir} onSort={handleStuckSort} />
                    <th className="text-left text-xs font-semibold text-muted px-3 py-2">Worst Project</th>
                  </tr>
                </thead>
                <tbody>
                  {stuckSorted.map((row) => (
                    <tr
                      key={row.pm}
                      className="border-b border-t-border hover:bg-surface-elevated transition-colors"
                    >
                      <td className="px-3 py-2.5 font-medium text-foreground">{row.pm}</td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-red-400">{row.count}</td>
                      <td className="px-3 py-2.5 font-mono text-foreground">{row.avgDays}d</td>
                      <td className="px-3 py-2.5 text-xs text-muted">
                        <span className="text-foreground">{row.worstName}</span>
                        <span className="ml-1 text-red-400 font-mono">({row.worstDays}d)</span>
                      </td>
                    </tr>
                  ))}
                  {stuckSorted.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-muted">No stuck deals (30+ days)</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 7. Revenue Tracking */}
          <SectionHeader title="Revenue Tracking" subtitle="Completed construction revenue by month" />
          <div className="bg-surface border border-t-border rounded-xl p-5 shadow-card">
            {revenueByMonth.length > 0 ? (
              <div className="space-y-2">
                {revenueByMonth.map(([key, value]) => (
                  <div key={key} className="flex items-center gap-3">
                    <div className="w-20 text-xs text-muted font-medium">{monthLabel(key)}</div>
                    <div className="flex-1 h-7 bg-surface-2 rounded-md overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-md transition-all duration-500 flex items-center px-2"
                        style={{ width: `${Math.max((value / maxRevenue) * 100, 4)}%` }}
                      >
                        <span className="text-xs font-mono font-semibold text-white whitespace-nowrap">
                          {formatMoney(value)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted text-sm py-8">
                No completed construction projects with revenue data
              </div>
            )}
          </div>
        </>
      )}
    </DashboardShell>
  );
}
