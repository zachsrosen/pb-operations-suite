"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard, MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project {
  projectName?: string;
  homeownerName?: string;
  pbLocation?: string;
  stage?: string;
  amount?: number;
  projectManager?: string;
  operationsManager?: string;
  permittingStatus?: string;
  interconnectionStatus?: string;
  permitSubmitDate?: string;
  permitIssueDate?: string;
  interconnectionSubmitDate?: string;
  interconnectionApprovalDate?: string;
  permitTurnaroundTime?: number | null;
  interconnectionTurnaroundTime?: number | null;
  timeToSubmitPermit?: number | null;
  timeToSubmitInterconnection?: number | null;
  ahj?: string;
  utility?: string;
  ptoStatus?: string;
  ptoSubmitDate?: string;
  ptoGrantedDate?: string;
}

// ---------------------------------------------------------------------------
// Status grouping helpers
// ---------------------------------------------------------------------------

const PERMIT_PRE_SUBMISSION = new Set([
  "Ready For Permitting",
  "Submitted To Customer",
  "Customer Signature Acquired",
  "Awaiting Utility Approval",
  "Waiting On Information",
  "Pending SolarApp",
  "Submit SolarApp to AHJ",
]);

const PERMIT_SUBMITTED = new Set([
  "Submitted to AHJ",
  "Resubmitted to AHJ",
]);

const PERMIT_REJECTIONS = new Set([
  "Rejected",
  "In Design For Revision",
  "Returned from Design",
  "Non-Design Related Rejection",
  "As-Built Revision Needed/In Progress/Ready To Resubmit/Resubmitted",
]);

const PERMIT_COMPLETE = new Set(["Complete"]);

const IC_INITIAL = new Set([
  "Ready for Interconnection",
  "Submitted To Customer",
  "Ready To Submit - Pending Design",
  "Signature Acquired By Customer",
  "Waiting On Information",
]);

const IC_SUBMITTED = new Set([
  "Submitted To Utility",
  "Resubmitted To Utility",
  "In Review",
  "Supplemental Review",
]);

const IC_REJECTIONS = new Set([
  "Rejected (New)",
  "Rejected",
  "Transformer Upgrade",
]);

const IC_APPROVED = new Set([
  "Application Approved",
  "Application Approved - Pending Signatures",
  "Conditional Application Approval",
]);

type StatusGroup = { label: string; color: string; statuses: Set<string> };

const PERMIT_GROUPS: StatusGroup[] = [
  { label: "Pre-Submission", color: "bg-blue-500", statuses: PERMIT_PRE_SUBMISSION },
  { label: "Submitted", color: "bg-yellow-500", statuses: PERMIT_SUBMITTED },
  { label: "Rejections / Revisions", color: "bg-orange-500", statuses: PERMIT_REJECTIONS },
  { label: "Complete", color: "bg-green-500", statuses: PERMIT_COMPLETE },
];

