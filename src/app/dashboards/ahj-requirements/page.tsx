"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---- Types ----

interface AHJRecord {
  id: string;
  properties: Record<string, string | null>;
}

interface ExtendedProject extends RawProject {
  designStatus?: string;
  designLead?: string;
  projectManager?: string;
  permitLead?: string;
}

// Revision / rejection statuses for computing rejection rate
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

type SortField = "name" | "dealCount" | "revenue" | "rejectionRate" | "permitTurnaround";
type SortDir = "asc" | "desc";

export default function AHJRequirementsPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  // Fetch project data
  const { data: projects, loading: projectsLoading, lastUpdated } = useProjectData<ExtendedProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: ExtendedProject[] }).projects,
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
      trackDashboardView("ahj-requirements", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // Sort state
  const [sortField, setSortField] = useState<SortField>("dealCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedAhj, setExpandedAhj] = useState<string | null>(null);

  // Group projects by AHJ name (case-insensitive key, preserve display name)
  const projectsByAhj = useMemo(() => {
    const map: Record<string, { display: string; projects: ExtendedProject[] }> = {};
    safeProjects.forEach((p) => {
      const ahj = p.ahj?.trim();
      if (ahj) {
        const key = ahj.toLowerCase();
        if (!map[key]) map[key] = { display: ahj, projects: [] };
        map[key].projects.push(p);
      }
    });
    return map;
  }, [safeProjects]);

  // Build AHJ name → custom object record map (case-insensitive key)
  const ahjByKey = useMemo(() => {
    const map: Record<string, { display: string; record: AHJRecord }> = {};
    ahjs.forEach((a) => {
      const name = a.properties.record_name?.trim();
      if (name) map[name.toLowerCase()] = { display: name, record: a };
    });
    return map;
  }, [ahjs]);

  // Merged AHJ rows: combine deal-level stats with custom object properties
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
      const inRevision = deals.filter(
        (p) => p.designStatus && REVISION_STATUSES.includes(p.designStatus)
      ).length;
      const revenue = deals.reduce((s, p) => s + (p.amount || 0), 0);

      return {
        name,
        record,
        dealCount: deals.length,
        revenue,
        inRevision,
        rejectionRate: deals.length > 0 ? inRevision / deals.length : 0,
        // From custom object
        permitTurnaround: parseFloat(record?.properties.average_permit_turnaround_time__365_days_ || "0") || 0,
        permitIssued: parseInt(record?.properties.permit_issued_count || "0", 10) || 0,
        permitRejections: parseInt(record?.properties.permit_rejection_count || "0", 10) || 0,
        city: record?.properties.city || null,
        county: record?.properties.county || null,
        state: record?.properties.state || null,
        snowLoad: record?.properties.design_snow_load || null,
        windSpeed: record?.properties.design_wind_speed || null,
        fireOffsets: record?.properties.fire_offsets_required || null,
        stampingReq: record?.properties.stamping_requirements || null,
        submissionMethod: record?.properties.submission_method || null,
        portalLink: record?.properties.portal_link || null,
      };
    });
  }, [projectsByAhj, ahjByKey]);

  // Sort
  const sortedRows = useMemo(() => {
    const sorted = [...ahjRows];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "dealCount": cmp = a.dealCount - b.dealCount; break;
        case "revenue": cmp = a.revenue - b.revenue; break;
        case "rejectionRate": cmp = a.rejectionRate - b.rejectionRate; break;
        case "permitTurnaround": cmp = a.permitTurnaround - b.permitTurnaround; break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [ahjRows, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortField(field); setSortDir("desc"); }
    },
    [sortField]
  );

  // Summary stats
  const stats = useMemo(() => {
    const withDeals = ahjRows.filter((r) => r.dealCount > 0);
    const totalAhjs = ahjs.length;
    const ahjsWithDeals = withDeals.length;
    const avgTurnaround = withDeals.length > 0
      ? Math.round(withDeals.reduce((s, r) => s + r.permitTurnaround, 0) / withDeals.length)
      : 0;
    const totalRevisions = ahjRows.reduce((s, r) => s + r.inRevision, 0);
    return { totalAhjs, ahjsWithDeals, avgTurnaround, totalRevisions };
  }, [ahjRows, ahjs.length]);

  // Export
  const exportRows = useMemo(
    () => sortedRows.map((r) => ({
      name: r.name,
      city: r.city || "",
      county: r.county || "",
      state: r.state || "",
      dealCount: r.dealCount,
      inRevision: r.inRevision,
      rejectionRate: `${Math.round(r.rejectionRate * 100)}%`,
      permitTurnaround: r.permitTurnaround || "",
      permitIssued: r.permitIssued,
      permitRejections: r.permitRejections,
      snowLoad: r.snowLoad || "",
      windSpeed: r.windSpeed || "",
      fireOffsets: r.fireOffsets || "",
      stampingReq: r.stampingReq || "",
      submissionMethod: r.submissionMethod || "",
      revenue: r.revenue,
    })),
    [sortedRows]
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅";

  return (
    <DashboardShell
      title="AHJ Design Requirements"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "ahj-requirements.csv" }}
      fullWidth
    >
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid">
        <MiniStat label="Total AHJs" value={loading ? null : stats.totalAhjs} />
        <MiniStat label="AHJs with Active Deals" value={loading ? null : stats.ahjsWithDeals} />
        <MiniStat
          label="Avg Permit Turnaround"
          value={loading ? null : stats.avgTurnaround > 0 ? `${stats.avgTurnaround}d` : "—"}
        />
        <MiniStat
          label="Projects in Revision"
          value={loading ? null : stats.totalRevisions}
          alert={stats.totalRevisions > 10}
        />
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
          <div className="p-8 text-center text-muted">No AHJ data available.</div>
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
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("rejectionRate")}>
                    Revision Rate{sortIndicator("rejectionRate")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("permitTurnaround")}>
                    Permit Turnaround{sortIndicator("permitTurnaround")}
                  </th>
                  <th className="p-3">Design Codes</th>
                  <th className="p-3">Submission</th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("revenue")}>
                    Revenue{sortIndicator("revenue")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr
                    key={r.name}
                    className="border-b border-t-border/50 hover:bg-surface-2/50 cursor-pointer"
                    onClick={() => setExpandedAhj(expandedAhj === r.name ? null : r.name)}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {r.portalLink ? (
                          <a
                            href={r.portalLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-400 hover:text-purple-300 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.name}
                          </a>
                        ) : (
                          <span className="text-foreground font-medium">{r.name}</span>
                        )}
                        {!r.record && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                            No record
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-muted">
                      {[r.city, r.county, r.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="p-3 text-right font-semibold text-foreground">
                      {r.dealCount}
                      {r.inRevision > 0 && (
                        <span className="ml-1 text-xs text-orange-400">({r.inRevision} rev)</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <span className={`font-semibold ${r.rejectionRate > 0.3 ? "text-red-400" : r.rejectionRate > 0.15 ? "text-yellow-400" : "text-foreground"}`}>
                        {Math.round(r.rejectionRate * 100)}%
                      </span>
                    </td>
                    <td className="p-3 text-right text-foreground">
                      {r.permitTurnaround > 0 ? `${r.permitTurnaround}d` : "—"}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {r.snowLoad && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                            Snow: {r.snowLoad}
                          </span>
                        )}
                        {r.windSpeed && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                            Wind: {r.windSpeed}
                          </span>
                        )}
                        {r.fireOffsets && r.fireOffsets.toLowerCase() !== "false" && r.fireOffsets.toLowerCase() !== "no" && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                            Fire offsets
                          </span>
                        )}
                        {r.stampingReq && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
                            {r.stampingReq}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-muted text-xs">{r.submissionMethod || "—"}</td>
                    <td className="p-3 text-right text-foreground">{formatMoney(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Expanded AHJ detail panel */}
      {expandedAhj && (() => {
        const row = sortedRows.find((r) => r.name === expandedAhj);
        if (!row?.record) return null;
        const p = row.record.properties;
        return (
          <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">{row.name} — Details</h2>
              <button
                onClick={() => setExpandedAhj(null)}
                className="text-sm text-muted hover:text-foreground"
              >
                Close ✕
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Contact */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Contact Info</h3>
                <div className="space-y-1 text-sm text-muted">
                  {p.primary_contact_name && <div>Contact: <span className="text-foreground">{p.primary_contact_name}</span></div>}
                  {p.email && <div>Email: <span className="text-foreground">{p.email}</span></div>}
                  {p.phone_number && <div>Phone: <span className="text-foreground">{p.phone_number}</span></div>}
                  {p.address && <div>Address: <span className="text-foreground">{p.address}</span></div>}
                </div>
              </div>
              {/* Permitting */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Permitting</h3>
                <div className="space-y-1 text-sm text-muted">
                  {p.permits_required && <div>Permits Required: <span className="text-foreground">{p.permits_required}</span></div>}
                  {p.submission_method && <div>Submission: <span className="text-foreground">{p.submission_method}</span></div>}
                  {p.permit_turnaround_time && <div>Turnaround: <span className="text-foreground">{p.permit_turnaround_time}</span></div>}
                  {p.customer_signature_required_on_permit && <div>Customer Sig: <span className="text-foreground">{p.customer_signature_required_on_permit}</span></div>}
                  {p.permit_issues && <div>Known Issues: <span className="text-foreground">{p.permit_issues}</span></div>}
                </div>
              </div>
              {/* Design Codes */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Design Codes</h3>
                <div className="space-y-1 text-sm text-muted">
                  {p.design_snow_load && <div>Snow Load: <span className="text-foreground">{p.design_snow_load}</span></div>}
                  {p.design_wind_speed && <div>Wind Speed: <span className="text-foreground">{p.design_wind_speed}</span></div>}
                  {p.ibc_code && <div>IBC: <span className="text-foreground">{p.ibc_code}</span></div>}
                  {p.nec_code && <div>NEC: <span className="text-foreground">{p.nec_code}</span></div>}
                  {p.irc_code && <div>IRC: <span className="text-foreground">{p.irc_code}</span></div>}
                  {p.ifc_code && <div>IFC: <span className="text-foreground">{p.ifc_code}</span></div>}
                  {p.fire_offsets_required && <div>Fire Offsets: <span className="text-foreground">{p.fire_offsets_required}</span></div>}
                  {p.fire_inspection_required && <div>Fire Inspection: <span className="text-foreground">{p.fire_inspection_required}</span></div>}
                  {p.is_rsd_required_ && <div>RSD Required: <span className="text-foreground">{p.is_rsd_required_}</span></div>}
                  {p.snow_guards_required && <div>Snow Guards: <span className="text-foreground">{p.snow_guards_required}</span></div>}
                </div>
              </div>
            </div>
            {/* Code notes */}
            {(p.building_code_notes || p.electrical_code_notes || p.fire_code_notes || p.general_notes) && (
              <div className="mt-4 pt-4 border-t border-t-border">
                <h3 className="text-sm font-semibold text-foreground mb-2">Notes</h3>
                <div className="space-y-2 text-sm text-muted">
                  {p.building_code_notes && <div><span className="font-medium text-foreground">Building:</span> {p.building_code_notes}</div>}
                  {p.electrical_code_notes && <div><span className="font-medium text-foreground">Electrical:</span> {p.electrical_code_notes}</div>}
                  {p.fire_code_notes && <div><span className="font-medium text-foreground">Fire:</span> {p.fire_code_notes}</div>}
                  {p.general_notes && <div><span className="font-medium text-foreground">General:</span> {p.general_notes}</div>}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Note */}
      <div className="bg-surface/50 border border-t-border rounded-lg p-4">
        <p className="text-xs text-muted">
          <span className="font-medium text-foreground">Note:</span> AHJ data comes from HubSpot custom objects.
          Revision rate is calculated from projects currently in revision statuses associated with each AHJ.
          Permit turnaround reflects the 365-day average stored on the AHJ record.
        </p>
      </div>
    </DashboardShell>
  );
}
