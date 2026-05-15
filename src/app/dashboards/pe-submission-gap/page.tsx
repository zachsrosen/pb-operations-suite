"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Types — reuses the PeDeal shape from /api/accounting/pe-deals
// ---------------------------------------------------------------------------

interface PeDeal {
  dealId: string;
  dealName: string;
  pbLocation: string;
  dealStage: string;
  dealStageLabel: string;
  closeDate: string | null;
  systemType: "solar" | "battery" | "solar+battery";
  epcPrice: number | null;
  customerPays: number | null;
  pePaymentTotal: number | null;
  pePaymentIC: number | null;
  pePaymentPC: number | null;
  totalPBRevenue: number | null;
  peM1Status: string | null;
  peM2Status: string | null;
  milestoneHighlight: "m1" | "m2" | "complete" | null;
  daInvoiceStatus: string | null;
  ccInvoiceStatus: string | null;
  ptoInvoiceStatus: string | null;
  paidInFull: boolean;
  hubspotUrl: string;
  pePortalUrl: string | null;
  peProjectId: string | null;
}

// ---------------------------------------------------------------------------
// Stage helpers
// ---------------------------------------------------------------------------

type DealMilestone = "pre-construction" | "construction" | "inspection" | "pto" | "close-out" | "complete";

function dealStageToMilestone(stageLabel: string): DealMilestone {
  const s = stageLabel.toLowerCase();
  if (s.includes("complete")) return "complete";
  if (s.includes("close out")) return "close-out";
  if (s.includes("permission to operate") || s.includes("pto")) return "pto";
  if (s.includes("inspection")) return "inspection";
  if (s.includes("construction")) return "construction";
  return "pre-construction";
}

const MILESTONE_ORDER: Record<DealMilestone, number> = {
  "pre-construction": 0,
  construction: 1,
  inspection: 2,
  pto: 3,
  "close-out": 4,
  complete: 5,
};

/** CC = Construction Complete = inspection stage or beyond */
function hasHitCC(stageLabel: string): boolean {
  return MILESTONE_ORDER[dealStageToMilestone(stageLabel)] >= MILESTONE_ORDER["inspection"];
}

/**
 * PE milestone mapping (per Matt / accounting):
 *   Inspection stage  → Onboarding
 *   PTO stage         → M1 (PE pays ~2/3 after PTO)
 *   Close Out stage   → M2 (PE pays ~1/3 at close-out)
 */