const IC_GROUPS: StatusGroup[] = [
  { label: "Initial", color: "bg-blue-500", statuses: IC_INITIAL },
  { label: "Submitted / In Review", color: "bg-yellow-500", statuses: IC_SUBMITTED },
  { label: "Rejections / Revisions", color: "bg-orange-500", statuses: IC_REJECTIONS },
  { label: "Approved", color: "bg-green-500", statuses: IC_APPROVED },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function statusColor(status: string): string {
  if (PERMIT_COMPLETE.has(status) || IC_APPROVED.has(status)) return "text-green-400";
  if (PERMIT_SUBMITTED.has(status) || IC_SUBMITTED.has(status)) return "text-yellow-400";
  if (PERMIT_REJECTIONS.has(status) || IC_REJECTIONS.has(status)) return "text-orange-400";
  return "text-muted";
}

function cellBg(count: number): string {
  if (count === 0) return "";
  if (count <= 2) return "bg-blue-500/10";
  if (count <= 5) return "bg-yellow-500/15";
  if (count <= 10) return "bg-orange-500/15";
  return "bg-red-500/15";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PermittingInterconnectionPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Filters
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterPMs, setFilterPMs] = useState<string[]>([]);
  const [filterUtilities, setFilterUtilities] = useState<string[]>([]);

  // Collapsible sections
  const [showPermitMatrix, setShowPermitMatrix] = useState(false);
  const [showICMatrix, setShowICMatrix] = useState(false);

  // ---- Data Fetch ----
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/projects?active=true");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setProjects(json.projects || json.data || []);
      setLastUpdated(json.lastUpdated || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("permitting-interconnection", {
        projectCount: projects.length,
      });
    }
  }, [loading, projects.length, trackDashboardView]);

  // ---- Filter options ----
  const filterOptions = useMemo(() => {
    const locs = [...new Set(projects.map((p) => p.pbLocation).filter(Boolean) as string[])].sort();
    const pms = [...new Set(projects.map((p) => p.projectManager).filter(Boolean) as string[])].sort();
    const utils = [...new Set(projects.map((p) => p.utility).filter(Boolean) as string[])].sort();
    return {
      locations: locs.map((v) => ({ value: v, label: v })),
      pms: pms.map((v) => ({ value: v, label: v })),
      utilities: utils.map((v) => ({ value: v, label: v })),
    };
  }, [projects]);

  // ---- Filtered projects ----
  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (filterLocations.length > 0 && !filterLocations.includes(p.pbLocation || "")) return false;
      if (filterPMs.length > 0 && !filterPMs.includes(p.projectManager || "")) return false;
      if (filterUtilities.length > 0 && !filterUtilities.includes(p.utility || "")) return false;
      return true;
    });
  }, [projects, filterLocations, filterPMs, filterUtilities]);

  // ---- Summary stats ----
  const summary = useMemo(() => {
    const permitsSubmitted = filtered.filter(
      (p) => p.permittingStatus === "Submitted to AHJ" || p.permittingStatus === "Resubmitted to AHJ"
    ).length;
    const permitsIssued = filtered.filter((p) => p.permittingStatus === "Complete").length;
    const icSubmitted = filtered.filter(
      (p) =>
        p.interconnectionStatus === "Submitted To Utility" ||
        p.interconnectionStatus === "Resubmitted To Utility"
    ).length;
    const icApproved = filtered.filter((p) =>
      IC_APPROVED.has(p.interconnectionStatus || "")
    ).length;

    const permitTTs = filtered
      .map((p) => p.permitTurnaroundTime)
      .filter((v): v is number => v != null && v > 0);
    const icTTs = filtered
      .map((p) => p.interconnectionTurnaroundTime)
      .filter((v): v is number => v != null && v > 0);

    return {
      permitsSubmitted,
      permitsIssued,
      icSubmitted,
      icApproved,
      avgPermitTT: avg(permitTTs),
      avgICTT: avg(icTTs),
    };
  }, [filtered]);

  // ---- Permitting status breakdown ----
  const permitBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of filtered) {
      const s = p.permittingStatus || "Unknown";
      counts[s] = (counts[s] || 0) + 1;
    }
    const maxCount = Math.max(1, ...Object.values(counts));
    return { counts, maxCount };
  }, [filtered]);

  // ---- IC status breakdown ----
  const icBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of filtered) {
      const s = p.interconnectionStatus || "Unknown";
      counts[s] = (counts[s] || 0) + 1;
    }
    const maxCount = Math.max(1, ...Object.values(counts));
    return { counts, maxCount };
  }, [filtered]);

  // ---- Not submitted / not issued by location ----
  const locationGaps = useMemo(() => {
    const locs = [...new Set(filtered.map((p) => p.pbLocation).filter(Boolean) as string[])].sort();
    return locs.map((loc) => {
      const locProjects = filtered.filter((p) => p.pbLocation === loc);
      const permitNotSubmitted = locProjects.filter(
        (p) =>
          !p.permittingStatus ||
          PERMIT_PRE_SUBMISSION.has(p.permittingStatus) ||
          p.permittingStatus === "Not Needed"
      ).length;
      const icNotSubmitted = locProjects.filter(
        (p) =>
          !p.interconnectionStatus ||
          IC_INITIAL.has(p.interconnectionStatus) ||
          p.interconnectionStatus === "Not Needed"
      ).length;
      return { location: loc, total: locProjects.length, permitNotSubmitted, icNotSubmitted };
    });
  }, [filtered]);

  // ---- Avg turnaround by utility ----
  const utilityTurnarounds = useMemo(() => {
    const byUtil: Record<string, { permitTTs: number[]; icTTs: number[]; count: number }> = {};
    for (const p of filtered) {
      const u = p.utility || "";
      if (!u || u === "Unknown" || u === "") continue;
      if (!byUtil[u]) byUtil[u] = { permitTTs: [], icTTs: [], count: 0 };
      byUtil[u].count++;
      if (p.permitTurnaroundTime != null && p.permitTurnaroundTime > 0)
        byUtil[u].permitTTs.push(p.permitTurnaroundTime);
      if (p.interconnectionTurnaroundTime != null && p.interconnectionTurnaroundTime > 0)
        byUtil[u].icTTs.push(p.interconnectionTurnaroundTime);
    }
    return Object.entries(byUtil)
      .map(([utility, d]) => ({
        utility,
        avgPermitTT: avg(d.permitTTs),
        avgICTT: avg(d.icTTs),
        count: d.count,
      }))
      .sort((a, b) => b.avgICTT - a.avgICTT);
  }, [filtered]);

  // ---- By AHJ (top 15) ----
  const ahjStats = useMemo(() => {
    const byAhj: Record<string, { total: number; submitted: number; issued: number }> = {};
    for (const p of filtered) {
      const a = p.ahj || "";
      if (!a || a === "Unknown" || a === "") continue;
      if (!byAhj[a]) byAhj[a] = { total: 0, submitted: 0, issued: 0 };
      byAhj[a].total++;
      if (PERMIT_SUBMITTED.has(p.permittingStatus || "")) byAhj[a].submitted++;
      if (p.permittingStatus === "Complete") byAhj[a].issued++;
    }
    return Object.entries(byAhj)
      .map(([ahj, d]) => ({ ahj, ...d }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);
  }, [filtered]);

  // ---- Stage x Permitting Status Matrix ----
  const permitMatrix = useMemo(() => {
    const stageCounts: Record<string, Record<string, number>> = {};
    const statusTotals: Record<string, number> = {};
    for (const p of filtered) {
      const stage = p.stage || "Unknown";
      const status = p.permittingStatus || "Unknown";
      if (!stageCounts[stage]) stageCounts[stage] = {};
      stageCounts[stage][status] = (stageCounts[stage][status] || 0) + 1;
      statusTotals[status] = (statusTotals[status] || 0) + 1;
    }
    const topStatuses = Object.entries(statusTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([s]) => s);
    const stages = Object.keys(stageCounts).sort();
    return { stageCounts, topStatuses, stages };
  }, [filtered]);

  // ---- Stage x IC Status Matrix ----
  const icMatrix = useMemo(() => {
    const stageCounts: Record<string, Record<string, number>> = {};
    const statusTotals: Record<string, number> = {};
    for (const p of filtered) {
      const stage = p.stage || "Unknown";
      const status = p.interconnectionStatus || "Unknown";
      if (!stageCounts[stage]) stageCounts[stage] = {};
      stageCounts[stage][status] = (stageCounts[stage][status] || 0) + 1;
      statusTotals[status] = (statusTotals[status] || 0) + 1;
    }
    const topStatuses = Object.entries(statusTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([s]) => s);
    const stages = Object.keys(stageCounts).sort();
    return { stageCounts, topStatuses, stages };
  }, [filtered]);

  // ---- CSV export data ----
  const exportData = useMemo(() => {
    return filtered.map((p) => ({
      Project: p.projectName || "",
      Location: p.pbLocation || "",
      Stage: p.stage || "",
      PM: p.projectManager || "",
      "Permitting Status": p.permittingStatus || "",
      "IC Status": p.interconnectionStatus || "",
      AHJ: p.ahj || "",
      Utility: p.utility || "",
      "Permit Turnaround (days)": p.permitTurnaroundTime ?? "",
      "IC Turnaround (days)": p.interconnectionTurnaroundTime ?? "",
    }));
  }, [filtered]);

  // ---- Render helpers ----

  function renderStatusBar(
    label: string,
    count: number,
    maxCount: number,
    colorClass: string
  ) {
    const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
    return (
      <div key={label} className="flex items-center gap-3 py-1.5">
        <span className="w-56 text-xs text-muted truncate" title={label}>
          {label}
        </span>
        <div className="flex-1 h-5 bg-surface-2 rounded overflow-hidden">
          <div
            className={`h-full ${colorClass} rounded transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-10 text-right text-xs font-semibold text-foreground">
          {count}
        </span>
      </div>
    );
  }

  function renderBreakdownSection(
    title: string,
    groups: StatusGroup[],
    counts: Record<string, number>,
    maxCount: number
  ) {
    return (
      <div className="bg-surface rounded-xl border border-t-border shadow-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
        {groups.map((group) => {
          const items = Object.entries(counts)
            .filter(([s]) => group.statuses.has(s))
            .sort(([, a], [, b]) => b - a);
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="mb-4 last:mb-0">
              <div className="text-xs font-medium text-muted mb-1.5 uppercase tracking-wide">
                {group.label}
              </div>
              {items.map(([status, count]) =>
                renderStatusBar(status, count, maxCount, group.color)
              )}
            </div>
          );
        })}
        {/* Ungrouped statuses */}
        {(() => {
          const allGrouped = new Set(groups.flatMap((g) => [...g.statuses]));
          const ungrouped = Object.entries(counts)
            .filter(([s]) => !allGrouped.has(s) && s !== "Unknown" && s !== "Not Needed")
            .sort(([, a], [, b]) => b - a);
          if (ungrouped.length === 0) return null;
          return (
            <div className="mt-4">
              <div className="text-xs font-medium text-muted mb-1.5 uppercase tracking-wide">
                Other
              </div>
              {ungrouped.map(([status, count]) =>
                renderStatusBar(status, count, maxCount, "bg-zinc-500")
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  // ---- Loading skeleton ----
  if (loading) {
    return (
      <DashboardShell title="Permitting & Interconnection" accentColor="teal">
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
                <div className="h-9 w-20 bg-skeleton rounded animate-pulse mb-2" />
                <div className="h-4 w-28 bg-skeleton rounded animate-pulse" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-surface rounded-xl border border-t-border p-5 shadow-card">
                <div className="h-5 w-40 bg-skeleton rounded animate-pulse mb-4" />
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="h-5 bg-skeleton rounded animate-pulse mb-2" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (error) {
    return (
      <DashboardShell title="Permitting & Interconnection" accentColor="teal">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 font-medium">{error}</p>
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-sm text-red-300 transition-colors"
          >
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Permitting & Interconnection"
      accentColor="teal"
      lastUpdated={lastUpdated}
      fullWidth
      exportData={{ data: exportData as Record<string, unknown>[], filename: "permitting-ic-analytics.csv" }}
    >
      <div className="space-y-6">
        {/* ---- Filters ---- */}
        <div className="flex flex-wrap gap-3">
          <MultiSelectFilter
            label="Location"
            options={filterOptions.locations}
            selected={filterLocations}
            onChange={setFilterLocations}
            accentColor="teal"
          />
          <MultiSelectFilter
            label="Project Manager"
            options={filterOptions.pms}
            selected={filterPMs}
            onChange={setFilterPMs}
            accentColor="teal"
          />
          <MultiSelectFilter
            label="Utility"
            options={filterOptions.utilities}
            selected={filterUtilities}
            onChange={setFilterUtilities}
            accentColor="teal"
          />
          {(filterLocations.length > 0 || filterPMs.length > 0 || filterUtilities.length > 0) && (
            <button
              onClick={() => {
                setFilterLocations([]);
                setFilterPMs([]);
                setFilterUtilities([]);
              }}
              className="text-xs text-muted hover:text-foreground transition-colors self-center"
            >
              Clear all
            </button>
          )}
        </div>

        {/* ---- Section 1: Summary Stats ---- */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 stagger-grid">
          <StatCard
            label="Permits Submitted"
            value={summary.permitsSubmitted}
            color="yellow"
            subtitle="At AHJ"
          />
          <StatCard
            label="Permits Issued"
            value={summary.permitsIssued}
            color="green"
            subtitle="Complete"
          />
          <StatCard
            label="IC Submitted"
            value={summary.icSubmitted}
            color="cyan"
            subtitle="At Utility"
          />
          <StatCard
            label="IC Approved"
            value={summary.icApproved}
            color="green"
            subtitle="Approved"
          />
          <MiniStat
            label="Avg Permit Turnaround"
            value={summary.avgPermitTT > 0 ? `${summary.avgPermitTT}d` : "--"}
            subtitle="days"
          />
          <MiniStat
            label="Avg IC Turnaround"
            value={summary.avgICTT > 0 ? `${summary.avgICTT}d` : "--"}
            subtitle="days"
          />
        </div>

        {/* ---- Section 2 & 3: Status Breakdowns ---- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {renderBreakdownSection(
            "Permitting Status Breakdown",
            PERMIT_GROUPS,
            permitBreakdown.counts,
            permitBreakdown.maxCount
          )}
          {renderBreakdownSection(
            "Interconnection Status Breakdown",
            IC_GROUPS,
            icBreakdown.counts,
            icBreakdown.maxCount
          )}
        </div>

        {/* ---- Section 4: Not Submitted by Location ---- */}
        <div className="bg-surface rounded-xl border border-t-border shadow-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            Not Submitted / Not Issued by Location
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {locationGaps.map((loc) => (
              <div
                key={loc.location}
                className="bg-surface-2 rounded-lg border border-t-border p-4"
              >
                <div className="text-sm font-medium text-foreground mb-2">
                  {loc.location}
                </div>
                <div className="text-xs text-muted mb-1">
                  {loc.total} active projects
                </div>
                <div className="flex gap-4 mt-2">
                  <div>
                    <div
                      key={String(loc.permitNotSubmitted)}
                      className={`text-lg font-bold animate-value-flash ${
                        loc.permitNotSubmitted > 5 ? "text-red-400" : loc.permitNotSubmitted > 0 ? "text-orange-400" : "text-green-400"
                      }`}
                    >
                      {loc.permitNotSubmitted}
                    </div>
                    <div className="text-[10px] text-muted">Permits not submitted</div>
                  </div>
                  <div>
                    <div
                      key={String(loc.icNotSubmitted)}
                      className={`text-lg font-bold animate-value-flash ${
                        loc.icNotSubmitted > 5 ? "text-red-400" : loc.icNotSubmitted > 0 ? "text-orange-400" : "text-green-400"
                      }`}
                    >
                      {loc.icNotSubmitted}
                    </div>
                    <div className="text-[10px] text-muted">IC not submitted</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---- Section 5: Avg Turnaround by Utility ---- */}
        <div className="bg-surface rounded-xl border border-t-border shadow-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            Avg Turnaround by Utility
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left">
                  <th className="py-2 pr-4 text-xs font-medium text-muted">Utility</th>
                  <th className="py-2 px-4 text-xs font-medium text-muted text-right">Avg Permit (d)</th>
                  <th className="py-2 px-4 text-xs font-medium text-muted text-right">Avg IC (d)</th>
                  <th className="py-2 pl-4 text-xs font-medium text-muted text-right">Projects</th>
                </tr>
              </thead>
              <tbody>
                {utilityTurnarounds.map((row) => (
                  <tr key={row.utility} className="border-b border-t-border/50 hover:bg-surface/50 transition-colors">
                    <td className="py-2 pr-4 text-foreground">{row.utility}</td>
                    <td className="py-2 px-4 text-right">
                      <span className={row.avgPermitTT > 30 ? "text-orange-400 font-medium" : "text-muted"}>
                        {row.avgPermitTT > 0 ? row.avgPermitTT : "--"}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right">
                      <span className={row.avgICTT > 30 ? "text-orange-400 font-medium" : "text-muted"}>
                        {row.avgICTT > 0 ? row.avgICTT : "--"}
                      </span>
                    </td>
                    <td className="py-2 pl-4 text-right text-muted">{row.count}</td>
                  </tr>
                ))}
                {utilityTurnarounds.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted text-sm">
                      No utility data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ---- Section 6: By AHJ (Top 15) ---- */}
        <div className="bg-surface rounded-xl border border-t-border shadow-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            Top 15 AHJs by Project Count
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left">
                  <th className="py-2 pr-4 text-xs font-medium text-muted">AHJ</th>
                  <th className="py-2 px-4 text-xs font-medium text-muted text-right">Total</th>
                  <th className="py-2 px-4 text-xs font-medium text-muted text-right">Submitted</th>
                  <th className="py-2 pl-4 text-xs font-medium text-muted text-right">Issued</th>
                </tr>
              </thead>
              <tbody>
                {ahjStats.map((row) => (
                  <tr key={row.ahj} className="border-b border-t-border/50 hover:bg-surface/50 transition-colors">
                    <td className="py-2 pr-4 text-foreground">{row.ahj}</td>
                    <td className="py-2 px-4 text-right text-muted">{row.total}</td>
                    <td className="py-2 px-4 text-right">
                      <span className="text-yellow-400">{row.submitted}</span>
                    </td>
                    <td className="py-2 pl-4 text-right">
                      <span className="text-green-400">{row.issued}</span>
                    </td>
                  </tr>
                ))}
                {ahjStats.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted text-sm">
                      No AHJ data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ---- Section 7: Stage x Permitting Status Matrix ---- */}
        <div className="bg-surface rounded-xl border border-t-border shadow-card p-5">
          <button
            onClick={() => setShowPermitMatrix(!showPermitMatrix)}
            className="flex items-center gap-2 text-sm font-semibold text-foreground w-full text-left"
          >
            <span className={`transition-transform ${showPermitMatrix ? "rotate-90" : ""}`}>
              &#9654;
            </span>
            Stage &times; Permitting Status Matrix
            <span className="text-xs text-muted font-normal ml-2">
              ({permitMatrix.stages.length} stages &times; {permitMatrix.topStatuses.length} statuses)
            </span>
          </button>
          {showPermitMatrix && (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-t-border">
                    <th className="py-1.5 pr-3 text-left text-muted font-medium sticky left-0 bg-surface z-10">
                      Stage
                    </th>
                    {permitMatrix.topStatuses.map((s) => (
                      <th
                        key={s}
                        className={`py-1.5 px-2 text-center font-medium whitespace-nowrap ${statusColor(s)}`}
                        title={s}
                      >
                        <span className="block max-w-[100px] truncate">{s}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {permitMatrix.stages.map((stage) => (
                    <tr key={stage} className="border-b border-t-border/30 hover:bg-surface/50">
                      <td className="py-1.5 pr-3 text-muted font-medium whitespace-nowrap sticky left-0 bg-surface z-10">
                        {stage}
                      </td>
                      {permitMatrix.topStatuses.map((status) => {
                        const count = permitMatrix.stageCounts[stage]?.[status] || 0;
                        return (
                          <td
                            key={status}
                            className={`py-1.5 px-2 text-center ${cellBg(count)}`}
                          >
                            {count > 0 ? (
                              <span className="text-foreground font-medium">{count}</span>
                            ) : (
                              <span className="text-muted/30">&mdash;</span>
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

        {/* ---- Section 8: Stage x IC Status Matrix ---- */}
        <div className="bg-surface rounded-xl border border-t-border shadow-card p-5">
          <button
            onClick={() => setShowICMatrix(!showICMatrix)}
            className="flex items-center gap-2 text-sm font-semibold text-foreground w-full text-left"
          >
            <span className={`transition-transform ${showICMatrix ? "rotate-90" : ""}`}>
              &#9654;
            </span>
            Stage &times; IC Status Matrix
            <span className="text-xs text-muted font-normal ml-2">
              ({icMatrix.stages.length} stages &times; {icMatrix.topStatuses.length} statuses)
            </span>
          </button>
          {showICMatrix && (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-t-border">
                    <th className="py-1.5 pr-3 text-left text-muted font-medium sticky left-0 bg-surface z-10">
                      Stage
                    </th>
                    {icMatrix.topStatuses.map((s) => (
                      <th
                        key={s}
                        className={`py-1.5 px-2 text-center font-medium whitespace-nowrap ${statusColor(s)}`}
                        title={s}
                      >
                        <span className="block max-w-[100px] truncate">{s}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {icMatrix.stages.map((stage) => (
                    <tr key={stage} className="border-b border-t-border/30 hover:bg-surface/50">
                      <td className="py-1.5 pr-3 text-muted font-medium whitespace-nowrap sticky left-0 bg-surface z-10">
                        {stage}
                      </td>
                      {icMatrix.topStatuses.map((status) => {
                        const count = icMatrix.stageCounts[stage]?.[status] || 0;
                        return (
                          <td
                            key={status}
                            className={`py-1.5 px-2 text-center ${cellBg(count)}`}
                          >
                            {count > 0 ? (
                              <span className="text-foreground font-medium">{count}</span>
                            ) : (
                              <span className="text-muted/30">&mdash;</span>
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
