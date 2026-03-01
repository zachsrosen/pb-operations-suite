"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---- SLA Targets (days) ----
const SLA_TARGETS = {
  permitIssueDays: 30,     // permit submission → issuance
  icApprovalDays: 45,      // IC submission → approval
  ptoDays: 14,             // PTO submission → granted
};

// ---- Helpers ----

function daysBetween(d1?: string, d2?: string): number | null {
  if (!d1 || !d2) return null;
  const a = new Date(d1 + "T12:00:00");
  const b = new Date(d2 + "T12:00:00");
  const diff = Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  return diff >= 0 && diff < 730 ? diff : null;
}

interface SLAResult {
  label: string;
  target: number;
  items: { project: RawProject; days: number }[];
  onTime: number;
  late: number;
  avg: number;
  pctOnTime: number;
}

export default function PITimelinePage() {
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
      trackDashboardView("pi-timeline", { projectCount: safeProjects.length });
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

  // ---- SLA Calculations ----

  const slaResults = useMemo((): SLAResult[] => {
    // Permit Issue SLA: permitSubmitDate → permitIssueDate
    const permitItems = safeProjects
      .map((p) => ({ project: p, days: daysBetween(p.permitSubmitDate, p.permitIssueDate) }))
      .filter((x): x is { project: RawProject; days: number } => x.days !== null);

    // IC Approval SLA: interconnectionSubmitDate → interconnectionApprovalDate
    const icItems = safeProjects
      .map((p) => ({ project: p, days: daysBetween(p.interconnectionSubmitDate, p.interconnectionApprovalDate) }))
      .filter((x): x is { project: RawProject; days: number } => x.days !== null);

    // PTO SLA: ptoSubmitDate → ptoGrantedDate
    const ptoItems = safeProjects
      .map((p) => ({ project: p, days: daysBetween(p.ptoSubmitDate, p.ptoGrantedDate) }))
      .filter((x): x is { project: RawProject; days: number } => x.days !== null);

    function buildResult(label: string, target: number, items: { project: RawProject; days: number }[]): SLAResult {
      const onTime = items.filter((i) => i.days <= target).length;
      const late = items.length - onTime;
      const avg = items.length > 0 ? Math.round(items.reduce((s, i) => s + i.days, 0) / items.length) : 0;
      const pctOnTime = items.length > 0 ? Math.round((onTime / items.length) * 100) : 0;
      return { label, target, items, onTime, late, avg, pctOnTime };
    }

    return [
      buildResult("Permit Issuance", SLA_TARGETS.permitIssueDays, permitItems),
      buildResult("IC Approval", SLA_TARGETS.icApprovalDays, icItems),
      buildResult("PTO Granted", SLA_TARGETS.ptoDays, ptoItems),
    ];
  }, [safeProjects]);

  // ---- AHJ Turnaround Comparison ----
  const ahjTurnarounds = useMemo(() => {
    const map: Record<string, { display: string; turnarounds: number[] }> = {};
    safeProjects.forEach((p) => {
      const ahj = p.ahj?.trim();
      if (!ahj) return;
      const days = daysBetween(p.permitSubmitDate, p.permitIssueDate);
      if (days === null) return;
      const key = ahj.toLowerCase();
      if (!map[key]) map[key] = { display: ahj, turnarounds: [] };
      map[key].turnarounds.push(days);
    });

    return Object.entries(map)
      .map(([, entry]) => ({
        name: entry.display,
        count: entry.turnarounds.length,
        avg: Math.round(entry.turnarounds.reduce((s, d) => s + d, 0) / entry.turnarounds.length),
      }))
      .filter((r) => r.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [safeProjects]);

  // ---- Utility IC Turnaround Comparison ----
  const utilityTurnarounds = useMemo(() => {
    const map: Record<string, { display: string; turnarounds: number[] }> = {};
    safeProjects.forEach((p) => {
      const util = p.utility?.trim();
      if (!util) return;
      const days = daysBetween(p.interconnectionSubmitDate, p.interconnectionApprovalDate);
      if (days === null) return;
      const key = util.toLowerCase();
      if (!map[key]) map[key] = { display: util, turnarounds: [] };
      map[key].turnarounds.push(days);
    });

    return Object.entries(map)
      .map(([, entry]) => ({
        name: entry.display,
        count: entry.turnarounds.length,
        avg: Math.round(entry.turnarounds.reduce((s, d) => s + d, 0) / entry.turnarounds.length),
      }))
      .filter((r) => r.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [safeProjects]);

  // ---- Recent PTO Completions Timeline ----
  const recentCompletions = useMemo(() => {
    return filteredProjects
      .filter((p) => p.ptoGrantedDate)
      .sort((a, b) => (b.ptoGrantedDate || "").localeCompare(a.ptoGrantedDate || ""))
      .slice(0, 20)
      .map((p) => {
        const permitDays = daysBetween(p.permitSubmitDate, p.permitIssueDate);
        const icDays = daysBetween(p.interconnectionSubmitDate, p.interconnectionApprovalDate);
        const ptoDays = daysBetween(p.ptoSubmitDate, p.ptoGrantedDate);
        return { project: p, permitDays, icDays, ptoDays };
      });
  }, [filteredProjects]);

  // ---- Export ----
  const exportRows = useMemo(
    () => filteredProjects
      .filter((p) => p.permitSubmitDate || p.interconnectionSubmitDate || p.ptoSubmitDate)
      .map((p) => ({
        name: p.name,
        ahj: p.ahj || "",
        utility: p.utility || "",
        permitSubmitDate: p.permitSubmitDate || "",
        permitIssueDate: p.permitIssueDate || "",
        permitDays: daysBetween(p.permitSubmitDate, p.permitIssueDate) ?? "",
        icSubmitDate: p.interconnectionSubmitDate || "",
        icApprovalDate: p.interconnectionApprovalDate || "",
        icDays: daysBetween(p.interconnectionSubmitDate, p.interconnectionApprovalDate) ?? "",
        ptoSubmitDate: p.ptoSubmitDate || "",
        ptoGrantedDate: p.ptoGrantedDate || "",
        ptoDays: daysBetween(p.ptoSubmitDate, p.ptoGrantedDate) ?? "",
        amount: p.amount || 0,
      })),
    [filteredProjects]
  );

  function slaColor(days: number, target: number): string {
    if (days <= target) return "text-emerald-400";
    if (days <= target * 1.5) return "text-yellow-400";
    return "text-red-400";
  }

  return (
    <DashboardShell
      title="Timeline & SLA"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "pi-timeline.csv" }}
      fullWidth
    >
      {/* SLA Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger-grid">
        {slaResults.map((sla) => (
          <StatCard
            key={sla.label}
            label={`${sla.label} On-Time`}
            value={loading ? null : sla.items.length > 0 ? `${sla.pctOnTime}%` : "—"}
            color={sla.pctOnTime >= 80 ? "emerald" : sla.pctOnTime >= 60 ? "yellow" : "red"}
          />
        ))}
      </div>

      {/* SLA Detail Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {slaResults.map((sla) => (
          <div key={sla.label} className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
            <h3 className="text-sm font-semibold text-foreground mb-3">{sla.label}</h3>
            {loading ? (
              <div className="space-y-2">
                <div className="h-4 bg-skeleton rounded animate-pulse" />
                <div className="h-8 bg-skeleton rounded animate-pulse" />
              </div>
            ) : sla.items.length === 0 ? (
              <p className="text-sm text-muted italic">No data available.</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 text-center mb-4">
                  <div>
                    <div className="text-lg font-bold text-foreground">{sla.target}d</div>
                    <div className="text-xs text-muted">Target</div>
                  </div>
                  <div>
                    <div className={`text-lg font-bold ${sla.avg <= sla.target ? "text-emerald-400" : sla.avg <= sla.target * 1.5 ? "text-yellow-400" : "text-red-400"}`}>
                      {sla.avg}d
                    </div>
                    <div className="text-xs text-muted">Actual Avg</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-foreground">{sla.items.length}</div>
                    <div className="text-xs text-muted">Projects</div>
                  </div>
                </div>
                {/* On-time bar */}
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-muted mb-1">
                    <span>On time: {sla.onTime}</span>
                    <span>Late: {sla.late}</span>
                  </div>
                  <div className="h-4 bg-surface-2 rounded-full overflow-hidden flex">
                    {sla.pctOnTime > 0 && (
                      <div
                        className="h-full bg-emerald-500 transition-all duration-500"
                        style={{ width: `${sla.pctOnTime}%` }}
                      />
                    )}
                    {100 - sla.pctOnTime > 0 && (
                      <div
                        className="h-full bg-red-500/60 transition-all duration-500"
                        style={{ width: `${100 - sla.pctOnTime}%` }}
                      />
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted text-center">{sla.pctOnTime}% on time (≤{sla.target} days)</div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* AHJ & Utility Turnaround Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* AHJ Comparison */}
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">AHJ Permit Turnaround</h2>
          <p className="text-xs text-muted mb-3">Target: ≤{SLA_TARGETS.permitIssueDays} days (permit submit → issue)</p>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-6 bg-skeleton rounded animate-pulse" />
              ))}
            </div>
          ) : ahjTurnarounds.length === 0 ? (
            <p className="text-sm text-muted italic">No AHJ turnaround data (need ≥2 completed permits per AHJ).</p>
          ) : (
            <div className="space-y-2">
              {ahjTurnarounds.map((r) => (
                <div key={r.name} className="flex items-center gap-3">
                  <div className="w-40 text-xs text-muted truncate" title={r.name}>{r.name}</div>
                  <div className="flex-1 h-5 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${r.avg <= SLA_TARGETS.permitIssueDays ? "bg-emerald-500" : r.avg <= SLA_TARGETS.permitIssueDays * 2 ? "bg-yellow-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min(100, (r.avg / (SLA_TARGETS.permitIssueDays * 3)) * 100)}%` }}
                    />
                  </div>
                  <div className={`w-12 text-right text-xs font-semibold ${slaColor(r.avg, SLA_TARGETS.permitIssueDays)}`}>
                    {r.avg}d
                  </div>
                  <div className="w-8 text-right text-xs text-muted">{r.count}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Utility Comparison */}
        <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Utility IC Turnaround</h2>
          <p className="text-xs text-muted mb-3">Target: ≤{SLA_TARGETS.icApprovalDays} days (IC submit → approval)</p>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-6 bg-skeleton rounded animate-pulse" />
              ))}
            </div>
          ) : utilityTurnarounds.length === 0 ? (
            <p className="text-sm text-muted italic">No utility turnaround data (need ≥2 completed IC apps per utility).</p>
          ) : (
            <div className="space-y-2">
              {utilityTurnarounds.map((r) => (
                <div key={r.name} className="flex items-center gap-3">
                  <div className="w-40 text-xs text-muted truncate" title={r.name}>{r.name}</div>
                  <div className="flex-1 h-5 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${r.avg <= SLA_TARGETS.icApprovalDays ? "bg-emerald-500" : r.avg <= SLA_TARGETS.icApprovalDays * 2 ? "bg-yellow-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min(100, (r.avg / (SLA_TARGETS.icApprovalDays * 3)) * 100)}%` }}
                    />
                  </div>
                  <div className={`w-12 text-right text-xs font-semibold ${slaColor(r.avg, SLA_TARGETS.icApprovalDays)}`}>
                    {r.avg}d
                  </div>
                  <div className="w-8 text-right text-xs text-muted">{r.count}</div>
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

      {/* Recent PTO Completions */}
      <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">Recent PTO Completions</h2>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : recentCompletions.length === 0 ? (
          <p className="text-sm text-muted italic">No completed PTO projects.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted">
                  <th className="pb-2 pr-4">Project</th>
                  <th className="pb-2 pr-4 text-center">Permit</th>
                  <th className="pb-2 pr-4 text-center">IC</th>
                  <th className="pb-2 pr-4 text-center">PTO</th>
                  <th className="pb-2 pr-4">PTO Granted</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recentCompletions.map((item) => (
                  <tr key={item.project.id} className="border-b border-t-border/50">
                    <td className="py-2 pr-4">
                      {item.project.url ? (
                        <a href={item.project.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 hover:underline">
                          {item.project.name}
                        </a>
                      ) : (
                        <span className="text-foreground">{item.project.name}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-center">
                      {item.permitDays !== null ? (
                        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${item.permitDays <= SLA_TARGETS.permitIssueDays ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                          {item.permitDays}d
                        </span>
                      ) : (
                        <span className="text-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-center">
                      {item.icDays !== null ? (
                        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${item.icDays <= SLA_TARGETS.icApprovalDays ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                          {item.icDays}d
                        </span>
                      ) : (
                        <span className="text-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-center">
                      {item.ptoDays !== null ? (
                        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${item.ptoDays <= SLA_TARGETS.ptoDays ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                          {item.ptoDays}d
                        </span>
                      ) : (
                        <span className="text-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs text-muted">{item.project.ptoGrantedDate}</td>
                    <td className="py-2 text-right text-foreground">{formatMoney(item.project.amount || 0)}</td>
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
