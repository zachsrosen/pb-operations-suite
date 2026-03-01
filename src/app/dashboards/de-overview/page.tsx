"use client";

import { useMemo, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import Link from "next/link";

// ---- Types ----

interface FullEquipment {
  modules: { brand: string; model: string; count: number; wattage: number };
  inverter: { brand: string; model: string; count: number; sizeKwac: number };
  battery: { brand: string; model: string; count: number; sizeKwh: number; expansionCount: number };
  evCount: number;
  systemSizeKwdc: number;
  systemSizeKwac: number;
}

interface ExtendedProject extends RawProject {
  designStatus?: string;
  layoutStatus?: string;
  designCompletionDate?: string;
  designApprovalDate?: string;
  systemPerformanceReview?: boolean;
  equipment?: FullEquipment | RawProject["equipment"];
}

// Design status funnel order
const STATUS_FUNNEL = [
  { key: "Ready for Design", label: "Ready for Design", color: "bg-slate-500" },
  { key: "In Progress", label: "In Progress", color: "bg-blue-500" },
  { key: "Ready For Review", label: "Ready For Review", color: "bg-yellow-500" },
  { key: "Final Review/Stamping", label: "Final Review", color: "bg-orange-500" },
  { key: "Draft Complete - Waiting on Approvals", label: "Waiting on Approvals", color: "bg-purple-500" },
  { key: "DA Approved", label: "DA Approved", color: "bg-indigo-500" },
  { key: "Submitted To Engineering", label: "In Engineering", color: "bg-cyan-500" },
  { key: "Design Complete", label: "Design Complete", color: "bg-emerald-500" },
];

// pbLocation values: "Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"
const CO_LOCATIONS = ["Westminster", "Centennial", "Colorado Springs"];
const CA_LOCATIONS = ["San Luis Obispo", "Camarillo"];

// D&E sub-dashboard links
const SUB_DASHBOARDS = [
  { href: "/dashboards/plan-review", title: "Plan Review Queue", tag: "REVIEW" },
  { href: "/dashboards/pending-approval", title: "Pending Approval", tag: "APPROVAL" },
  { href: "/dashboards/design-revisions", title: "Design Revisions", tag: "REVISIONS" },
  { href: "/dashboards/de-metrics", title: "D&E Metrics", tag: "METRICS" },
  { href: "/dashboards/clipping-analytics", title: "Clipping Analytics", tag: "CLIPPING" },
  { href: "/dashboards/ahj-requirements", title: "AHJ Requirements", tag: "AHJ" },
  { href: "/dashboards/utility-design-requirements", title: "Utility Requirements", tag: "UTILITY" },
];

export default function DEOverviewPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<ExtendedProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: ExtendedProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("de-overview", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  const designProjects = useMemo(
    () => safeProjects.filter(
      (p) =>
        p.stage === "Design & Engineering" ||
        p.designStatus ||
        p.designCompletionDate
    ),
    [safeProjects]
  );

  // ---- Hero metrics ----
  const heroMetrics = useMemo(() => {
    const activeDE = designProjects.filter((p) => p.stage === "Design & Engineering");

    // Avg turnaround: close → designCompletionDate for completed designs
    const turnarounds = designProjects
      .filter((p) => p.closeDate && p.designCompletionDate)
      .map((p) => {
        const d1 = new Date(p.closeDate! + "T12:00:00");
        const d2 = new Date(p.designCompletionDate! + "T12:00:00");
        return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter((d) => d >= 0);
    const avgTurnaround =
      turnarounds.length > 0
        ? Math.round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length)
        : 0;

    // Approval rate: projects with designApprovalDate / projects with designCompletionDate
    const completed = designProjects.filter((p) => p.designCompletionDate);
    const approved = designProjects.filter((p) => p.designApprovalDate);
    const approvalRate =
      completed.length > 0
        ? Math.round((approved.length / completed.length) * 100)
        : 0;

    // Flagged for system performance review
    const flagged = safeProjects.filter((p) => p.systemPerformanceReview).length;

    return { activeCount: activeDE.length, avgTurnaround, approvalRate, flagged };
  }, [designProjects, safeProjects]);

  // ---- Status funnel ----
  const funnelData = useMemo(() => {
    const counts: Record<string, number> = {};
    designProjects.forEach((p) => {
      if (p.designStatus) {
        counts[p.designStatus] = (counts[p.designStatus] || 0) + 1;
      }
    });
    const maxCount = Math.max(1, ...STATUS_FUNNEL.map((s) => counts[s.key] || 0));
    return STATUS_FUNNEL.map((s) => ({
      ...s,
      count: counts[s.key] || 0,
      pct: ((counts[s.key] || 0) / maxCount) * 100,
    }));
  }, [designProjects]);

  // ---- CO vs CA split ----
  const regionSplit = useMemo(() => {
    const co = designProjects.filter((p) => CO_LOCATIONS.includes(p.pbLocation || ""));
    const ca = designProjects.filter((p) => CA_LOCATIONS.includes(p.pbLocation || ""));
    return {
      co: { count: co.length, revenue: co.reduce((s, p) => s + (p.amount || 0), 0) },
      ca: { count: ca.length, revenue: ca.reduce((s, p) => s + (p.amount || 0), 0) },
    };
  }, [designProjects]);

  // ---- Stale projects (most days in current stage) ----
  const staleProjects = useMemo(() => {
    return designProjects
      .filter((p) => p.stage === "Design & Engineering" && p.daysSinceStageMovement != null)
      .map((p) => ({
        ...p,
        daysStale: p.daysSinceStageMovement ?? 0,
      }))
      .sort((a, b) => b.daysStale - a.daysStale)
      .slice(0, 10);
  }, [designProjects]);

  // ---- Export data ----
  const exportRows = useMemo(
    () =>
      designProjects.map((p) => ({
        name: p.name,
        stage: p.stage,
        designStatus: p.designStatus || "",
        location: p.pbLocation || "",
        amount: p.amount || 0,
        daysSinceStageMovement: p.daysSinceStageMovement ?? "",
      })),
    [designProjects]
  );

  return (
    <DashboardShell
      title="D&E Overview"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "de-overview.csv" }}
    >
      {/* Hero Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-grid">
        <StatCard
          label="Active D&E Projects"
          value={loading ? null : heroMetrics.activeCount}
          color="purple"
        />
        <StatCard
          label="Avg Design Turnaround"
          value={loading ? null : `${heroMetrics.avgTurnaround}d`}
          subtitle="Close → Design Complete"
          color="purple"
        />
        <StatCard
          label="Approval Rate"
          value={loading ? null : `${heroMetrics.approvalRate}%`}
          subtitle="Completed → Approved"
          color="purple"
        />
        <StatCard
          label="Flagged for Review"
          value={loading ? null : heroMetrics.flagged}
          subtitle="System Performance Review"
          color="purple"
        />
      </div>

      {/* Status Funnel */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">Design Status Funnel</h2>
        <div className="space-y-3">
          {funnelData.map((s) => (
            <div key={s.key} className="flex items-center gap-3">
              <div className="w-44 text-sm text-muted truncate">{s.label}</div>
              <div className="flex-1 h-7 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className={`h-full ${s.color} rounded-full transition-all duration-500 flex items-center justify-end pr-2`}
                  style={{ width: `${Math.max(s.pct, s.count > 0 ? 8 : 0)}%` }}
                >
                  {s.count > 0 && (
                    <span className="text-xs font-semibold text-white">{s.count}</span>
                  )}
                </div>
              </div>
              <div className="w-10 text-right text-sm font-medium text-foreground">{s.count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CO vs CA Split */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h3 className="text-sm font-medium text-muted mb-3">Colorado (CO)</h3>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-foreground">{loading ? "—" : regionSplit.co.count}</span>
            <span className="text-sm text-muted">projects</span>
          </div>
          <div className="text-sm text-muted mt-1">{loading ? "—" : formatMoney(regionSplit.co.revenue)} revenue</div>
        </div>
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h3 className="text-sm font-medium text-muted mb-3">California (CA)</h3>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-foreground">{loading ? "—" : regionSplit.ca.count}</span>
            <span className="text-sm text-muted">projects</span>
          </div>
          <div className="text-sm text-muted mt-1">{loading ? "—" : formatMoney(regionSplit.ca.revenue)} revenue</div>
        </div>
      </div>

      {/* Action Needed — Stale Projects */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">Action Needed — Stale Projects</h2>
        <p className="text-sm text-muted mb-4">
          Top 10 projects with the most days in their current design stage.
        </p>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : staleProjects.length === 0 ? (
          <p className="text-sm text-muted italic">No stale projects found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted">
                  <th className="pb-2 pr-4">Project</th>
                  <th className="pb-2 pr-4">Design Status</th>
                  <th className="pb-2 pr-4">Location</th>
                  <th className="pb-2 pr-4 text-right">Amount</th>
                  <th className="pb-2 text-right">Days Stale</th>
                </tr>
              </thead>
              <tbody>
                {staleProjects.map((p) => (
                  <tr key={p.id} className="border-b border-t-border/50 hover:bg-surface-2/50">
                    <td className="py-2 pr-4">
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 hover:underline">
                          {p.name}
                        </a>
                      ) : (
                        <span className="text-foreground">{p.name}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-muted">{p.designStatus || "—"}</td>
                    <td className="py-2 pr-4 text-muted">{p.pbLocation || "—"}</td>
                    <td className="py-2 pr-4 text-right text-foreground">{formatMoney(p.amount || 0)}</td>
                    <td className="py-2 text-right">
                      <span className={`font-semibold ${p.daysStale > 30 ? "text-red-400" : p.daysStale > 14 ? "text-yellow-400" : "text-foreground"}`}>
                        {p.daysStale}d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">D&E Dashboards</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 stagger-grid">
          {SUB_DASHBOARDS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="group border border-t-border rounded-lg p-4 hover:border-purple-500/50 hover:bg-surface-2/50 transition-all"
            >
              <span className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 mb-2">
                {d.tag}
              </span>
              <div className="text-sm font-medium text-foreground group-hover:text-purple-400 transition-colors">
                {d.title} →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
