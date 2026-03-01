"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { formatMoney, formatDate } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---- Types ----

interface FullEquipment {
  modules: { brand: string; model: string; count: number; wattage: number };
  inverter: { brand: string; model: string; count: number; sizeKwac: number };
  battery: { brand: string; model: string; count: number; sizeKwh: number; expansionCount: number };
  evCount: number;
  systemSizeKwdc: number;
  systemSizeKwac: number;
}

// Statuses that indicate "in review"
const REVIEW_STATUSES = [
  "Ready For Review",
  "Final Review/Stamping",
  "DA Approved",
];

type SortField = "name" | "reviewType" | "daysWaiting" | "dcAcRatio" | "amount";
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

  // Enrich with computed fields
  const enrichedProjects = useMemo(() => {
    return reviewProjects.map((p) => {
      const eq = p.equipment as FullEquipment | undefined;
      const dcKw = eq?.systemSizeKwdc || ((eq?.modules?.count || 0) * (eq?.modules?.wattage || 0)) / 1000;
      const acKw = eq?.systemSizeKwac || ((eq?.inverter?.count || 0) * (eq?.inverter?.sizeKwac || 0));
      const dcAcRatio = acKw > 0 ? dcKw / acKw : 0;
      const daysWaiting = p.daysSinceStageMovement ?? 0;

      const reviewType = p.designStatus === "Ready For Review"
        ? "Initial"
        : p.designStatus === "Final Review/Stamping"
        ? "Final"
        : "DA Approved";

      const eqSummary = eq
        ? `${eq.modules?.count || 0}× ${eq.modules?.wattage || 0}W, ${eq.inverter?.count || 0}× inv`
        : "—";

      return { ...p, dcAcRatio, daysWaiting, reviewType, eqSummary };
    });
  }, [reviewProjects]);

  // Sort
  const sortedProjects = useMemo(() => {
    const sorted = [...enrichedProjects];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "reviewType": cmp = a.reviewType.localeCompare(b.reviewType); break;
        case "daysWaiting": cmp = a.daysWaiting - b.daysWaiting; break;
        case "dcAcRatio": cmp = a.dcAcRatio - b.dcAcRatio; break;
        case "amount": cmp = (a.amount || 0) - (b.amount || 0); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [enrichedProjects, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortField(field); setSortDir("desc"); }
    },
    [sortField]
  );

  // Stats
  const stats = useMemo(() => {
    const initial = enrichedProjects.filter((p) => p.reviewType === "Initial").length;
    const final = enrichedProjects.filter((p) => p.reviewType === "Final" || p.reviewType === "DA Approved").length;
    const avgDays = enrichedProjects.length > 0
      ? Math.round(enrichedProjects.reduce((s, p) => s + p.daysWaiting, 0) / enrichedProjects.length)
      : 0;
    return { initial, final, avgDays };
  }, [enrichedProjects]);

  // Export
  const exportRows = useMemo(
    () => sortedProjects.map((p) => ({
      name: p.name,
      designer: p.designSupportUser || p.projectManager || "",
      reviewType: p.reviewType,
      designStatus: p.designStatus || "",
      daysWaiting: p.daysWaiting,
      dcAcRatio: p.dcAcRatio.toFixed(2),
      equipment: p.eqSummary,
      tags: (p.tags || []).join(", "),
      ahj: p.ahj || "",
      location: p.pbLocation || "",
      amount: p.amount || 0,
      designCompletionDate: p.designCompletionDate || "",
      designApprovalDate: p.designApprovalDate || "",
      systemPerformanceReview: (localOverrides[p.id] ?? p.systemPerformanceReview) ? "Yes" : "No",
    })),
    [sortedProjects, localOverrides]
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅";

  return (
    <DashboardShell
      title="Plan Review Queue"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "plan-review-queue.csv" }}
      fullWidth
    >
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 stagger-grid">
        <MiniStat label="Initial Review" value={loading ? null : stats.initial} />
        <MiniStat label="Final / DA Review" value={loading ? null : stats.final} />
        <MiniStat label="Avg Days Waiting" value={loading ? null : `${stats.avgDays}d`} alert={stats.avgDays > 14} />
      </div>

      {/* Table */}
      <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="p-8 text-center text-muted">No projects currently in plan review.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Project{sortIndicator("name")}
                  </th>
                  <th className="p-3">Designer / PM</th>
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
                  <th className="p-3">AHJ</th>
                  <th className="p-3">Design Complete</th>
                  <th className="p-3">DA Date</th>
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
                      <td className="p-3 text-muted">{p.designSupportUser || p.projectManager || "—"}</td>
                      <td className="p-3">
                        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                          p.reviewType === "Initial"
                            ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                            : "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
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
                        {p.dcAcRatio > 0 ? p.dcAcRatio.toFixed(2) : "—"}
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
                        ) : "—"}
                      </td>
                      <td className="p-3 text-muted">{p.ahj || "—"}</td>
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
