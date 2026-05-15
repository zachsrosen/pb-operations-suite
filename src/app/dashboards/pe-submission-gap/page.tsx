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
// Stage → milestone helpers
// ---------------------------------------------------------------------------

type PeMilestone = "pre-construction" | "construction" | "inspection" | "pto" | "close-out" | "complete";

function dealStageToPeMilestone(stageLabel: string): PeMilestone {
  const s = stageLabel.toLowerCase();
  if (s.includes("complete")) return "complete";
  if (s.includes("close out")) return "close-out";
  if (s.includes("permission to operate") || s.includes("pto")) return "pto";
  if (s.includes("inspection")) return "inspection";
  if (s.includes("construction")) return "construction";
  return "pre-construction";
}

const MILESTONE_ORDER: Record<PeMilestone, number> = {
  "pre-construction": 0,
  construction: 1,
  inspection: 2,
  pto: 3,
  "close-out": 4,
  complete: 5,
};

function milestoneLabel(m: PeMilestone): string {
  const map: Record<PeMilestone, string> = {
    "pre-construction": "Pre-Construction",
    construction: "Construction",
    inspection: "Inspection",
    pto: "PTO",
    "close-out": "Close Out",
    complete: "Complete",
  };
  return map[m];
}

// ---------------------------------------------------------------------------
// CC = Construction Complete threshold: inspection stage and beyond
// ---------------------------------------------------------------------------

function hasHitCC(stageLabel: string): boolean {
  const milestone = dealStageToPeMilestone(stageLabel);
  return MILESTONE_ORDER[milestone] >= MILESTONE_ORDER["inspection"];
}

// M1 requires: Inspection Complete + docs → PE reviews → approved → paid
// "Not fully submitted" = anything before Approved/Paid
const M1_COMPLETE_STATUSES = new Set(["Approved", "Paid"]);
const M2_COMPLETE_STATUSES = new Set(["Approved", "Paid"]);

