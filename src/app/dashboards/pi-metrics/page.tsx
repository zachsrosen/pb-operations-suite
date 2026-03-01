"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MetricCard } from "@/components/ui/MetricCard";
import { MonthlyBarChart, aggregateMonthly } from "@/components/ui/MonthlyBarChart";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";

export default function PIMetricsPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("pi-metrics", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [leadFilter, setLeadFilter] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<string>("all");

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
    if (leadFilter !== "all") result = result.filter((p) => p.permitLead === leadFilter || p.interconnectionsLead === leadFilter);
    if (stageFilter !== "all") result = result.filter((p) => p.stage === stageFilter);
    return result;
  }, [safeProjects, locationFilter, leadFilter, stageFilter]);

  // ---- Permit Metrics ----
  const permitMetrics = useMemo(() => {
    const submitted = filteredProjects.filter((p) => p.permitSubmitDate);
    const issued = filteredProjects.filter((p) => p.permitIssueDate);
    const pending = filteredProjects.filter((p) => p.permitSubmitDate && !p.permitIssueDate);

    return {
      submitted: { count: submitted.length, revenue: submitted.reduce((s, p) => s + (p.amount || 0), 0) },
      issued: { count: issued.length, revenue: issued.reduce((s, p) => s + (p.amount || 0), 0) },
      pending: { count: pending.length, revenue: pending.reduce((s, p) => s + (p.amount || 0), 0) },
    };
  }, [filteredProjects]);

  // ---- IC Metrics ----
  const icMetrics = useMemo(() => {
    const submitted = filteredProjects.filter((p) => p.interconnectionSubmitDate);
    const approved = filteredProjects.filter((p) => p.interconnectionApprovalDate);
    const pending = filteredProjects.filter((p) => p.interconnectionSubmitDate && !p.interconnectionApprovalDate);

    return {
      submitted: { count: submitted.length, revenue: submitted.reduce((s, p) => s + (p.amount || 0), 0) },
      approved: { count: approved.length, revenue: approved.reduce((s, p) => s + (p.amount || 0), 0) },
      pending: { count: pending.length, revenue: pending.reduce((s, p) => s + (p.amount || 0), 0) },
    };
  }, [filteredProjects]);

  // ---- PTO Metrics ----
  const ptoMetrics = useMemo(() => {
    const submitted = filteredProjects.filter((p) => p.ptoSubmitDate);
    const granted = filteredProjects.filter((p) => p.ptoGrantedDate);
    const pending = filteredProjects.filter((p) => p.ptoSubmitDate && !p.ptoGrantedDate);

    return {
      submitted: { count: submitted.length, revenue: submitted.reduce((s, p) => s + (p.amount || 0), 0) },
      granted: { count: granted.length, revenue: granted.reduce((s, p) => s + (p.amount || 0), 0) },
      pending: { count: pending.length, revenue: pending.reduce((s, p) => s + (p.amount || 0), 0) },
    };
  }, [filteredProjects]);

  // ---- Monthly Trends ----
  const permitIssueTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects
        .filter((p) => p.permitIssueDate)
        .map((p) => ({ date: p.permitIssueDate!, amount: p.amount || 0 })),
      6
    ),
    [filteredProjects]
  );

  const icApprovalTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects
        .filter((p) => p.interconnectionApprovalDate)
        .map((p) => ({ date: p.interconnectionApprovalDate!, amount: p.amount || 0 })),
      6
    ),
    [filteredProjects]
  );

  const ptoGrantedTrend = useMemo(
    () => aggregateMonthly(
      filteredProjects
        .filter((p) => p.ptoGrantedDate)
        .map((p) => ({ date: p.ptoGrantedDate!, amount: p.amount || 0 })),
      6
    ),
    [filteredProjects]
  );

  // ---- Status Breakdown ----
  const permitStatusBreakdown = useMemo(() => {
    const counts: Record<string, { count: number; revenue: number }> = {};
    filteredProjects.forEach((p) => {
      if (p.permittingStatus) {
        if (!counts[p.permittingStatus]) counts[p.permittingStatus] = { count: 0, revenue: 0 };
        counts[p.permittingStatus].count += 1;
        counts[p.permittingStatus].revenue += p.amount || 0;
      }
    });
    const max = Math.max(1, ...Object.values(counts).map((c) => c.count));
    return Object.entries(counts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 12)
      .map(([status, data]) => ({ status, ...data, pct: (data.count / max) * 100 }));
  }, [filteredProjects]);

  // ---- Export ----
  const exportRows = useMemo(
    () => filteredProjects
      .filter((p) => p.permittingStatus || p.interconnectionStatus || p.ptoStatus || p.permitSubmitDate)
      .map((p) => ({
        name: p.name,
        stage: p.stage,
        permittingStatus: p.permittingStatus || "",
        permitSubmitDate: p.permitSubmitDate || "",
        permitIssueDate: p.permitIssueDate || "",
        interconnectionStatus: p.interconnectionStatus || "",
        interconnectionSubmitDate: p.interconnectionSubmitDate || "",
        interconnectionApprovalDate: p.interconnectionApprovalDate || "",
        ptoStatus: p.ptoStatus || "",
        ptoSubmitDate: p.ptoSubmitDate || "",
        ptoGrantedDate: p.ptoGrantedDate || "",
        location: p.pbLocation || "",
        ahj: p.ahj || "",
        utility: p.utility || "",
        amount: p.amount || 0,
      })),
    [filteredProjects]
  );

  return (
    <DashboardShell
      title="P&I Metrics"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "pi-metrics.csv" }}
      fullWidth
    >
      {/* Permits Section */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">Permits</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-grid">
          <MetricCard
            label="Permits Submitted"
            value={loading ? "—" : String(permitMetrics.submitted.count)}
            sub={loading ? undefined : formatMoney(permitMetrics.submitted.revenue)}
            border="border-l-4 border-l-cyan-500"
          />
          <MetricCard
            label="Permits Issued"
            value={loading ? "—" : String(permitMetrics.issued.count)}
            sub={loading ? undefined : formatMoney(permitMetrics.issued.revenue)}
            border="border-l-4 border-l-emerald-500"
            valueColor="text-emerald-400"
          />
          <MetricCard
            label="Permits Pending"
            value={loading ? "—" : String(permitMetrics.pending.count)}
            sub={loading ? undefined : formatMoney(permitMetrics.pending.revenue)}
            border="border-l-4 border-l-yellow-500"
            valueColor={permitMetrics.pending.count > 20 ? "text-yellow-400" : undefined}
          />
        </div>
      </div>

      {/* IC Section */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">Interconnection</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-grid">
          <MetricCard
            label="IC Submitted"
            value={loading ? "—" : String(icMetrics.submitted.count)}
            sub={loading ? undefined : formatMoney(icMetrics.submitted.revenue)}
            border="border-l-4 border-l-blue-500"
          />
          <MetricCard
            label="IC Approved"
            value={loading ? "—" : String(icMetrics.approved.count)}
            sub={loading ? undefined : formatMoney(icMetrics.approved.revenue)}
            border="border-l-4 border-l-emerald-500"
            valueColor="text-emerald-400"
          />
          <MetricCard
            label="IC Pending"
            value={loading ? "—" : String(icMetrics.pending.count)}
            sub={loading ? undefined : formatMoney(icMetrics.pending.revenue)}
            border="border-l-4 border-l-yellow-500"
            valueColor={icMetrics.pending.count > 20 ? "text-yellow-400" : undefined}
          />
        </div>
      </div>

      {/* PTO Section */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">Permission to Operate</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-grid">
          <MetricCard
            label="PTO Submitted"
            value={loading ? "—" : String(ptoMetrics.submitted.count)}
            sub={loading ? undefined : formatMoney(ptoMetrics.submitted.revenue)}
            border="border-l-4 border-l-purple-500"
          />
          <MetricCard
            label="PTO Granted"
            value={loading ? "—" : String(ptoMetrics.granted.count)}
            sub={loading ? undefined : formatMoney(ptoMetrics.granted.revenue)}
            border="border-l-4 border-l-emerald-500"
            valueColor="text-emerald-400"
          />
          <MetricCard
            label="PTO Pending"
            value={loading ? "—" : String(ptoMetrics.pending.count)}
            sub={loading ? undefined : formatMoney(ptoMetrics.pending.revenue)}
            border="border-l-4 border-l-orange-500"
            valueColor={ptoMetrics.pending.count > 15 ? "text-orange-400" : undefined}
          />
        </div>
      </div>

      {/* Monthly Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MonthlyBarChart
          title="Permits Issued (6 months)"
          data={permitIssueTrend}
          months={6}
          accentColor="cyan"
          primaryLabel="issued"
        />
        <MonthlyBarChart
          title="IC Approved (6 months)"
          data={icApprovalTrend}
          months={6}
          accentColor="blue"
          primaryLabel="approved"
        />
        <MonthlyBarChart
          title="PTO Granted (6 months)"
          data={ptoGrantedTrend}
          months={6}
          accentColor="emerald"
          primaryLabel="granted"
        />
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
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

      {/* Revenue by Permitting Status */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">Revenue by Permitting Status</h2>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-6 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : permitStatusBreakdown.length === 0 ? (
          <p className="text-sm text-muted italic">No permitting status data.</p>
        ) : (
          <div className="space-y-2">
            {permitStatusBreakdown.map((s) => (
              <div key={s.status} className="flex items-center gap-3">
                <div className="w-48 text-sm text-muted truncate" title={s.status}>{s.status}</div>
                <div className="flex-1 h-6 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                    style={{ width: `${Math.max(s.pct, s.count > 0 ? 6 : 0)}%` }}
                  >
                    {s.count > 0 && <span className="text-xs font-semibold text-white">{s.count}</span>}
                  </div>
                </div>
                <div className="w-24 text-right text-xs text-muted">{formatMoney(s.revenue)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
