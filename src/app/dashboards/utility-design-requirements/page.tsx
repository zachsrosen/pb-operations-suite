"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";
import { formatMoney } from "@/lib/format";
import { RawProject } from "@/lib/types";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---- Types ----

interface UtilityRecord {
  id: string;
  properties: Record<string, string | null>;
}

type SortField = "name" | "dealCount" | "revenue" | "interconnectionTurnaround" | "rejectionCount";
type SortDir = "asc" | "desc";

export default function UtilityDesignRequirementsPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  // Fetch project data
  const { data: projects, loading: projectsLoading, lastUpdated } = useProjectData<RawProject[]>({
    params: { context: "executive" },
    transform: (raw: unknown) => (raw as { projects: RawProject[] }).projects,
  });
  const safeProjects = projects ?? [];

  // Fetch Utility custom object data
  const [utilities, setUtilities] = useState<UtilityRecord[]>([]);
  const [utilLoading, setUtilLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchUtilities() {
      try {
        const res = await fetch("/api/utility");
        if (!res.ok) throw new Error("Failed to fetch Utilities");
        const data = await res.json();
        if (!cancelled) setUtilities(data.utilities || []);
      } catch (err) {
        console.error("Utility fetch error:", err);
      } finally {
        if (!cancelled) setUtilLoading(false);
      }
    }
    fetchUtilities();
    return () => { cancelled = true; };
  }, []);

  const loading = projectsLoading || utilLoading;

  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("utility-design-requirements", { projectCount: safeProjects.length });
    }
  }, [loading, safeProjects.length, trackDashboardView]);

  // Sort state
  const [sortField, setSortField] = useState<SortField>("dealCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedUtility, setExpandedUtility] = useState<string | null>(null);

  // Group projects by utility name (case-insensitive key, preserve display name)
  const projectsByUtility = useMemo(() => {
    const map: Record<string, { display: string; projects: RawProject[] }> = {};
    safeProjects.forEach((p) => {
      const util = p.utility?.trim();
      if (util) {
        const key = util.toLowerCase();
        if (!map[key]) map[key] = { display: util, projects: [] };
        map[key].projects.push(p);
      }
    });
    return map;
  }, [safeProjects]);

  // Build Utility name → custom object record map (case-insensitive key)
  // Key by record_name (canonical); fall back to utility_company_name only when record_name is absent
  const utilityByKey = useMemo(() => {
    const map: Record<string, { display: string; record: UtilityRecord }> = {};
    utilities.forEach((u) => {
      const name = (u.properties.record_name ?? u.properties.utility_company_name)?.trim();
      if (name) map[name.toLowerCase()] = { display: name, record: u };
    });
    return map;
  }, [utilities]);

  // Merged utility rows
  const utilityRows = useMemo(() => {
    const allKeys = new Set([
      ...Object.keys(projectsByUtility),
      ...Object.keys(utilityByKey),
    ]);

    return Array.from(allKeys).map((key) => {
      const dealEntry = projectsByUtility[key];
      const recordEntry = utilityByKey[key];
      const deals = dealEntry?.projects || [];
      const record = recordEntry?.record;
      const name = recordEntry?.display || dealEntry?.display || key;
      const revenue = deals.reduce((s, p) => s + (p.amount || 0), 0);

      return {
        name,
        record,
        dealCount: deals.length,
        revenue,
        // From custom object
        interconnectionTurnaround: parseFloat(record?.properties.average_interconnection_turnaround_time || "0") || 0,
        rejectionCount: parseInt(record?.properties.rejection_count || "0", 10) || 0,
        approvalCount: parseInt(record?.properties.utility_approval_count || "0", 10) || 0,
        ptoFpr: record?.properties.pto_first_time_pass_rate || null,
        acDisconnect: record?.properties.ac_disconnect_required_ || null,
        backupSwitchAllowed: record?.properties.backup_switch_allowed_ || null,
        productionMeter: record?.properties.is_production_meter_required_ || null,
        systemSizeRule: record?.properties.system_size_rule || null,
        submissionType: record?.properties.submission_type || null,
        energyRate: record?.properties.energy_rate || null,
        state: record?.properties.state || null,
        city: record?.properties.city || null,
        serviceArea: record?.properties.service_area || null,
        portalLink: record?.properties.portal_link || null,
      };
    });
  }, [projectsByUtility, utilityByKey]);

  // Sort
  const sortedRows = useMemo(() => {
    const sorted = [...utilityRows];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "dealCount": cmp = a.dealCount - b.dealCount; break;
        case "revenue": cmp = a.revenue - b.revenue; break;
        case "interconnectionTurnaround": cmp = a.interconnectionTurnaround - b.interconnectionTurnaround; break;
        case "rejectionCount": cmp = a.rejectionCount - b.rejectionCount; break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [utilityRows, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortField(field); setSortDir("desc"); }
    },
    [sortField]
  );

  // Summary stats
  const stats = useMemo(() => {
    const withDeals = utilityRows.filter((r) => r.dealCount > 0);
    const totalUtilities = utilities.length;
    const utilitiesWithDeals = withDeals.length;
    const avgTurnaround = withDeals.length > 0
      ? Math.round(withDeals.reduce((s, r) => s + r.interconnectionTurnaround, 0) / withDeals.length)
      : 0;
    const totalRejections = utilityRows.reduce((s, r) => s + r.rejectionCount, 0);
    return { totalUtilities, utilitiesWithDeals, avgTurnaround, totalRejections };
  }, [utilityRows, utilities.length]);

  // Export
  const exportRows = useMemo(
    () => sortedRows.map((r) => ({
      name: r.name,
      city: r.city || "",
      state: r.state || "",
      serviceArea: r.serviceArea || "",
      dealCount: r.dealCount,
      interconnectionTurnaround: r.interconnectionTurnaround || "",
      rejectionCount: r.rejectionCount,
      approvalCount: r.approvalCount,
      ptoFpr: r.ptoFpr || "",
      acDisconnect: r.acDisconnect || "",
      backupSwitchAllowed: r.backupSwitchAllowed || "",
      productionMeter: r.productionMeter || "",
      systemSizeRule: r.systemSizeRule || "",
      submissionType: r.submissionType || "",
      energyRate: r.energyRate || "",
      revenue: r.revenue,
    })),
    [sortedRows]
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : " ⇅";

  return (
    <DashboardShell
      title="Utility Design Requirements"
      accentColor="purple"
      lastUpdated={lastUpdated}
      exportData={{ data: exportRows, filename: "utility-design-requirements.csv" }}
      fullWidth
    >
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-grid">
        <MiniStat label="Total Utilities" value={loading ? null : stats.totalUtilities} />
        <MiniStat label="Utilities with Active Deals" value={loading ? null : stats.utilitiesWithDeals} />
        <MiniStat
          label="Avg IC Turnaround"
          value={loading ? null : stats.avgTurnaround > 0 ? `${stats.avgTurnaround}d` : "—"}
        />
        <MiniStat
          label="Total Rejections (365d)"
          value={loading ? null : stats.totalRejections}
          alert={stats.totalRejections > 20}
        />
      </div>

      {/* Utility Table */}
      <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-skeleton rounded animate-pulse" />
            ))}
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="p-8 text-center text-muted">No utility data available.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-left text-muted bg-surface-2/50">
                  <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Utility{sortIndicator("name")}
                  </th>
                  <th className="p-3">Service Area</th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("dealCount")}>
                    Deals{sortIndicator("dealCount")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("interconnectionTurnaround")}>
                    IC Turnaround{sortIndicator("interconnectionTurnaround")}
                  </th>
                  <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("rejectionCount")}>
                    Rejections{sortIndicator("rejectionCount")}
                  </th>
                  <th className="p-3">Design Requirements</th>
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
                    onClick={() => setExpandedUtility(expandedUtility === r.name ? null : r.name)}
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
                    <td className="p-3 text-muted text-xs">
                      {r.serviceArea || [r.city, r.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="p-3 text-right font-semibold text-foreground">{r.dealCount}</td>
                    <td className="p-3 text-right text-foreground">
                      {r.interconnectionTurnaround > 0 ? `${r.interconnectionTurnaround}d` : "—"}
                    </td>
                    <td className="p-3 text-right">
                      <span className={`font-semibold ${r.rejectionCount > 5 ? "text-red-400" : r.rejectionCount > 2 ? "text-yellow-400" : "text-foreground"}`}>
                        {r.rejectionCount}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {r.acDisconnect && r.acDisconnect.toLowerCase() !== "false" && r.acDisconnect.toLowerCase() !== "no" && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                            AC Disconnect
                          </span>
                        )}
                        {r.productionMeter && r.productionMeter.toLowerCase() !== "false" && r.productionMeter.toLowerCase() !== "no" && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                            Prod Meter
                          </span>
                        )}
                        {r.backupSwitchAllowed && r.backupSwitchAllowed.toLowerCase() !== "false" && r.backupSwitchAllowed.toLowerCase() !== "no" && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            Backup OK
                          </span>
                        )}
                        {r.systemSizeRule && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
                            {r.systemSizeRule}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-muted text-xs">{r.submissionType || "—"}</td>
                    <td className="p-3 text-right text-foreground">{formatMoney(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Expanded Utility detail panel */}
      {expandedUtility && (() => {
        const row = sortedRows.find((r) => r.name === expandedUtility);
        if (!row?.record) return null;
        const p = row.record.properties;
        return (
          <div className="bg-surface border border-t-border rounded-xl p-6 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">{row.name} — Details</h2>
              <button
                onClick={() => setExpandedUtility(null)}
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
                  {p.service_area && <div>Service Area: <span className="text-foreground">{p.service_area}</span></div>}
                </div>
              </div>
              {/* Interconnection */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Interconnection</h3>
                <div className="space-y-1 text-sm text-muted">
                  {p.interconnection_required && <div>IC Required: <span className="text-foreground">{p.interconnection_required}</span></div>}
                  {p.average_interconnection_turnaround_time && <div>Avg Turnaround: <span className="text-foreground">{p.average_interconnection_turnaround_time}d</span></div>}
                  {p.communicated_review_time && <div>Communicated Time: <span className="text-foreground">{p.communicated_review_time}</span></div>}
                  {p.submission_type && <div>Submission: <span className="text-foreground">{p.submission_type}</span></div>}
                  {p.util_app_requires_customer_signature && <div>Customer Sig: <span className="text-foreground">{p.util_app_requires_customer_signature}</span></div>}
                </div>
              </div>
              {/* Design Requirements */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Design Requirements</h3>
                <div className="space-y-1 text-sm text-muted">
                  {p.ac_disconnect_required_ && <div>AC Disconnect: <span className="text-foreground">{p.ac_disconnect_required_}</span></div>}
                  {p.backup_switch_allowed_ && <div>Backup Switch: <span className="text-foreground">{p.backup_switch_allowed_}</span></div>}
                  {p.is_production_meter_required_ && <div>Prod Meter: <span className="text-foreground">{p.is_production_meter_required_}</span></div>}
                  {p.system_size_rule && <div>Size Rule: <span className="text-foreground">{p.system_size_rule}</span></div>}
                  {p.insurance_required && <div>Insurance: <span className="text-foreground">{p.insurance_required}</span></div>}
                  {p.inspection_required && <div>Inspection: <span className="text-foreground">{p.inspection_required}</span></div>}
                </div>
              </div>
            </div>
            {/* Rates & PTO */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 pt-4 border-t border-t-border">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Rates & Economics</h3>
                <div className="space-y-1 text-sm text-muted">
                  {p.energy_rate && <div>Energy Rate: <span className="text-foreground">{p.energy_rate}</span></div>}
                  {p.battery_arbitrage_summer && <div>Battery Arb (Summer): <span className="text-foreground">{p.battery_arbitrage_summer}</span></div>}
                  {p.battery_arbitrage_winter && <div>Battery Arb (Winter): <span className="text-foreground">{p.battery_arbitrage_winter}</span></div>}
                  {p.vpp_annual_sales && <div>VPP Annual: <span className="text-foreground">{p.vpp_annual_sales}</span></div>}
                  {p.vpp_per_battery && <div>VPP Per Battery: <span className="text-foreground">{p.vpp_per_battery}</span></div>}
                  {p.fees && <div>Fees: <span className="text-foreground">{p.fees}</span></div>}
                  {p.rebate_information && <div>Rebates: <span className="text-foreground">{p.rebate_information}</span></div>}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">PTO & Performance</h3>
                <div className="space-y-1 text-sm text-muted">
                  {p.pto_first_time_pass_rate && <div>PTO FPR: <span className="text-foreground">{p.pto_first_time_pass_rate}</span></div>}
                  {p.pto_fpr__365_ && <div>PTO FPR (365d): <span className="text-foreground">{p.pto_fpr__365_}</span></div>}
                  {p.pto_passed__365_ && <div>PTO Passed (365d): <span className="text-foreground">{p.pto_passed__365_}</span></div>}
                  {p.pto_notes && <div>PTO Notes: <span className="text-foreground">{p.pto_notes}</span></div>}
                </div>
              </div>
            </div>
            {/* Notes */}
            {(p.design_notes || p.ia_notes || p.general_notes) && (
              <div className="mt-4 pt-4 border-t border-t-border">
                <h3 className="text-sm font-semibold text-foreground mb-2">Notes</h3>
                <div className="space-y-2 text-sm text-muted">
                  {p.design_notes && <div><span className="font-medium text-foreground">Design:</span> {p.design_notes}</div>}
                  {p.ia_notes && <div><span className="font-medium text-foreground">IA:</span> {p.ia_notes}</div>}
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
          <span className="font-medium text-foreground">Note:</span> Utility data comes from HubSpot custom objects.
          Interconnection turnaround and rejection counts reflect values stored on the utility record.
          Deal counts are matched by the utility name field on each project.
        </p>
      </div>
    </DashboardShell>
  );
}