// What stage blocks M2 specifically
function m2BlockReason(stageLabel: string): string | null {
  const m = dealStageToPeMilestone(stageLabel);
  if (m === "inspection") return "Waiting on Inspection";
  if (m === "pto") return "Waiting on PTO";
  return null;
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

function MilestoneBadge({ milestone }: { milestone: PeMilestone }) {
  const colors: Record<PeMilestone, string> = {
    "pre-construction": "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    construction: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    inspection: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    pto: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    "close-out": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    complete: "bg-green-500/20 text-green-400 border-green-500/30",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${colors[milestone]}`}>
      {milestoneLabel(milestone)}
    </span>
  );
}

function BlockReasonBadge({ reason }: { reason: string }) {
  const isInspection = reason.includes("Inspection");
  const color = isInspection
    ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
    : "bg-purple-500/20 text-purple-400 border-purple-500/30";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${color}`}>
      {reason}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

type SortColumn = "deal" | "location" | "stage" | "status" | "amount" | "blockReason";
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
  const [blockFilter, setBlockFilter] = useState<string[]>([]);
  const [sortCol, setSortCol] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const allDeals = data?.deals ?? [];

  // Deals that have hit CC (inspection or beyond)
  const ccDeals = useMemo(() => allDeals.filter((d) => hasHitCC(d.dealStageLabel)), [allDeals]);

  // M1 gap: hit CC, M1 not approved/paid
  const m1GapDeals = useMemo(
    () => ccDeals.filter((d) => !M1_COMPLETE_STATUSES.has(d.peM1Status ?? "")),
    [ccDeals],
  );

  // M2 gap: hit CC, M2 not approved/paid
  // M2 is only possible at PTO+ stage, but show all CC+ deals missing M2 so Matt can see the full picture
  const m2GapDeals = useMemo(
    () => ccDeals.filter((d) => !M2_COMPLETE_STATUSES.has(d.peM2Status ?? "")),
    [ccDeals],
  );

  const activeDeals = activeTab === "m1" ? m1GapDeals : m2GapDeals;

  // Filter options derived from active set
  const filterOptions = useMemo(() => {
    const locations = [...new Set(activeDeals.map((d) => d.pbLocation).filter(Boolean))].sort();
    const statuses: string[] = [];
    const statusSet = new Set<string>();
    for (const d of activeDeals) {
      const s = activeTab === "m1" ? d.peM1Status : d.peM2Status;
      const val = s || "Not Started";
      if (!statusSet.has(val)) { statusSet.add(val); statuses.push(val); }
    }
    const blockReasons: string[] = [];
    if (activeTab === "m2") {
      const brSet = new Set<string>();
      for (const d of activeDeals) {
        const br = m2BlockReason(d.dealStageLabel);
        if (br && !brSet.has(br)) { brSet.add(br); blockReasons.push(br); }
      }
    }
    return { locations, statuses, blockReasons };
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
      if (blockFilter.length > 0 && activeTab === "m2") {
        const br = m2BlockReason(d.dealStageLabel);
        if (!br || !blockFilter.includes(br)) return false;
      }
      return true;
    });
  }, [activeDeals, search, locFilter, statusFilter, blockFilter, activeTab]);

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
        case "stage": {
          const mA = MILESTONE_ORDER[dealStageToPeMilestone(a.dealStageLabel)];
          const mB = MILESTONE_ORDER[dealStageToPeMilestone(b.dealStageLabel)];
          return dir * (mA - mB);
        }
        case "status": {
          const sA = (activeTab === "m1" ? a.peM1Status : a.peM2Status) || "";
          const sB = (activeTab === "m1" ? b.peM1Status : b.peM2Status) || "";
          return dir * sA.localeCompare(sB);
        }
        case "amount": return dir * ((a.pePaymentTotal ?? 0) - (b.pePaymentTotal ?? 0));
        case "blockReason": {
          const brA = m2BlockReason(a.dealStageLabel) || "";
          const brB = m2BlockReason(b.dealStageLabel) || "";
          return dir * brA.localeCompare(brB);
        }
        default: return 0;
      }
    });
  }, [filtered, sortCol, sortDir, activeTab]);

  // Metrics
  const metrics = useMemo(() => {
    if (!ccDeals.length) return null;

    const m1Gap = m1GapDeals.length;
    const m2Gap = m2GapDeals.length;
    const m1Complete = ccDeals.filter((d) => M1_COMPLETE_STATUSES.has(d.peM1Status ?? "")).length;
    const m2Complete = ccDeals.filter((d) => M2_COMPLETE_STATUSES.has(d.peM2Status ?? "")).length;

    // M1 gap value — IC payment on deals where M1 is incomplete
    const m1GapValue = m1GapDeals.reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
    // M2 gap value — PC payment on deals where M2 is incomplete
    const m2GapValue = m2GapDeals.reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);

    // Blocking reason breakdown for M2
    const m2WaitingInspection = m2GapDeals.filter((d) => dealStageToPeMilestone(d.dealStageLabel) === "inspection").length;
    const m2WaitingPTO = m2GapDeals.filter((d) => dealStageToPeMilestone(d.dealStageLabel) === "pto").length;
    const m2PastPTO = m2GapDeals.filter((d) => {
      const m = dealStageToPeMilestone(d.dealStageLabel);
      return m === "close-out" || m === "complete";
    }).length;

    // M1 status breakdown
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

    return {
      totalCC: ccDeals.length,
      m1Gap, m2Gap, m1Complete, m2Complete,
      m1GapValue, m2GapValue,
      m2WaitingInspection, m2WaitingPTO, m2PastPTO,
      m1ByStatus: [...m1ByStatus.entries()].sort((a, b) => b[1] - a[1]),
      m2ByStatus: [...m2ByStatus.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [ccDeals, m1GapDeals, m2GapDeals]);

  // Filtered totals
  const filteredValue = useMemo(() => {
    if (activeTab === "m1") return filtered.reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
    return filtered.reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
  }, [filtered, activeTab]);

  const hasFilters = search || locFilter.length > 0 || statusFilter.length > 0 || blockFilter.length > 0;

  return (
    <DashboardShell title="PE Submission Gap" accentColor="orange" lastUpdated={data?.lastUpdated} fullWidth>
      <p className="text-muted text-sm mb-6">
        Projects that have hit Construction Complete but are not fully submitted to Participate Energy.
        Broken down by M1 (Inspection Complete) and M2 (Project Complete) milestones.
      </p>

      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger-grid">
        <StatCard
          label="Hit CC Total"
          value={metrics?.totalCC ?? null}
          subtitle="Past construction stage"
          color="blue"
        />
        <StatCard
          label="M1 Not Complete"
          value={metrics?.m1Gap ?? null}
          subtitle={metrics ? `${fmt(metrics.m1GapValue)} in IC payments` : undefined}
          color="orange"
        />
        <StatCard
          label="M2 Not Complete"
          value={metrics?.m2Gap ?? null}
          subtitle={metrics ? `${fmt(metrics.m2GapValue)} in PC payments` : undefined}
          color="red"
        />
        <StatCard
          label="Fully Submitted"
          value={metrics ? `${metrics.m1Complete} / ${metrics.m2Complete}` : null}
          subtitle="M1 / M2 approved or paid"
          color="green"
        />
      </div>

      {/* Status breakdown cards */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* M1 breakdown */}
          <div className="bg-surface rounded-xl border border-border p-5 shadow-card">
            <h3 className="text-sm font-semibold text-foreground mb-3">M1 Gap — Status Breakdown</h3>
            <div className="space-y-2">
              {metrics.m1ByStatus.map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={status === "Not Started" ? null : status} />
                  </div>
                  <span className="text-sm font-medium text-foreground tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* M2 breakdown by blocker */}
          <div className="bg-surface rounded-xl border border-border p-5 shadow-card">
            <h3 className="text-sm font-semibold text-foreground mb-3">M2 Gap — Blocked By</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">Waiting on Inspection</span>
                <span className="text-sm font-medium text-amber-400 tabular-nums">{metrics.m2WaitingInspection}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">Waiting on PTO</span>
                <span className="text-sm font-medium text-purple-400 tabular-nums">{metrics.m2WaitingPTO}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">Past PTO — Submission Pending</span>
                <span className="text-sm font-medium text-orange-400 tabular-nums">{metrics.m2PastPTO}</span>
              </div>
              <div className="border-t border-border pt-2 mt-2">
                <div className="space-y-2">
                  {metrics.m2ByStatus.map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between">
                      <StatusBadge status={status === "Not Started" ? null : status} />
                      <span className="text-xs font-medium text-muted tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
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
            onClick={() => { setActiveTab("m1"); setStatusFilter([]); setBlockFilter([]); }}
          >
            M1 — Inspection Complete
            <span className="ml-2 text-xs opacity-70">({m1GapDeals.length})</span>
          </button>
          <button
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "m2"
                ? "text-orange-400 border-b-2 border-orange-400 bg-orange-500/5"
                : "text-muted hover:text-foreground"
            }`}
            onClick={() => { setActiveTab("m2"); setStatusFilter([]); setBlockFilter([]); }}
          >
            M2 — Project Complete
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
            {activeTab === "m2" && filterOptions.blockReasons.length > 0 && (
              <MultiSelectFilter
                label="Blocked By"
                options={filterOptions.blockReasons.map((r) => ({ value: r, label: r }))}
                selected={blockFilter}
                onChange={setBlockFilter}
                accentColor="orange"
              />
            )}
            {hasFilters && (
              <button
                onClick={() => { setSearch(""); setLocFilter([]); setStatusFilter([]); setBlockFilter([]); }}
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
              {activeTab === "m1" ? "IC" : "PC"} Payment at Stake:{" "}
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
                  <SortHeader label="Deal Stage" column="stage" current={sortCol} direction={sortDir} onSort={handleSort} />
                  <SortHeader label={`${activeTab.toUpperCase()} Status`} column="status" current={sortCol} direction={sortDir} onSort={handleSort} />
                  {activeTab === "m2" && (
                    <SortHeader label="Blocked By" column="blockReason" current={sortCol} direction={sortDir} onSort={handleSort} />
                  )}
                  <SortHeader label={activeTab === "m1" ? "IC Payment" : "PC Payment"} column="amount" current={sortCol} direction={sortDir} onSort={handleSort} align="right" />
                  <th className="pb-2 text-right">Links</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => {
                  const milestone = dealStageToPeMilestone(d.dealStageLabel);
                  const status = activeTab === "m1" ? d.peM1Status : d.peM2Status;
                  const paymentAmount = activeTab === "m1" ? d.pePaymentIC : d.pePaymentPC;
                  const blockReason = activeTab === "m2" ? m2BlockReason(d.dealStageLabel) : null;

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
                      <td className="py-2.5 pr-3"><MilestoneBadge milestone={milestone} /></td>
                      <td className="py-2.5 pr-3"><StatusBadge status={status} /></td>
                      {activeTab === "m2" && (
                        <td className="py-2.5 pr-3">
                          {blockReason ? <BlockReasonBadge reason={blockReason} /> : <span className="text-xs text-muted">Ready</span>}
                        </td>
                      )}
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
              {hasFilters ? "No projects match your filters." : "All CC projects have been fully submitted!"}
            </div>
          )}
        </div>
      </div>

      {isLoading && <div className="text-center py-12 text-muted">Loading PE deal data...</div>}
    </DashboardShell>
  );
}
