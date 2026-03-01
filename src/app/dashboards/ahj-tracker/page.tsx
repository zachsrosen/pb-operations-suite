"use client";

import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---- Types ----

interface AHJRecord {
  id: string;
  properties: Record<string, string | null>;
}

// Permitting statuses indicating active permits
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

type SortField = "name" | "dealCount" | "activePermits" | "rejectionRate" | "turnaround" | "revenue";
type SortDir = "asc" | "desc";

export default function AHJTrackerPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  const { data: projects, loading: projectsLoading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  // Fetch AHJ custom object data
  const [ahjs, setAhjs] = useState<AHJRecord[]>([]);
  const [ahjLoading, setAhjLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchAHJs() {
      try {
        const res = await fetch("/api/ahj");
        if (!res.ok) throw new Error("Failed to fetch AHJs");
        const data = await res.json();
        if (!cancelled) setAhjs(data.ahjs || []);
      } catch (err) {
        console.error("AHJ fetch error:", err);
      } finally {
        if (!cancelled) setAhjLoading(false);
      }
    }
    fetchAHJs();
    return () => { cancelled = true; };
  }, []);

  const loading = projectsLoading || ahjLoading;

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("ahj-tracker", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  const [sortField, setSortField] = useState<SortField>("dealCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedAhj, setExpandedAhj] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [leadFilter, setLeadFilter] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const locations = useMemo(() => {
    const locs = new Set<string>();
    safeProjects.forEach((p) => { if (p.pbLocation) locs.add(p.pbLocation); });
    return Array.from(locs).sort();
  }, [safeProjects]);

  const leads = useMemo(() => {
    const names = new Set<string>();
    safeProjects.forEach((p) => {
      if (p.permitLead) names.add(p.permitLead);
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
    if (leadFilter !== "all") result = result.filter((p) => p.permitLead === leadFilter);
    if (stageFilter !== "all") result = result.filter((p) => p.stage === stageFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) =>
        (p.name?.toLowerCase().includes(q) || p.ahj?.toLowerCase().includes(q) || p.stage?.toLowerCase().includes(q) || p.pbLocation?.toLowerCase().includes(q) || p.permitLead?.toLowerCase().includes(q))
      );
    }
    return result;
  }, [safeProjects, locationFilter, leadFilter, stageFilter, searchQuery]);

  // Group projects by AHJ (case-insensitive) — filtered for both stats and table
  const projectsByAhj = useMemo(() => {
    const map: Record<string, { display: string; projects: RawProject[] }> = {};
    filteredProjects.forEach((p) => {
      const ahj = p.ahj?.trim();
      if (ahj) {
        const key = ahj.toLowerCase();
        if (!map[key]) map[key] = { display: ahj, projects: [] };
        map[key].projects.push(p);
      }
    });
    return map;
  }, [filteredProjects]);

  // AHJ custom object records by name
  const ahjByKey = useMemo(() => {
    const map: Record<string, { display: string; record: AHJRecord }> = {};
    ahjs.forEach((a) => {
      const name = a.properties.record_name?.trim();
      if (name) map[name.toLowerCase()] = { display: name, record: a };
    });
    return map;
  }, [ahjs]);

  // Build merged AHJ rows
  const ahjRows = useMemo(() => {
    const allKeys = new Set([
      ...Object.keys(projectsByAhj),
      ...Object.keys(ahjByKey),
    ]);

    return Array.from(allKeys).map((key) => {
      const dealEntry = projectsByAhj[key];
      const recordEntry = ahjByKey[key];
      const deals = dealEntry?.projects || [];
      const record = recordEntry?.record;
      const name = recordEntry?.display || dealEntry?.display || key;

      const activePermits = deals.filter(
        (p) => p.permittingStatus && [...PERMIT_ACTIVE_STATUSES, ...PERMIT_REVISION_STATUSES].includes(p.permittingStatus)
      ).length;
      const inRevision = deals.filter(
        (p) => p.permittingStatus && PERMIT_REVISION_STATUSES.includes(p.permittingStatus)
      ).length;
      const revenue = deals.reduce((s, p) => s + (p.amount || 0), 0);

      // Turnaround from custom object
      const turnaround = parseFloat(record?.properties.average_permit_turnaround_time__365_days_ || "0") || 0;
      const permitIssued = parseInt(record?.properties.permit_issued_count || "0", 10) || 0;
      const permitRejections = parseInt(record?.properties.permit_rejection_count || "0", 10) || 0;

      // Rejection rate from custom object data (permit rejections / total issued+rejections)
      const totalDecisions = permitIssued + permitRejections;
      const rejectionRate = totalDecisions > 0 ? permitRejections / totalDecisions : 0;

      return {
        key,
        name,
        record,
        deals,
        dealCount: deals.length,
        activePermits,
        inRevision,
        revenue,
        turnaround,
        permitIssued,
        permitRejections,
        rejectionRate,
        city: record?.properties.city || null,
        state: record?.properties.state || null,
      };
    });
  }, [projectsByAhj, ahjByKey]);

  // Only rows with deals
  const rowsWithDeals = useMemo(() => ahjRows.filter((r) => r.dealCount > 0), [ahjRows]);

  // Sort
  const sortedRows = useMemo(() => {
    const sorted = [...rowsWithDeals];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "dealCount": cmp = a.dealCount - b.dealCount; break;
        case "activePermits": cmp = a.activePermits - b.activePermits; break;
        case "rejectionRate": cmp = a.rejectionRate - b.rejectionRate; break;
        case "turnaround": cmp = a.turnaround - b.turnaround; break;
        case "revenue": cmp = a.revenue - b.revenue; break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rowsWithDeals, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortField(field); setSortDir("desc"); }
    },
    [sortField]
  );

  // Hero stats
  const stats = useMemo(() => {
    const ahjsWithDeals = rowsWithDeals.length;
    const totalActivePermits = rowsWithDeals.reduce((s, r) => s + r.activePermits, 0);
    const withTurnaround = rowsWithDeals.filter((r) => r.turnaround > 0);
    const avgTurnaround = withTurnaround.length > 0
      ? Math.round(withTurnaround.reduce((s, r) => s + r.turnaround, 0) / withTurnaround.length)
      : 0;
    const totalDecisions = rowsWithDeals.reduce((s, r) => s + r.permitIssued + r.permitRejections, 0);
    const totalRejections = rowsWithDeals.reduce((s, r) => s + r.permitRejections, 0);
    const overallRejRate = totalDecisions > 0 ? Math.round((totalRejections / totalDecisions) * 100) : 0;
    return { ahjsWithDeals, totalActivePermits, avgTurnaround, overallRejRate };
  }, [rowsWithDeals]);

  // Export
  const exportRows = useMemo(
    () => sortedRows.map((r) => ({
      name: r.name,
      city: r.city || "",
      state: r.state || "",
      dealCount: r.dealCount,
      activePermits: r.activePermits,
      inRevision: r.inRevision,
      rejectionRate: `${Math.round(r.rejectionRate * 100)}%`,
      turnaround: r.turnaround || "",
      permitIssued: r.permitIssued,
      permitRejections: r.permitRejections,
      revenue: r.revenue,
    })),
    [sortedRows]
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅";

  return (
    <DashboardShell
      title="AHJ Tracker"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "ahj-tracker.csv" }}
      fullWidth
    >
      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid">
        <StatCard
          label="AHJs with Deals"
          value={loading ? null : stats.ahjsWithDeals}
          color="cyan"
        />
        <StatCard
          label="Active Permits"
          value={loading ? null : stats.totalActivePermits}
          color="blue"
        />
        <StatCard
          label="Overall Rejection Rate"
          value={loading ? null : `${stats.overallRejRate}%`}
          color={stats.overallRejRate > 30 ? "red" : "emerald"}
        />
        <StatCard
          label="Avg Permit Turnaround"
          value={loading ? null : stats.avgTurnaround > 0 ? `${stats.avgTurnaround}d` : "—"}
          color="purple"
        />
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search AHJ name, project, or status..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted w-full max-w-xs"
        />
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

      {/* AHJ Table */}
      <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="p-8 text-center text-muted">No AHJ data with active deals.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    AHJ{sortIndicator("name")}
                  </th>
                  <th className="p-3">Location</th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("dealCount")}>
                    Deals{sortIndicator("dealCount")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("activePermits")}>
                    Active Permits{sortIndicator("activePermits")}
                  </th>
                  <th className="p-3 text-right">In Revision</th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("rejectionRate")}>
                    Rej. Rate{sortIndicator("rejectionRate")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("turnaround")}>
                    Avg Turnaround{sortIndicator("turnaround")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("revenue")}>
                    Revenue{sortIndicator("revenue")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <Fragment key={row.key}>
                    <tr
                      className="border-b border-t-border/50 hover:bg-surface-2/50 cursor-pointer"
                      onClick={() => setExpandedAhj(expandedAhj === row.key ? null : row.key)}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-muted text-xs">{expandedAhj === row.key ? "▼" : "▶"}</span>
                          <span className="text-foreground font-medium">{row.name}</span>
                        </div>
                      </td>
                      <td className="p-3 text-muted text-xs">
                        {[row.city, row.state].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="p-3 text-right text-foreground">{row.dealCount}</td>
                      <td className="p-3 text-right text-foreground">{row.activePermits}</td>
                      <td className="p-3 text-right">
                        <span className={row.inRevision > 0 ? "text-yellow-400 font-semibold" : "text-muted"}>
                          {row.inRevision}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <span className={`font-semibold ${row.rejectionRate > 0.3 ? "text-red-400" : row.rejectionRate > 0.15 ? "text-yellow-400" : "text-foreground"}`}>
                          {Math.round(row.rejectionRate * 100)}%
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <span className={`font-semibold ${row.turnaround > 45 ? "text-red-400" : row.turnaround > 30 ? "text-yellow-400" : "text-foreground"}`}>
                          {row.turnaround > 0 ? `${row.turnaround}d` : "—"}
                        </span>
                      </td>
                      <td className="p-3 text-right text-foreground">{formatMoney(row.revenue)}</td>
                    </tr>
                    {/* Drill-down */}
                    {expandedAhj === row.key && row.deals.length > 0 && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className="bg-surface-2/30 border-t border-t-border/30 p-4">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-muted text-xs">
                                  <th className="pb-2 pr-4">Project</th>
                                  <th className="pb-2 pr-4">Stage</th>
                                  <th className="pb-2 pr-4">Permit Status</th>
                                  <th className="pb-2 pr-4">Lead</th>
                                  <th className="pb-2 pr-4 text-right">Days in Stage</th>
                                  <th className="pb-2 text-right">Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.deals.map((p) => (
                                  <tr key={p.id} className="border-t border-t-border/20">
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
                                    <td className="py-2 pr-4 text-muted text-xs">{p.permittingStatus || "—"}</td>
                                    <td className="py-2 pr-4 text-muted">{p.permitLead || "—"}</td>
                                    <td className="py-2 pr-4 text-right">
                                      <span className={`font-semibold ${(p.daysSinceStageMovement ?? 0) > 21 ? "text-red-400" : (p.daysSinceStageMovement ?? 0) > 14 ? "text-yellow-400" : "text-foreground"}`}>
                                        {p.daysSinceStageMovement ?? 0}d
                                      </span>
                                    </td>
                                    <td className="py-2 text-right text-foreground">{formatMoney(p.amount || 0)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