function pePhaseLabel(stageLabel: string): string {
  const m = dealStageToMilestone(stageLabel);
  switch (m) {
    case "inspection": return "Onboarding";
    case "pto": return "M1";
    case "close-out": return "M2";
    case "complete": return "Complete";
    default: return stageLabel;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type Tab = "m1" | "m2";

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted">Not Started</span>;
  const colors: Record<string, string> = {
    Paid: "bg-green-500/20 text-green-400 border-green-500/30",
    Approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Submitted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    Resubmitted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    "Ready to Submit": "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    Rejected: "bg-red-500/20 text-red-400 border-red-500/30",
    "Ready to Resubmit": "bg-orange-500/20 text-orange-400 border-orange-500/30",
    "Waiting on Information": "bg-purple-500/20 text-purple-400 border-purple-500/30",
    "Ready for Onboarding": "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    "Onboarding Submitted": "bg-sky-500/20 text-sky-400 border-sky-500/30",
    "Onboarding Rejected": "bg-red-500/20 text-red-400 border-red-500/30",
    "Onboarding Ready to Resubmit": "bg-orange-500/20 text-orange-400 border-orange-500/30",
    "Onboarding Resubmitted": "bg-sky-500/20 text-sky-400 border-sky-500/30",
  };
  const cls = colors[status] || "bg-surface-2 text-muted border-border";
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{status}</span>;
}

function PePhaseBadge({ stageLabel }: { stageLabel: string }) {
  const phase = pePhaseLabel(stageLabel);
  const colors: Record<string, string> = {
    Onboarding: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    M1: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    M2: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Complete: "bg-green-500/20 text-green-400 border-green-500/30",
  };
  const cls = colors[phase] || "bg-surface-2 text-muted border-border";
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{phase}</span>;
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

type SortColumn = "deal" | "location" | "phase" | "status" | "amount";
type SortDirection = "asc" | "desc";

function SortHeader({ label, column, current, direction, onSort, align }: {
  label: string;
  column: SortColumn;
  current: SortColumn | null;
  direction: SortDirection;
  onSort: (col: SortColumn) => void;
  align?: "right";
}) {
  const active = current === column;
  return (
    <th
      className={`pb-2 pr-3 cursor-pointer select-none hover:text-foreground transition-colors ${align === "right" ? "text-right" : ""}`}
      onClick={() => onSort(column)}
    >
      <span className="inline-flex items-center gap-1">
        {align === "right" && active && (
          <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
            {direction === "asc" ? <path d="M6 2l4 5H2z" /> : <path d="M6 10l4-5H2z" />}
          </svg>
        )}
        {label}
        {align !== "right" && active && (
          <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
            {direction === "asc" ? <path d="M6 2l4 5H2z" /> : <path d="M6 10l4-5H2z" />}
          </svg>
        )}
      </span>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PeSubmissionGapPage() {
  const { data, isLoading } = useQuery<{ deals: PeDeal[]; lastUpdated: string }>({
    queryKey: queryKeys.peDeals.list(),
    queryFn: () => fetch("/api/accounting/pe-deals").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const [activeTab, setActiveTab] = useState<Tab>("m1");
  const [search, setSearch] = useState("");
  const [locFilter, setLocFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<string[]>([]);
  const [sortCol, setSortCol] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const allDeals = data?.deals ?? [];

  // Deals that have hit CC (inspection or beyond)
  const ccDeals = useMemo(() => allDeals.filter((d) => hasHitCC(d.dealStageLabel)), [allDeals]);

  // M1 gap: hit CC, M1 not Paid
  const m1GapDeals = useMemo(
    () => ccDeals.filter((d) => d.peM1Status !== "Paid"),
    [ccDeals],
  );

  // M2 gap: hit CC, M2 not Paid
  const m2GapDeals = useMemo(
    () => ccDeals.filter((d) => d.peM2Status !== "Paid"),
    [ccDeals],
  );

  const activeDeals = activeTab === "m1" ? m1GapDeals : m2GapDeals;

  // Filter options
  const filterOptions = useMemo(() => {
    const locations = [...new Set(activeDeals.map((d) => d.pbLocation).filter(Boolean))].sort();
    const statuses: string[] = [];
    const statusSet = new Set<string>();
    for (const d of activeDeals) {
      const s = (activeTab === "m1" ? d.peM1Status : d.peM2Status) || "Not Started";
      if (!statusSet.has(s)) { statusSet.add(s); statuses.push(s); }
    }
    const phases = [...new Set(activeDeals.map((d) => pePhaseLabel(d.dealStageLabel)))].sort();
    return { locations, statuses, phases };
  }, [activeDeals, activeTab]);

  // Apply filters
  const filtered = useMemo(() => {
    return activeDeals.filter((d) => {
      if (search) {
        const q = search.toLowerCase();
        if (!d.dealName.toLowerCase().includes(q) && !d.pbLocation.toLowerCase().includes(q)) return false;
      }
      if (locFilter.length > 0 && !locFilter.includes(d.pbLocation)) return false;
      if (statusFilter.length > 0) {
        const s = (activeTab === "m1" ? d.peM1Status : d.peM2Status) || "Not Started";
        if (!statusFilter.includes(s)) return false;
      }
      if (phaseFilter.length > 0) {
        if (!phaseFilter.includes(pePhaseLabel(d.dealStageLabel))) return false;
      }
      return true;
    });
  }, [activeDeals, search, locFilter, statusFilter, phaseFilter, activeTab]);

  // Sort
  const handleSort = (col: SortColumn) => {
    setSortCol((prev) => {
      if (prev === col) { setSortDir((d) => (d === "asc" ? "desc" : "asc")); return col; }
      setSortDir("asc");
      return col;
    });
  };

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortCol) {
        case "deal": return dir * a.dealName.localeCompare(b.dealName);
        case "location": return dir * (a.pbLocation || "").localeCompare(b.pbLocation || "");
        case "phase": {
          const mA = MILESTONE_ORDER[dealStageToMilestone(a.dealStageLabel)];
          const mB = MILESTONE_ORDER[dealStageToMilestone(b.dealStageLabel)];
          return dir * (mA - mB);
        }
        case "status": {
          const sA = (activeTab === "m1" ? a.peM1Status : a.peM2Status) || "";
          const sB = (activeTab === "m1" ? b.peM1Status : b.peM2Status) || "";
          return dir * sA.localeCompare(sB);
        }
        case "amount": {
          const aAmt = activeTab === "m1" ? (a.pePaymentIC ?? 0) : (a.pePaymentPC ?? 0);
          const bAmt = activeTab === "m1" ? (b.pePaymentIC ?? 0) : (b.pePaymentPC ?? 0);
          return dir * (aAmt - bAmt);
        }
        default: return 0;
      }
    });
  }, [filtered, sortCol, sortDir, activeTab]);

  // Metrics
  const metrics = useMemo(() => {
    if (!ccDeals.length) return null;

    const m1Paid = ccDeals.filter((d) => d.peM1Status === "Paid").length;
    const m2Paid = ccDeals.filter((d) => d.peM2Status === "Paid").length;
    const m1GapValue = m1GapDeals.reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
    const m2GapValue = m2GapDeals.reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);

    // Status breakdown
    const m1ByStatus = new Map<string, number>();
    for (const d of m1GapDeals) {
      const s = d.peM1Status || "Not Started";
      m1ByStatus.set(s, (m1ByStatus.get(s) ?? 0) + 1);
    }
    const m2ByStatus = new Map<string, number>();
    for (const d of m2GapDeals) {
      const s = d.peM2Status || "Not Started";
      m2ByStatus.set(s, (m2ByStatus.get(s) ?? 0) + 1);
    }

    // PE phase breakdown
    const m1ByPhase = new Map<string, number>();
    for (const d of m1GapDeals) {
      const p = pePhaseLabel(d.dealStageLabel);
      m1ByPhase.set(p, (m1ByPhase.get(p) ?? 0) + 1);
    }
    const m2ByPhase = new Map<string, number>();
    for (const d of m2GapDeals) {
      const p = pePhaseLabel(d.dealStageLabel);
      m2ByPhase.set(p, (m2ByPhase.get(p) ?? 0) + 1);
    }

    return {
      totalCC: ccDeals.length,
      m1Gap: m1GapDeals.length, m2Gap: m2GapDeals.length,
      m1Paid, m2Paid,
      m1GapValue, m2GapValue,
      m1ByStatus: [...m1ByStatus.entries()].sort((a, b) => b[1] - a[1]),
      m2ByStatus: [...m2ByStatus.entries()].sort((a, b) => b[1] - a[1]),
      m1ByPhase: [...m1ByPhase.entries()].sort((a, b) => b[1] - a[1]),
      m2ByPhase: [...m2ByPhase.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [ccDeals, m1GapDeals, m2GapDeals]);

  // Filtered totals
  const filteredValue = useMemo(() => {
    if (activeTab === "m1") return filtered.reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
    return filtered.reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
  }, [filtered, activeTab]);

  const hasFilters = search || locFilter.length > 0 || statusFilter.length > 0 || phaseFilter.length > 0;

  return (
    <DashboardShell title="PE Submission Gap" accentColor="orange" lastUpdated={data?.lastUpdated} fullWidth>
      <p className="text-muted text-sm mb-6">
        PE deals past Construction Complete where M1 or M2 haven&apos;t been paid yet.
      </p>

      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger-grid">
        <StatCard
          label="Hit CC Total"
          value={metrics?.totalCC ?? null}
          subtitle="Inspection stage or beyond"
          color="blue"
        />
        <StatCard
          label="M1 Not Paid"
          value={metrics?.m1Gap ?? null}
          subtitle={metrics ? `${fmt(metrics.m1GapValue)} outstanding` : undefined}
          color="orange"
        />
        <StatCard
          label="M2 Not Paid"
          value={metrics?.m2Gap ?? null}
          subtitle={metrics ? `${fmt(metrics.m2GapValue)} outstanding` : undefined}
          color="red"
        />
        <StatCard
          label="Paid"
          value={metrics ? `${metrics.m1Paid} / ${metrics.m2Paid}` : null}
          subtitle="M1 / M2"
          color="green"
        />
      </div>

      {/* Breakdown cards */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Status breakdown for active tab */}
          <div className="bg-surface rounded-xl border border-border p-5 shadow-card">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              {activeTab === "m1" ? "M1" : "M2"} — Status Breakdown
            </h3>
            <div className="space-y-2">
              {(activeTab === "m1" ? metrics.m1ByStatus : metrics.m2ByStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <StatusBadge status={status === "Not Started" ? null : status} />
                  <span className="text-sm font-medium text-foreground tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* PE Phase breakdown for active tab */}
          <div className="bg-surface rounded-xl border border-border p-5 shadow-card">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              {activeTab === "m1" ? "M1" : "M2"} — By PE Phase
            </h3>
            <div className="space-y-2">
              {(activeTab === "m1" ? metrics.m1ByPhase : metrics.m2ByPhase).map(([phase, count]) => (
                <div key={phase} className="flex items-center justify-between">
                  <span className="text-sm text-muted">{phase}</span>
                  <span className="text-sm font-medium text-foreground tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
        <div className="flex border-b border-border">
          <button
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "m1"
                ? "text-orange-400 border-b-2 border-orange-400 bg-orange-500/5"
                : "text-muted hover:text-foreground"
            }`}
            onClick={() => { setActiveTab("m1"); setStatusFilter([]); setPhaseFilter([]); }}
          >
            M1 Not Paid
            <span className="ml-2 text-xs opacity-70">({m1GapDeals.length})</span>
          </button>
          <button
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "m2"
                ? "text-orange-400 border-b-2 border-orange-400 bg-orange-500/5"
                : "text-muted hover:text-foreground"
            }`}
            onClick={() => { setActiveTab("m2"); setStatusFilter([]); setPhaseFilter([]); }}
          >
            M2 Not Paid
            <span className="ml-2 text-xs opacity-70">({m2GapDeals.length})</span>
          </button>
        </div>

        <div className="p-5">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <input
              type="text"
              placeholder="Search by name or location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-xs bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-foreground placeholder:text-muted w-56 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
            />
            <MultiSelectFilter
              label="Location"
              options={filterOptions.locations.map((l) => ({ value: l, label: l }))}
              selected={locFilter}
              onChange={setLocFilter}
              accentColor="orange"
            />
            <MultiSelectFilter
              label={`${activeTab.toUpperCase()} Status`}
              options={filterOptions.statuses.map((s) => ({ value: s, label: s }))}
              selected={statusFilter}
              onChange={setStatusFilter}
              accentColor="orange"
            />
            <MultiSelectFilter
              label="PE Phase"
              options={filterOptions.phases.map((p) => ({ value: p, label: p }))}
              selected={phaseFilter}
              onChange={setPhaseFilter}
              accentColor="orange"
            />
            {hasFilters && (
              <button
                onClick={() => { setSearch(""); setLocFilter([]); setStatusFilter([]); setPhaseFilter([]); }}
                className="text-xs text-muted hover:text-foreground transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Summary */}
          <div className="flex items-center gap-6 text-xs text-muted mb-3 px-1 py-2 border-b border-border/50">
            <span className="font-medium text-foreground">{filtered.length} projects</span>
            <span>
              Outstanding:{" "}
              <span className="text-orange-400 font-medium tabular-nums">{fmt(filteredValue)}</span>
            </span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <SortHeader label="Deal" column="deal" current={sortCol} direction={sortDir} onSort={handleSort} />
                  <SortHeader label="Location" column="location" current={sortCol} direction={sortDir} onSort={handleSort} />
                  <SortHeader label="PE Phase" column="phase" current={sortCol} direction={sortDir} onSort={handleSort} />
                  <SortHeader label={`${activeTab.toUpperCase()} Status`} column="status" current={sortCol} direction={sortDir} onSort={handleSort} />
                  <SortHeader label={activeTab === "m1" ? "IC Payment" : "PC Payment"} column="amount" current={sortCol} direction={sortDir} onSort={handleSort} align="right" />
                  <th className="pb-2 text-right">Links</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => {
                  const status = activeTab === "m1" ? d.peM1Status : d.peM2Status;
                  const paymentAmount = activeTab === "m1" ? d.pePaymentIC : d.pePaymentPC;

                  return (
                    <tr key={d.dealId} className="border-b border-border/30 hover:bg-surface-2/50 transition-colors">
                      <td className="py-2.5 pr-3">
                        <a
                          href={d.hubspotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground hover:text-orange-400 transition-colors"
                        >
                          {d.dealName}
                        </a>
                      </td>
                      <td className="py-2.5 pr-3 text-muted text-xs">{d.pbLocation}</td>
                      <td className="py-2.5 pr-3"><PePhaseBadge stageLabel={d.dealStageLabel} /></td>
                      <td className="py-2.5 pr-3"><StatusBadge status={status} /></td>
                      <td className="py-2.5 pr-3 text-right text-foreground font-medium tabular-nums">{fmt(paymentAmount)}</td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {d.pePortalUrl && (
                            <a
                              href={d.pePortalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-500/60 hover:text-emerald-400 transition-colors"
                              title={`PE Portal${d.peProjectId ? ` — ${d.peProjectId}` : ""}`}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                              </svg>
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && !isLoading && (
            <div className="text-center py-8 text-muted text-sm">
              {hasFilters ? "No projects match your filters." : "All PE deals are paid! 🎉"}
            </div>
          )}
        </div>
      </div>

      {isLoading && <div className="text-center py-12 text-muted">Loading PE deal data...</div>}
    </DashboardShell>
  );
}
