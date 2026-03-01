"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// Permitting statuses indicating active/pending
const PERMIT_ACTIVE_STATUSES = [
  "Awaiting Utility Approval",
  "Ready For Permitting",
  "Submitted To Customer",
  "Customer Signature Acquired",
  "Waiting On Information",
  "Submitted to AHJ",
  "Resubmitted to AHJ",
  "Pending SolarApp",
  "Submit SolarApp to AHJ",
];

const PERMIT_REVISION_STATUSES = [
  "Non-Design Related Rejection",
  "Rejected",
  "In Design For Revision",
  "Returned from Design",
  "As-Built Revision Needed",
  "As-Built Revision In Progress",
  "As-Built Ready To Resubmit",
  "As-Built Revision Resubmitted",
];

// IC statuses indicating active
const IC_ACTIVE_STATUSES = [
  "Ready for Interconnection",
  "Submitted To Customer",
  "Ready To Submit - Pending Design",
  "Signature Acquired By Customer",
  "Submitted To Utility",
  "Waiting On Information",
  "Waiting on Utility Bill",
  "Waiting on New Construction",
  "In Review",
];

const IC_REVISION_STATUSES = [
  "Non-Design Related Rejection",
  "Rejected (New)",
  "Rejected",
  "In Design For Revisions",
  "Revision Returned From Design",
  "Resubmitted To Utility",
];

// PTO pipeline statuses
const PTO_PIPELINE_STATUSES = [
  "PTO Waiting on Interconnection Approval",
  "Inspection Passed - Ready for Utility",
  "Inspection Submitted to Utility",
  "Resubmitted to Utility",
  "Inspection Rejected By Utility",
  "Ops Related PTO Rejection",
  "Waiting On Information",
  "Waiting on New Construction",
  "Pending Truck Roll",
  "Xcel Photos Ready to Submit",
  "Xcel Photos Submitted",
  "XCEL Photos Rejected",
  "Xcel Photos Ready to Resubmit",
  "Xcel Photos Resubmitted",
  "Xcel Photos Approved",
];

const PI_LINKS = [
  { href: "/dashboards/pi-metrics", label: "P&I Metrics", desc: "Permit, IC, and PTO KPIs" },
  { href: "/dashboards/pi-action-queue", label: "Action Queue", desc: "Projects needing action" },
  { href: "/dashboards/ahj-tracker", label: "AHJ Tracker", desc: "Per-AHJ permit analytics" },
  { href: "/dashboards/utility-tracker", label: "Utility Tracker", desc: "Per-utility IC analytics" },
  { href: "/dashboards/pi-timeline", label: "Timeline & SLA", desc: "SLA targets & turnaround" },
];

