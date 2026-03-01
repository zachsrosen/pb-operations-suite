"use client";

import { useMemo, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MetricCard } from "@/components/ui/MetricCard";
import { MonthlyBarChart, aggregateMonthly } from "@/components/ui/MonthlyBarChart";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---- Types ----

interface ExtendedProject extends RawProject {
  designStatus?: string;
  layoutStatus?: string;
  designCompletionDate?: string;
  designApprovalDate?: string;
  designLead?: string;
  projectManager?: string;
}

// Status groupings for metrics
const DRAFT_STATUSES = [
  "Ready for Design",
  "In Progress",
];

const IN_ENGINEERING_STATUSES = [
  "Submitted To Engineering",
];

const REVISION_STATUSES = [
  "Revision Needed - DA Rejected",
  "DA Revision In Progress",
  "DA Revision Completed",
  "Revision Needed - Rejected by AHJ",
  "Permit Revision In Progress",
  "Permit Revision Completed",
  "Revision Needed - Rejected by Utility",
  "Utility Revision In Progress",
  "Utility Revision Completed",
  "Revision Needed - As-Built",
  "As-Built Revision In Progress",
  "As-Built Revision Completed",
];

export default function DEMetricsPage() {
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
      trackDashboardView("de-metrics", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // Filter to projects with any design data
  const designProjects = useMemo(
    () => safeProjects.filter(
      (p) =>
        p.stage === "Design & Engineering" ||
        p.designStatus ||
        p.designCompletionDate ||
        p.designApprovalDate
    ),
    [safeProjects]
  );

  // ---- Approval Metrics ----
  const approvalMetrics = useMemo(() => {
    const sent = designProjects.filter((p) => p.designCompletionDate);
    const approved = designProjects.filter((p) => p.designApprovalDate);
    const pending = designProjects.filter((p) => p.designCompletionDate && !p.designApprovalDate);

    return {
      sent: { count: sent.length, revenue: sent.reduce((s, p) => s + (p.amount || 0), 0) },
      approved: { count: approved.length, revenue: approved.reduce((s, p) => s + (p.amount || 0), 0) },
      pending: { count: pending.length, revenue: pending.reduce((s, p) => s + (p.amount || 0), 0) },
    };
  }, [designProjects]);

  // ---- Design Status Metrics ----
  const designMetrics = useMemo(() => {
    const drafted = designProjects.filter((p) => p.designStatus && DRAFT_STATUSES.includes(p.designStatus));
    const inEngineering = designProjects.filter((p) => p.designStatus && IN_ENGINEERING_STATUSES.includes(p.designStatus));
    const completed = designProjects.filter((p) => p.designCompletionDate);
    const inRevision = designProjects.filter((p) => p.designStatus && REVISION_STATUSES.includes(p.designStatus));

    return {
      drafted: { count: drafted.length, revenue: drafted.reduce((s, p) => s + (p.amount || 0), 0) },
      inEngineering: { count: inEngineering.length, revenue: inEngineering.reduce((s, p) => s + (p.amount || 0), 0) },
      completed: { count: completed.length, revenue: completed.reduce((s, p) => s + (p.amount || 0), 0) },
      inRevision: { count: inRevision.length, revenue: inRevision.reduce((s, p) => s + (p.amount || 0), 0) },
    };
  }, [designProjects]);

  // ---- Status breakdown for horizontal bars ----
  const statusBreakdown = useMemo(() => {
    const counts: Record<string, { count: number; revenue: number }> = {};
    designProjects.forEach((p) => {
      if (p.designStatus) {
        if (!counts[p.designStatus]) counts[p.designStatus] = { count: 0, revenue: 0 };
        counts[p.designStatus].count += 1;
        counts[p.designStatus].revenue += p.amount || 0;
      }
    });
    const maxCount = Math.max(1, ...Object.values(counts).map((c) => c.count));
    return Object.entries(counts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15)
      .map(([status, data]) => ({
        status,
        ...data,
        pct: (data.count / maxCount) * 100,
      }));
  }, [designProjects]);

  // ---- Monthly trends ----
  const completionTrend = useMemo(
    () => aggregateMonthly(
      designProjects
        .filter((p) => p.designCompletionDate)
        .map((p) => ({ date: p.designCompletionDate!, amount: p.amount || 0 })),
      6
    ),
    [designProjects]
  );

  const approvalTrend = useMemo(
    () => aggregateMonthly(
      designProjects
        .filter((p) => p.designApprovalDate)
        .map((p) => ({ date: p.designApprovalDate!, amount: p.amount || 0 })),
      6
    ),
    [designProjects]
  );

  // ---- Designer productivity ----
  const designerStats = useMemo(() => {
    const byDesigner: Record<string, { count: number; revenue: number }> = {};
    designProjects.forEach((p) => {
      const designer = p.designLead || p.projectManager || "Unassigned";
      if (!byDesigner[designer]) byDesigner[designer] = { count: 0, revenue: 0 };
      byDesigner[designer].count += 1;
      byDesigner[designer].revenue += p.amount || 0;
    });
    return Object.entries(byDesigner)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);
  }, [designProjects]);

  // ---- Export ----
  const exportRows = useMemo(
    () => designProjects.map((p) => ({
      name: p.name,
      designLead: p.designLead || p.projectManager || "",
      stage: p.stage,
      designStatus: p.designStatus || "",
      designCompletionDate: p.designCompletionDate || "",
      designApprovalDate: p.designApprovalDate || "",
      location: p.pbLocation || "",
      amount: p.amount || 0,
    })),
    [designProjects]
  );

  return (
    <DashboardShell
      title="D&E Metrics"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "de-metrics.csv" }}
      fullWidth
    >
      {/* Design Approvals Section */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">Design Approvals</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-grid">
          <MetricCard
            label="Sent for Approval"
            value={loading ? "—" : String(approvalMetrics.sent.count)}
            sub={loading ? undefined : formatMoney(approvalMetrics.sent.revenue)}
            border="border-l-4 border-l-blue-500"
          />
          <MetricCard
            label="Approved"
            value={loading ? "—" : String(approvalMetrics.approved.count)}
            sub={loading ? undefined : formatMoney(approvalMetrics.approved.revenue)}
            border="border-l-4 border-l-emerald-500"
            valueColor="text-emerald-400"
          />
          <MetricCard
            label="Pending Approval"
            value={loading ? "—" : String(approvalMetrics.pending.count)}
            sub={loading ? undefined : formatMoney(approvalMetrics.pending.revenue)}
            border="border-l-4 border-l-yellow-500"
            valueColor={approvalMetrics.pending.count > 10 ? "text-yellow-400" : undefined}
          />
        </div>
      </div>

      {/* Designs Section */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">Design Pipeline</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid">
          <MetricCard
            label="In Draft / Design"
            value={loading ? "—" : String(designMetrics.drafted.count)}
            sub={loading ? undefined : formatMoney(designMetrics.drafted.revenue)}
            border="border-l-4 border-l-slate-500"
          />
          <MetricCard
            label="In Engineering"
            value={loading ? "—" : String(designMetrics.inEngineering.count)}
            sub={loading ? undefined : formatMoney(designMetrics.inEngineering.revenue)}
            border="border-l-4 border-l-cyan-500"
          />
          <MetricCard
            label="Design Complete"
            value={loading ? "—" : String(designMetrics.completed.count)}
            sub={loading ? undefined : formatMoney(designMetrics.completed.revenue)}
            border="border-l-4 border-l-emerald-500"
            valueColor="text-emerald-400"
          />
          <MetricCard
            label="In Revision"
            value={loading ? "—" : String(designMetrics.inRevision.count)}
            sub={loading ? undefined : formatMoney(designMetrics.inRevision.revenue)}
            border="border-l-4 border-l-orange-500"
            valueColor={designMetrics.inRevision.count > 5 ? "text-orange-400" : undefined}
          />
        </div>
      </div>

      {/* Monthly Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MonthlyBarChart
          title="Design Completions (6 months)"
          data={completionTrend}
          months={6}
          accentColor="purple"
          primaryLabel="completed"
        />
        <MonthlyBarChart
          title="Design Approvals (6 months)"
          data={approvalTrend}
          months={6}
          accentColor="emerald"
          primaryLabel="approved"
        />
      </div>

      {/* Deal Counts by Design Status */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">Projects by Design Status</h2>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : statusBreakdown.length === 0 ? (
          <p className="text-sm text-muted italic">No design status data available.</p>
        ) : (
          <div className="space-y-2">
            {statusBreakdown.map((s) => (
              <div key={s.status} className="flex items-center gap-3">
                <div className="w-52 text-sm text-muted truncate" title={s.status}>{s.status}</div>
                <div className="flex-1 h-6 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                    style={{ width: `${Math.max(s.pct, s.count > 0 ? 6 : 0)}%` }}
                  >
                    {s.count > 0 && (
                      <span className="text-xs font-semibold text-white">{s.count}</span>
                    )}
                  </div>
                </div>
                <div className="w-24 text-right text-xs text-muted">{formatMoney(s.revenue)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Designer / Lead Productivity */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">Projects by Design Lead</h2>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : designerStats.length === 0 ? (
          <p className="text-sm text-muted italic">No designer data available.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted">
                  <th className="pb-2 pr-4">Design Lead / PM</th>
                  <th className="pb-2 pr-4 text-right">Projects</th>
                  <th className="pb-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {designerStats.map(([designer, data]) => (
                  <tr key={designer} className="border-b border-t-border/50">
                    <td className="py-2 pr-4 text-foreground">{designer}</td>
                    <td className="py-2 pr-4 text-right font-semibold text-foreground">{data.count}</td>
                    <td className="py-2 text-right text-muted">{formatMoney(data.revenue)}</td>
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
