"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { formatMoney, formatDate } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---- Types ----

interface ExtendedProject extends RawProject {
  designStatus?: string;
  layoutStatus?: string;
  designCompletionDate?: string;
  designApprovalDate?: string;
  projectManager?: string;
}

// Design Approval (layout) statuses that indicate "pending" — NOT approved/rejected/revision
const PENDING_APPROVAL_STATUSES = [
  "Sent For Approval",
  "Resent For Approval",
  "Sent to Customer",
  "Review In Progress",
  "Draft Complete",
  "Pending Review",
  "Ready For Review",
  "Ready",
  "Draft Created",
];

type SortField = "name" | "layoutStatus" | "daysWaiting" | "amount";
type SortDir = "asc" | "desc";

export default function PendingApprovalPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<ExtendedProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: ExtendedProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  const [sortField, setSortField] = useState<SortField>("daysWaiting");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("pending-approval", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // Filter to projects with pending approval statuses
  const pendingProjects = useMemo(() => {
    return safeProjects
      .filter((p) => p.layoutStatus && PENDING_APPROVAL_STATUSES.includes(p.layoutStatus))
      .map((p) => ({
        ...p,
        daysWaiting: p.daysSinceStageMovement ?? 0,
      }));
  }, [safeProjects]);

  // Sort
  const sortedProjects = useMemo(() => {
    const sorted = [...pendingProjects];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "layoutStatus": cmp = (a.layoutStatus || "").localeCompare(b.layoutStatus || ""); break;
        case "daysWaiting": cmp = a.daysWaiting - b.daysWaiting; break;
        case "amount": cmp = (a.amount || 0) - (b.amount || 0); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [pendingProjects, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortField(field); setSortDir("desc"); }
    },
    [sortField]
  );

  // Stats
  const stats = useMemo(() => {
    const total = pendingProjects.length;
    const days = pendingProjects.map((p) => p.daysWaiting);
    const avgDays = days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0;
    const longestWait = days.length > 0 ? Math.max(...days) : 0;
    return { total, avgDays, longestWait };
  }, [pendingProjects]);

  // Export
  const exportRows = useMemo(
    () => sortedProjects.map((p) => ({
      name: p.name,
      pm: p.projectManager || "",
      location: p.pbLocation || "",
      layoutStatus: p.layoutStatus || "",
      designStatus: p.designStatus || "",
      daysWaiting: p.daysWaiting,
      amount: p.amount || 0,
      designCompletionDate: p.designCompletionDate || "",
    })),
    [sortedProjects]
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅";

  return (
    <DashboardShell
      title="Pending Design Approval"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "pending-design-approval.csv" }}
      fullWidth
    >
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 stagger-grid">
        <MiniStat label="Total Pending" value={loading ? null : stats.total} />
        <MiniStat label="Avg Days Waiting" value={loading ? null : `${stats.avgDays}d`} alert={stats.avgDays > 10} />
        <MiniStat label="Longest Wait" value={loading ? null : `${stats.longestWait}d`} alert={stats.longestWait > 21} />
      </div>

      {/* Table */}
      <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="p-8 text-center text-muted">No projects currently pending design approval.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Project{sortIndicator("name")}
                  </th>
                  <th className="p-3">PM</th>
                  <th className="p-3">Location</th>
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("layoutStatus")}>
                    DA Status{sortIndicator("layoutStatus")}
                  </th>
                  <th className="p-3">Design Status</th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("daysWaiting")}>
                    Days Waiting{sortIndicator("daysWaiting")}
                  </th>
                  <th className="p-3">Design Complete</th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("amount")}>
                    Amount{sortIndicator("amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedProjects.map((p) => (
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
                    <td className="p-3 text-muted">{p.projectManager || "—"}</td>
                    <td className="p-3 text-muted">{p.pbLocation || "—"}</td>
                    <td className="p-3">
                      <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                        {p.layoutStatus}
                      </span>
                    </td>
                    <td className="p-3 text-muted">{p.designStatus || "—"}</td>
                    <td className="p-3 text-right">
                      <span className={`font-semibold ${p.daysWaiting > 21 ? "text-red-400" : p.daysWaiting > 10 ? "text-yellow-400" : "text-foreground"}`}>
                        {p.daysWaiting}d
                      </span>
                    </td>
                    <td className="p-3 text-muted">{formatDate(p.designCompletionDate)}</td>
                    <td className="p-3 text-right text-foreground">{formatMoney(p.amount || 0)}</td>
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