export default function PIOverviewPage() {
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
      trackDashboardView("pi-overview", { projectCount: safeProjects.length });
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

  // Hero metrics
  const heroMetrics = useMemo(() => {
    const permitsPending = filteredProjects.filter(
      (p) => p.permittingStatus && [...PERMIT_ACTIVE_STATUSES, ...PERMIT_REVISION_STATUSES].includes(p.permittingStatus)
    );
    const icActive = filteredProjects.filter(
      (p) => p.interconnectionStatus && [...IC_ACTIVE_STATUSES, ...IC_REVISION_STATUSES].includes(p.interconnectionStatus)
    );
    const ptoPipeline = filteredProjects.filter(
      (p) => p.ptoStatus && PTO_PIPELINE_STATUSES.includes(p.ptoStatus)
    );

    // Avg permit turnaround (submit → issue)
    const turnarounds = filteredProjects
      .filter((p) => p.permitSubmitDate && p.permitIssueDate)
      .map((p) => {
        const d1 = new Date(p.permitSubmitDate! + "T12:00:00");
        const d2 = new Date(p.permitIssueDate! + "T12:00:00");
        return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      })
      .filter((d) => d >= 0 && d < 365);
    const avgTurnaround = turnarounds.length > 0
      ? Math.round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length)
      : 0;

    return {
      permitsPending: permitsPending.length,
      icActive: icActive.length,
      ptoPipeline: ptoPipeline.length,
      avgTurnaround,
    };
  }, [filteredProjects]);

  // Status distributions
  const permitBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredProjects.forEach((p) => {
      if (p.permittingStatus) {
        counts[p.permittingStatus] = (counts[p.permittingStatus] || 0) + 1;
      }
    });
    const max = Math.max(1, ...Object.values(counts));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([status, count]) => ({ status, count, pct: (count / max) * 100 }));
  }, [filteredProjects]);

  const icBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredProjects.forEach((p) => {
      if (p.interconnectionStatus) {
        counts[p.interconnectionStatus] = (counts[p.interconnectionStatus] || 0) + 1;
      }
    });
    const max = Math.max(1, ...Object.values(counts));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([status, count]) => ({ status, count, pct: (count / max) * 100 }));
  }, [filteredProjects]);

  // Stale projects (most days in current P&I stage)
  const staleProjects = useMemo(() => {
    return filteredProjects
      .filter(
        (p) =>
          (p.stage === "Permitting & Interconnection" || p.stage === "Permission To Operate") &&
          (p.daysSinceStageMovement ?? 0) > 0
      )
      .sort((a, b) => (b.daysSinceStageMovement ?? 0) - (a.daysSinceStageMovement ?? 0))
      .slice(0, 10);
  }, [filteredProjects]);

  return (
    <DashboardShell
      title="P&I Overview"
      accentColor="cyan"
      lastUpdated={lastUpdated}
    >
      {/* Hero Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid">
        <StatCard
          label="Permits Pending"
          value={loading ? null : heroMetrics.permitsPending}
          color="cyan"
        />
        <StatCard
          label="IC Apps Active"
          value={loading ? null : heroMetrics.icActive}
          color="blue"
        />
        <StatCard
          label="PTO Pipeline"
          value={loading ? null : heroMetrics.ptoPipeline}
          color="emerald"
        />
        <StatCard
          label="Avg Permit Turnaround"
          value={loading ? null : `${heroMetrics.avgTurnaround}d`}
          color="purple"
        />
      </div>

      {/* Status Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Permitting */}
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Permitting Status</h2>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-6 bg-skeleton rounded animate-pulse" />
              ))}
            </div>
          ) : permitBreakdown.length === 0 ? (
            <p className="text-sm text-muted italic">No permitting status data.</p>
          ) : (
            <div className="space-y-2">
              {permitBreakdown.map((s) => (
                <div key={s.status} className="flex items-center gap-3">
                  <div className="w-44 text-xs text-muted truncate" title={s.status}>{s.status}</div>
                  <div className="flex-1 h-5 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                      style={{ width: `${Math.max(s.pct, s.count > 0 ? 8 : 0)}%` }}
                    >
                      {s.count > 0 && <span className="text-xs font-semibold text-white">{s.count}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Interconnection */}
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Interconnection Status</h2>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-6 bg-skeleton rounded animate-pulse" />
              ))}
            </div>
          ) : icBreakdown.length === 0 ? (
            <p className="text-sm text-muted italic">No interconnection status data.</p>
          ) : (
            <div className="space-y-2">
              {icBreakdown.map((s) => (
                <div key={s.status} className="flex items-center gap-3">
                  <div className="w-44 text-xs text-muted truncate" title={s.status}>{s.status}</div>
                  <div className="flex-1 h-5 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                      style={{ width: `${Math.max(s.pct, s.count > 0 ? 8 : 0)}%` }}
                    >
                      {s.count > 0 && <span className="text-xs font-semibold text-white">{s.count}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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

      {/* Stale Projects */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">Top 10 Stale P&I Projects</h2>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : staleProjects.length === 0 ? (
          <p className="text-sm text-muted italic">No stale P&I projects.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted">
                  <th className="pb-2 pr-4">Project</th>
                  <th className="pb-2 pr-4">Stage</th>
                  <th className="pb-2 pr-4">P&I Lead</th>
                  <th className="pb-2 pr-4">AHJ / Utility</th>
                  <th className="pb-2 pr-4 text-right">Days in Stage</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {staleProjects.map((p) => (
                  <tr key={p.id} className="border-b border-t-border/50">
                    <td className="py-2 pr-4">
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 hover:underline">
                          {p.name}
                        </a>
                      ) : (
                        <span className="text-foreground">{p.name}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-muted">{p.stage}</td>
                    <td className="py-2 pr-4 text-muted">{p.permitLead || p.interconnectionsLead || "—"}</td>
                    <td className="py-2 pr-4 text-muted text-xs">{p.ahj || p.utility || "—"}</td>
                    <td className="py-2 pr-4 text-right">
                      <span className={`font-semibold ${(p.daysSinceStageMovement ?? 0) > 21 ? "text-red-400" : (p.daysSinceStageMovement ?? 0) > 10 ? "text-yellow-400" : "text-foreground"}`}>
                        {p.daysSinceStageMovement ?? 0}d
                      </span>
                    </td>
                    <td className="py-2 text-right text-foreground">{formatMoney(p.amount || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">P&I Dashboards</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger-grid">
          {PI_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="group bg-surface border border-t-border rounded-lg p-4 shadow-card hover:border-cyan-500/50 transition-colors"
            >
              <div className="font-medium text-foreground group-hover:text-cyan-400 transition-colors">{link.label}</div>
              <div className="text-xs text-muted mt-1">{link.desc}</div>
            </a>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
