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
  inspectionPassDate: string | null;
  ptoGrantedDate: string | null;
  daInvoiceStatus: string | null;
  ccInvoiceStatus: string | null;
  ptoInvoiceStatus: string | null;
  paidInFull: boolean;
  hubspotUrl: string;
  pePortalUrl: string | null;
  peProjectId: string | null;
}

// ---------------------------------------------------------------------------
// Stage -> milestone helpers
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

const M1_PAID = new Set(["Paid"]);
const M2_PAID = new Set(["Paid"]);

/** Both M1 and M2 fully paid — belongs on Complete tab only */
function isBothPaid(d: PeDeal): boolean {
  return d.peM1Status === "Paid" && d.peM2Status === "Paid";
}

// ---------------------------------------------------------------------------
// Tab types + per-tab helpers
// ---------------------------------------------------------------------------

type Tab = "preconstruction" | "construction" | "m1" | "m2" | "complete";

function getStatus(d: PeDeal, tab: Tab): string | null {
  if (tab === "m2") return d.peM2Status;
  if (tab === "complete") return d.peM2Status; // show M2 status on complete tab
  return d.peM1Status;
}

function getPayment(d: PeDeal, tab: Tab): number | null {
  if (tab === "m1") return d.pePaymentIC;
  if (tab === "m2") return d.pePaymentPC;
  return d.pePaymentTotal;
}

function getDate(d: PeDeal, tab: Tab): string | null {
  if (tab === "m1") return d.inspectionPassDate;
  if (tab === "m2") return d.ptoGrantedDate;
  return d.closeDate;
}

function tabDateLabel(tab: Tab): string {
  if (tab === "m1") return "Inspection Passed";
  if (tab === "m2") return "PTO Granted";
  return "Close Date";
}

function tabPaymentLabel(tab: Tab): string {
  if (tab === "m1") return "IC Payment";
  if (tab === "m2") return "PC Payment";
  return "PE Payment";
}

function tabStatusLabel(tab: Tab): string {
  if (tab === "m2") return "M2 Status";
  if (tab === "complete") return "M2 Status";
  return "M1 Status";
}

// ---------------------------------------------------------------------------
// Stage sort order (project pipeline)
// ---------------------------------------------------------------------------

const STAGE_LABEL_ORDER: Record<string, number> = {
  "Site Survey": 0,
  "Design & Engineering": 1,
  "Permitting & Interconnection": 2,
  "RTB - Blocked": 3,
  "Ready To Build": 4,
  "Construction": 5,
  "Inspection": 6,
  "Permission To Operate": 7,
  "Close Out": 8,
  "Project Complete": 9,
};

function stageOrder(label: string): number {
  return STAGE_LABEL_ORDER[label] ?? 99;
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

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

type SortColumn = "deal" | "location" | "stage" | "status" | "amount" | "date";
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
  const [sortCol, setSortCol] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const allDeals = data?.deals ?? [];

  // ---- Deal lists per tab (strict, non-overlapping stage buckets) ----

  const preConstructionDeals = useMemo(
    () => allDeals.filter((d) => dealStageToMilestone(d.dealStageLabel) === "pre-construction"),
    [allDeals],
  );

  const constructionDeals = useMemo(
    () => allDeals.filter((d) => {
      const m = dealStageToMilestone(d.dealStageLabel);
      return m === "construction" || m === "inspection";
    }),
    [allDeals],
  );

  // M1 = PTO + Close Out stages, M1 not yet paid, excluding fully-done deals
  const m1GapDeals = useMemo(
    () => allDeals.filter((d) => {
      const m = dealStageToMilestone(d.dealStageLabel);
      return (m === "pto" || m === "close-out") &&
        !M1_PAID.has(d.peM1Status ?? "") &&
        !isBothPaid(d);
    }),
    [allDeals],
  );

  // M2 = Close Out stage, M2 not yet paid, excluding fully-done deals
  const m2GapDeals = useMemo(
    () => allDeals.filter((d) =>
      dealStageToMilestone(d.dealStageLabel) === "close-out" &&
      !M2_PAID.has(d.peM2Status ?? "") &&
      !isBothPaid(d),
    ),
    [allDeals],
  );

  // Complete = both M1 and M2 approved or paid (any post-construction stage)
  const completeDeals = useMemo(
    () => allDeals.filter((d) => isBothPaid(d)),
    [allDeals],
  );

  // ---- Tab totals for headers ----

  const tabTotals = useMemo(() => ({
    preconstruction: preConstructionDeals.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0),
    construction: constructionDeals.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0),
    m1: m1GapDeals.reduce((s, d) => s + (d.pePaymentIC ?? 0), 0),
    m2: m2GapDeals.reduce((s, d) => s + (d.pePaymentPC ?? 0), 0),
    complete: completeDeals.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0),
  }), [preConstructionDeals, constructionDeals, m1GapDeals, m2GapDeals, completeDeals]);

  const tabCounts: Record<Tab, number> = {
    preconstruction: preConstructionDeals.length,
    construction: constructionDeals.length,
    m1: m1GapDeals.length,
    m2: m2GapDeals.length,
    complete: completeDeals.length,
  };

  // ---- Active deals based on selected tab ----

  const activeDeals = useMemo(() => {
    switch (activeTab) {
      case "preconstruction": return preConstructionDeals;
      case "construction": return constructionDeals;
      case "m1": return m1GapDeals;
      case "m2": return m2GapDeals;
      case "complete": return completeDeals;
    }
  }, [activeTab, preConstructionDeals, constructionDeals, m1GapDeals, m2GapDeals, completeDeals]);

  // ---- Filter options derived from active set ----

  const filterOptions = useMemo(() => {
    const locations = [...new Set(activeDeals.map((d) => d.pbLocation).filter(Boolean))].sort();
    const statuses: string[] = [];
    const statusSet = new Set<string>();
    for (const d of activeDeals) {
      const s = getStatus(d, activeTab) || "Not Started";
      if (!statusSet.has(s)) { statusSet.add(s); statuses.push(s); }
    }
    return { locations, statuses };
  }, [activeDeals, activeTab]);

  // ---- Apply filters ----

  const filtered = useMemo(() => {
    return activeDeals.filter((d) => {
      if (search) {
        const q = search.toLowerCase();
        if (!d.dealName.toLowerCase().includes(q) && !d.pbLocation.toLowerCase().includes(q)) return false;
      }
      if (locFilter.length > 0 && !locFilter.includes(d.pbLocation)) return false;
      if (statusFilter.length > 0) {
        const s = getStatus(d, activeTab) || "Not Started";
        if (!statusFilter.includes(s)) return false;
      }
      return true;
    });
  }, [activeDeals, search, locFilter, statusFilter, activeTab]);

  // ---- Sort ----

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
        case "stage": return dir * (stageOrder(a.dealStageLabel) - stageOrder(b.dealStageLabel));
        case "status": {
          const sA = getStatus(a, activeTab) || "";
          const sB = getStatus(b, activeTab) || "";
          return dir * sA.localeCompare(sB);
        }
        case "amount": return dir * ((getPayment(a, activeTab) ?? 0) - (getPayment(b, activeTab) ?? 0));
        case "date": {
          const dA = getDate(a, activeTab) ?? "";
          const dB = getDate(b, activeTab) ?? "";
          return dir * dA.localeCompare(dB);
        }
        default: return 0;
      }
    });
  }, [filtered, sortCol, sortDir, activeTab]);

  // ---- Metrics (hero stats + breakdowns) ----

  const metrics = useMemo(() => {
    if (!allDeals.length) return null;

    const m1Gap = m1GapDeals.length;
    const m2Gap = m2GapDeals.length;
    const done = completeDeals.length;
    const m1GapValue = m1GapDeals.reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
    const m2GapValue = m2GapDeals.reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
    const doneValue = completeDeals.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);

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
      totalPE: allDeals.length,
      m1Gap, m2Gap, done,
      m1GapValue, m2GapValue, doneValue,
      m1ByStatus: [...m1ByStatus.entries()].sort((a, b) => b[1] - a[1]),
      m2ByStatus: [...m2ByStatus.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [allDeals, m1GapDeals, m2GapDeals, completeDeals]);

  // ---- Filtered totals ----

  const filteredValue = useMemo(() => {
    return filtered.reduce((s, d) => s + (getPayment(d, activeTab) ?? 0), 0);
  }, [filtered, activeTab]);

  const hasFilters = search || locFilter.length > 0 || statusFilter.length > 0;

  // ---- Tab config ----

  const tabs: { key: Tab; label: string; sublabel: string }[] = [
    { key: "preconstruction", label: "Pre-Construction", sublabel: `${tabCounts.preconstruction} · ${fmt(tabTotals.preconstruction)}` },
    { key: "construction", label: "Construction", sublabel: `${tabCounts.construction} · ${fmt(tabTotals.construction)}` },
    { key: "m1", label: "M1 Not Paid", sublabel: `${tabCounts.m1} · ${fmt(tabTotals.m1)}` },
    { key: "m2", label: "M2 Not Paid", sublabel: `${tabCounts.m2} · ${fmt(tabTotals.m2)}` },
    { key: "complete", label: "Fully Paid", sublabel: `${tabCounts.complete} · ${fmt(tabTotals.complete)}` },
  ];

  return (
    <DashboardShell title="PE Submission Gap" accentColor="orange" lastUpdated={data?.lastUpdated} fullWidth>
      <p className="text-muted text-sm mb-6">
        Participate Energy deal pipeline — pre-construction through close out.
        M1 tab shows PTO-stage deals not yet approved/paid. M2 tab shows Close Out-stage deals not yet approved/paid.
      </p>

      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger-grid">
        <StatCard
          label="Total PE Deals"
          value={metrics?.totalPE ?? null}
          subtitle="Active in project pipeline"
          color="blue"
        />
        <StatCard
          label="M1 Gap"
          value={metrics?.m1Gap ?? null}
          subtitle={metrics ? `${fmt(metrics.m1GapValue)} IC pending` : undefined}
          color="orange"
        />
        <StatCard
          label="M2 Gap"
          value={metrics?.m2Gap ?? null}
          subtitle={metrics ? `${fmt(metrics.m2GapValue)} PC pending` : undefined}
          color="red"
        />
        <StatCard
          label="Complete"
          value={metrics?.done ?? null}
          subtitle={metrics ? `${fmt(metrics.doneValue)} fully paid` : undefined}
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

          {/* M2 breakdown */}
          <div className="bg-surface rounded-xl border border-border p-5 shadow-card">
            <h3 className="text-sm font-semibold text-foreground mb-3">M2 Gap — Status Breakdown</h3>
            <div className="space-y-2">
              {metrics.m2ByStatus.map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={status === "Not Started" ? null : status} />
                  </div>
                  <span className="text-sm font-medium text-foreground tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab switcher + table */}
      <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
        <div className="flex border-b border-border overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`flex-1 min-w-[140px] px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? "text-orange-400 border-b-2 border-orange-400 bg-orange-500/5"
                  : "text-muted hover:text-foreground"
              }`}
              onClick={() => { setActiveTab(t.key); setStatusFilter([]); }}
            >
              {t.label}
              <span className="ml-2 text-xs opacity-70">({t.sublabel})</span>
            </button>
          ))}
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
              label={tabStatusLabel(activeTab)}
              options={filterOptions.statuses.map((s) => ({ value: s, label: s }))}
              selected={statusFilter}
              onChange={setStatusFilter}
              accentColor="orange"
            />
            {hasFilters && (
              <button
                onClick={() => { setSearch(""); setLocFilter([]); setStatusFilter([]); }}
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
              {tabPaymentLabel(activeTab)} at Stake:{" "}
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
                  {activeTab === "complete" ? (
                    <>
                      <th className="pb-2 pr-3">M1 Status</th>
                      <th className="pb-2 pr-3">M2 Status</th>
                    </>
                  ) : (
                    <SortHeader label={tabStatusLabel(activeTab)} column="status" current={sortCol} direction={sortDir} onSort={handleSort} />
                  )}
                  <SortHeader label={tabDateLabel(activeTab)} column="date" current={sortCol} direction={sortDir} onSort={handleSort} />
                  <SortHeader label={tabPaymentLabel(activeTab)} column="amount" current={sortCol} direction={sortDir} onSort={handleSort} align="right" />
                  <th className="pb-2 text-right">Links</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => {
                  const status = getStatus(d, activeTab);
                  const paymentAmount = getPayment(d, activeTab);
                  const dateValue = getDate(d, activeTab);

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
                      <td className="py-2.5 pr-3 text-xs text-foreground">{d.dealStageLabel}</td>
                      {activeTab === "complete" ? (
                        <>
                          <td className="py-2.5 pr-3"><StatusBadge status={d.peM1Status} /></td>
                          <td className="py-2.5 pr-3"><StatusBadge status={d.peM2Status} /></td>
                        </>
                      ) : (
                        <td className="py-2.5 pr-3"><StatusBadge status={status} /></td>
                      )}
                      <td className="py-2.5 pr-3 text-xs text-muted tabular-nums">{fmtDate(dateValue)}</td>
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
              {hasFilters
                ? "No projects match your filters."
                : activeTab === "preconstruction" ? "No PE deals in pre-construction stages."
                : activeTab === "construction" ? "No PE deals in construction/inspection stages."
                : activeTab === "m1" ? "All PTO/Close Out projects have M1 paid!"
                : activeTab === "m2" ? "All Close Out projects have M2 paid!"
                : "No projects with both M1 and M2 fully paid yet."}
            </div>
          )}
        </div>
      </div>

      {isLoading && <div className="text-center py-12 text-muted">Loading PE deal data...</div>}
    </DashboardShell>
  );
}
