"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Types (mirrors API response)
// ---------------------------------------------------------------------------

const M1M2_OPTIONS = [
  "",
  "Ready to Submit",
  "Waiting on Information",
  "Submitted",
  "Rejected",
  "Ready to Resubmit",
  "Resubmitted",
  "Approved",
  "Paid",
] as const;

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
  postalCode: string | null;
  energyCommunity: boolean;
  ecLookupFailed: boolean;
  solarDC: boolean;
  batteryDC: boolean;
  leaseFactor: number;
  peM1Status: string | null;
  peM2Status: string | null;
  milestoneHighlight: "m1" | "m2" | "complete" | null;
  hubspotUrl: string;
  pePortalUrl: string | null;
  peProjectId: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const LOCATION_SHORT: Record<string, string> = {
  "Centennial": "DTC",
  "Westminster": "WST",
  "Colorado Springs": "CSP",
  "San Luis Obispo": "SLO",
  "Camarillo": "CAM",
};

function shortLocation(loc: string): string {
  return LOCATION_SHORT[loc] || loc.slice(0, 3).toUpperCase();
}

function shortType(t: string): string {
  if (t === "solar+battery") return "PV+ESS";
  if (t === "solar") return "PV";
  if (t === "battery") return "ESS";
  return t;
}

function truncateName(name: string, max = 20): string {
  if (name.length <= max) return name;
  return name.slice(0, max) + "…";
}

type SortKey = keyof PeDeal;
type SortDir = "asc" | "desc";

function sortDeals(deals: PeDeal[], key: SortKey, dir: SortDir): PeDeal[] {
  return [...deals].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return dir === "asc" ? av - bv : bv - av;
    }
    return dir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });
}

// ---------------------------------------------------------------------------
// Section component — renders a labeled table of deals
// ---------------------------------------------------------------------------

/** [sortKey, label, headerAlign] — headerAlign defaults to "text-left" */
const COLUMNS: [SortKey, string, string?][] = [
  ["dealName", "Deal"],
  ["pbLocation", "Loc"],
  ["dealStageLabel", "Stage"],
  ["closeDate", "Close"],
  ["systemType", "Type"],
  ["energyCommunity", "EC", "text-center"],
  ["leaseFactor", "Factor", "text-right"],
  ["epcPrice", "EPC", "text-right"],
  ["customerPays", "Cust.", "text-right"],
  ["pePaymentTotal", "PE Tot", "text-right"],
  ["pePaymentIC", "PE IC", "text-right"],
  ["pePaymentPC", "PE PC", "text-right"],
  ["totalPBRevenue", "Revenue", "text-right"],
  ["peM1Status", "M1"],
  ["peM2Status", "M2"],
];

function StatusDropdown({
  value,
  onChange,
  saving,
}: {
  value: string | null;
  onChange: (val: string) => void;
  saving: boolean;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={saving}
      title={value || ""}
      className={`text-xs rounded px-1 py-0.5 border border-border bg-surface-2 text-foreground cursor-pointer hover:bg-surface-elevated transition-colors max-w-[80px] truncate ${saving ? "opacity-50" : ""}`}
    >
      {M1M2_OPTIONS.map((opt) => (
        <option key={opt} value={opt}>
          {opt || "—"}
        </option>
      ))}
    </select>
  );
}

function DealSection({
  title,
  subtitle,
  accent,
  deals,
  sortKey,
  sortDir,
  sortArrow,
  toggleSort,
  onStatusChange,
  savingDeals,
}: {
  title: string;
  subtitle: string;
  accent?: "orange" | "emerald";
  deals: PeDeal[];
  sortKey: SortKey;
  sortDir: SortDir;
  sortArrow: (key: SortKey) => string;
  toggleSort: (key: SortKey) => void;
  onStatusChange: (dealId: string, field: "pe_m1_status" | "pe_m2_status", value: string) => void;
  savingDeals: Set<string>;
}) {
  const accentBorder = accent === "orange"
    ? "border-l-orange-400"
    : accent === "emerald"
      ? "border-l-emerald-400"
      : "border-l-transparent";

  // Section sums
  const sumPeTotal = deals.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);
  const sumPeIC = deals.reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
  const sumPePC = deals.reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
  const sumEpc = deals.reduce((s, d) => s + (d.epcPrice ?? 0), 0);

  return (
    <div>
      <div className={`flex items-baseline gap-3 mb-2 ${accent ? `border-l-2 ${accentBorder} pl-3` : ""}`}>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-xs text-muted">{subtitle}</span>
        {deals.length > 0 && (
          <span className="text-xs text-muted ml-auto">
            PE: {fmt(sumPeTotal)} ({fmt(sumPeIC)} IC + {fmt(sumPePC)} PC) · EPC: {fmt(sumEpc)}
          </span>
        )}
      </div>
      <div className="bg-surface rounded-lg border border-border shadow-card">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              {COLUMNS.map(([key, label, align]) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  className={`px-1.5 py-1.5 font-medium text-muted whitespace-nowrap cursor-pointer hover:text-foreground select-none ${align ?? "text-left"}`}
                >
                  {label}{sortArrow(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deals.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-muted text-sm">
                  No deals
                </td>
              </tr>
            ) : (
              deals.map((deal) => (
                <tr key={deal.dealId} className="border-b border-border/50 hover:bg-surface-2/50">
                  <td className="px-1.5 py-1.5 whitespace-nowrap max-w-[160px]">
                    <div className="flex items-center gap-1">
                      <a
                        href={deal.hubspotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-400 hover:text-orange-300 hover:underline truncate"
                        title={deal.dealName}
                      >
                        {truncateName(deal.dealName, 16)}
                      </a>
                      {deal.pePortalUrl && (
                        <a
                          href={deal.pePortalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-500/60 hover:text-emerald-400 flex-shrink-0"
                          title={`PE Portal${deal.peProjectId ? ` — ${deal.peProjectId}` : ""}`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-1.5 py-1.5 text-muted whitespace-nowrap" title={deal.pbLocation}>{shortLocation(deal.pbLocation) || "—"}</td>
                  <td className="px-1.5 py-1.5 text-muted whitespace-nowrap max-w-[80px] truncate" title={deal.dealStageLabel}>{deal.dealStageLabel}</td>
                  <td className="px-1.5 py-1.5 text-muted whitespace-nowrap">
                    {deal.closeDate ? new Date(deal.closeDate).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }) : "—"}
                  </td>
                  <td className="px-1.5 py-1.5 text-muted whitespace-nowrap" title={deal.systemType}>
                    {shortType(deal.systemType)}
                  </td>
                  <td className="px-1.5 py-1.5 whitespace-nowrap text-center">
                    {deal.ecLookupFailed ? (
                      <span className="text-yellow-400" title="EC lookup failed">⚠️</span>
                    ) : deal.energyCommunity ? (
                      <span className="text-emerald-400">✓</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-1.5 py-1.5 text-muted whitespace-nowrap text-right">{deal.leaseFactor.toFixed(3)}</td>
                  <td className="px-1.5 py-1.5 text-foreground whitespace-nowrap text-right font-medium">{fmt(deal.epcPrice)}</td>
                  <td className="px-1.5 py-1.5 text-muted whitespace-nowrap text-right">{fmt(deal.customerPays)}</td>
                  <td className="px-1.5 py-1.5 text-blue-400 whitespace-nowrap text-right font-medium">{fmt(deal.pePaymentTotal)}</td>
                  <td className="px-1.5 py-1.5 text-muted whitespace-nowrap text-right">{fmt(deal.pePaymentIC)}</td>
                  <td className="px-1.5 py-1.5 text-muted whitespace-nowrap text-right">{fmt(deal.pePaymentPC)}</td>
                  <td className="px-1.5 py-1.5 text-emerald-400 whitespace-nowrap text-right font-medium">{fmt(deal.totalPBRevenue)}</td>
                  <td className="px-1.5 py-1.5 whitespace-nowrap">
                    <StatusDropdown
                      value={deal.peM1Status}
                      onChange={(val) => onStatusChange(deal.dealId, "pe_m1_status", val)}
                      saving={savingDeals.has(`${deal.dealId}:pe_m1_status`)}
                    />
                  </td>
                  <td className="px-1.5 py-1.5 whitespace-nowrap">
                    <StatusDropdown
                      value={deal.peM2Status}
                      onChange={(val) => onStatusChange(deal.dealId, "pe_m2_status", val)}
                      saving={savingDeals.has(`${deal.dealId}:pe_m2_status`)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PeDealsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.peDeals.list(),
    queryFn: async () => {
      const res = await fetch("/api/accounting/pe-deals");
      if (!res.ok) throw new Error("Failed to fetch PE deals");
      return res.json() as Promise<{ deals: PeDeal[]; lastUpdated: string }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [m1Filter, setM1Filter] = useState<string[]>([]);
  const [m2Filter, setM2Filter] = useState<string[]>([]);
  const [savingDeals, setSavingDeals] = useState<Set<string>>(new Set());

  const handleStatusChange = useCallback(
    async (dealId: string, field: "pe_m1_status" | "pe_m2_status", value: string) => {
      const key = `${dealId}:${field}`;
      setSavingDeals((prev) => new Set(prev).add(key));

      // Optimistic update
      queryClient.setQueryData(
        queryKeys.peDeals.list(),
        (old: { deals: PeDeal[]; lastUpdated: string } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            deals: old.deals.map((d) =>
              d.dealId === dealId
                ? { ...d, [field === "pe_m1_status" ? "peM1Status" : "peM2Status"]: value || null }
                : d,
            ),
          };
        },
      );

      try {
        const res = await fetch("/api/accounting/pe-deals", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId, field, value }),
        });
        if (!res.ok) throw new Error("Failed to update");
      } catch {
        // Revert on failure
        queryClient.invalidateQueries({ queryKey: queryKeys.peDeals.list() });
      } finally {
        setSavingDeals((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [queryClient],
  );
  const [sortKey, setSortKey] = useState<SortKey>("closeDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const deals = data?.deals ?? [];
  const lastUpdated = data?.lastUpdated
    ? new Date(data.lastUpdated).toLocaleTimeString()
    : undefined;

  // Filter options
  const locationOptions = useMemo(
    () => [...new Set(deals.map((d) => d.pbLocation).filter(Boolean))].sort(),
    [deals],
  );
  const stageOptions = useMemo(
    () =>
      [...new Map(deals.map((d) => [d.dealStage, d.dealStageLabel])).entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [deals],
  );

  const m1Options = useMemo(
    () => [...new Set(deals.map((d) => d.peM1Status).filter(Boolean) as string[])].sort(),
    [deals],
  );
  const m2Options = useMemo(
    () => [...new Set(deals.map((d) => d.peM2Status).filter(Boolean) as string[])].sort(),
    [deals],
  );

  // Apply filters
  const filtered = useMemo(() => {
    let result = deals;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) => d.dealName.toLowerCase().includes(q),
      );
    }
    if (locationFilter.length > 0) {
      result = result.filter((d) => locationFilter.includes(d.pbLocation));
    }
    if (stageFilter.length > 0) {
      result = result.filter((d) => stageFilter.includes(d.dealStage));
    }
    if (m1Filter.length > 0) {
      result = result.filter((d) => d.peM1Status !== null && m1Filter.includes(d.peM1Status));
    }
    if (m2Filter.length > 0) {
      result = result.filter((d) => d.peM2Status !== null && m2Filter.includes(d.peM2Status));
    }
    return sortDeals(result, sortKey, sortDir);
  }, [deals, search, locationFilter, stageFilter, m1Filter, m2Filter, sortKey, sortDir]);

  // Split into priority sections
  const paidDeals = useMemo(() => filtered.filter((d) => d.peM1Status === "Paid" && d.peM2Status === "Paid"), [filtered]);
  const partiallyPaidDeals = useMemo(() => filtered.filter((d) =>
    (d.peM1Status === "Paid" || d.peM2Status === "Paid") && !(d.peM1Status === "Paid" && d.peM2Status === "Paid"),
  ), [filtered]);
  const fullyApprovedDeals = useMemo(() => filtered.filter((d) =>
    d.peM1Status === "Approved" && d.peM2Status === "Approved",
  ), [filtered]);
  const partiallyApprovedDeals = useMemo(() => filtered.filter((d) =>
    d.peM1Status !== "Paid" && d.peM2Status !== "Paid" &&
    !(d.peM1Status === "Approved" && d.peM2Status === "Approved") &&
    (d.peM1Status === "Approved" || d.peM2Status === "Approved"),
  ), [filtered]);
  const excludedIds = useMemo(
    () => new Set([...paidDeals, ...partiallyPaidDeals, ...fullyApprovedDeals, ...partiallyApprovedDeals].map((d) => d.dealId)),
    [paidDeals, partiallyPaidDeals, fullyApprovedDeals, partiallyApprovedDeals],
  );
  const unpaid = useMemo(() => filtered.filter((d) => !excludedIds.has(d.dealId)), [filtered, excludedIds]);
  const m2Deals = useMemo(() => unpaid.filter((d) => d.milestoneHighlight === "m2"), [unpaid]);
  const m1Deals = useMemo(() => unpaid.filter((d) => d.milestoneHighlight === "m1"), [unpaid]);
  const allDeals = unpaid;

  // Hero-card stats use the FULL filtered PE deal set (paid + approved +
  // unpaid). NOT `allDeals` — that's the leftover bucket after subtracting
  // deals shown in other table sections.
  const totalPeExpected = filtered.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);

  // Ready-to-invoice: PE has approved our docs but we haven't been paid.
  const m1ReadyDeals = filtered.filter((d) => d.peM1Status === "Approved");
  const m2ReadyDeals = filtered.filter((d) => d.peM2Status === "Approved");
  const readyToInvoiceCount = m1ReadyDeals.length + m2ReadyDeals.length;
  const readyToInvoiceValue =
    m1ReadyDeals.reduce((s, d) => s + (d.pePaymentIC ?? 0), 0) +
    m2ReadyDeals.reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);

  // Already-paid PE totals across the full filtered set.
  const m1PaidValue = filtered
    .filter((d) => d.peM1Status === "Paid")
    .reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
  const m2PaidValue = filtered
    .filter((d) => d.peM2Status === "Paid")
    .reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
  const totalPECollected = m1PaidValue + m2PaidValue;

  // PE Receivable = milestones PE has committed to (Approved or Paid only).
  // Excludes deals where PE hasn't yet approved either milestone.
  const APPROVED_OR_PAID = new Set(["Approved", "Paid"]);
  const m1ReceivableValue = filtered
    .filter((d) => d.peM1Status !== null && APPROVED_OR_PAID.has(d.peM1Status))
    .reduce((s, d) => s + (d.pePaymentIC ?? 0), 0);
  const m2ReceivableValue = filtered
    .filter((d) => d.peM2Status !== null && APPROVED_OR_PAID.has(d.peM2Status))
    .reduce((s, d) => s + (d.pePaymentPC ?? 0), 0);
  const totalPEReceivable = m1ReceivableValue + m2ReceivableValue;
  const totalPEOutstanding = Math.max(0, totalPEReceivable - totalPECollected);

  // Awaiting PE Approval = PE payment we're owed based on deal stage,
  // minus what's already Approved or Paid.
  // PTO deals: M1 (pePaymentIC) should be done
  // Close Out / Complete deals: both M1 (pePaymentIC) + M2 (pePaymentPC)
  const isPto = (d: PeDeal) => {
    const s = d.dealStageLabel.toLowerCase();
    return s.includes("permission to operate") || s.includes("pto");
  };
  const isCloseOutOrComplete = (d: PeDeal) => {
    const s = d.dealStageLabel.toLowerCase();
    return s.includes("close out") || s.includes("complete");
  };
  let awaitingM1Value = 0;
  let awaitingM2Value = 0;
  let awaitingM1Count = 0;
  let awaitingM2Count = 0;
  for (const d of filtered) {
    const atPto = isPto(d);
    const atCloseOut = isCloseOutOrComplete(d);
    if (!atPto && !atCloseOut) continue;
    // M1: should be approved/paid at PTO or later
    if (!APPROVED_OR_PAID.has(d.peM1Status ?? "")) {
      awaitingM1Value += d.pePaymentIC ?? 0;
      awaitingM1Count++;
    }
    // M2: should be approved/paid at close-out or later
    if (atCloseOut && !APPROVED_OR_PAID.has(d.peM2Status ?? "")) {
      awaitingM2Value += d.pePaymentPC ?? 0;
      awaitingM2Count++;
    }
  }
  const totalAwaitingValue = awaitingM1Value + awaitingM2Value;
  const totalAwaitingCount = awaitingM1Count + awaitingM2Count;

  // CSV export data
  const exportData = filtered.map((d) => ({
    "Deal Name": d.dealName,
    "PB Location": d.pbLocation,
    "Deal Stage": d.dealStageLabel,
    "Close Date": d.closeDate ?? "",
    "System Type": d.systemType,
    "Energy Community": d.energyCommunity ? "Yes" : "No",
    "Lease Factor": d.leaseFactor.toFixed(7),
    "EPC Price": d.epcPrice ?? "",
    "Customer Pays": d.customerPays ?? "",
    "PE Payment Total": d.pePaymentTotal ?? "",
    "PE @ IC": d.pePaymentIC ?? "",
    "PE @ PC": d.pePaymentPC ?? "",
    "Total PB Revenue": d.totalPBRevenue ?? "",
    "PE M1": d.peM1Status ?? "",
    "PE M2": d.peM2Status ?? "",
  }));

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  if (error) {
    return (
      <DashboardShell title="PE Deals & Payments" accentColor="orange">
        <div className="text-center py-12 text-red-400">
          Failed to load PE deals. Please try again.
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="PE Deals & Payments"
      accentColor="orange"
      fullWidth
      lastUpdated={lastUpdated}
      exportData={{ data: exportData, filename: "pe-deals-payments" }}
    >
      {/* Hero Stats — PE payment pipeline */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6 stagger-grid">
        <StatCard
          key={`deals-${filtered.length}`}
          label="PE Deals"
          value={String(filtered.length)}
          subtitle={`${fmt(totalPeExpected)} total PE expected`}
          color="orange"
        />
        <StatCard
          key={`awaiting-${totalAwaitingCount}-${totalAwaitingValue}`}
          label="Awaiting PE Approval"
          value={fmt(totalAwaitingValue)}
          subtitle={`${totalAwaitingCount} milestones · ${awaitingM1Count} M1 + ${awaitingM2Count} M2`}
          color="amber"
        />
        <StatCard
          key={`ready-${readyToInvoiceCount}-${readyToInvoiceValue}`}
          label="Approved (Unpaid)"
          value={fmt(readyToInvoiceValue)}
          subtitle={`${readyToInvoiceCount} milestones · ${m1ReadyDeals.length} M1 + ${m2ReadyDeals.length} M2`}
          color="blue"
        />
        <StatCard
          key={`paid-${totalPECollected}`}
          label="PE Collected"
          value={fmt(totalPECollected)}
          subtitle={`${totalPEReceivable > 0 ? ((totalPECollected / totalPEReceivable) * 100).toFixed(0) : 0}% of ${fmt(totalPEReceivable)} approved`}
          color="emerald"
        />
        <StatCard
          key={`recv-${totalPEReceivable}`}
          label="Total Approved"
          value={fmt(totalPEReceivable)}
          subtitle={`Paid ${fmt(totalPECollected)} · Unpaid ${fmt(totalPEOutstanding)}`}
          color="green"
        />
      </div>

      {/* Report link */}
      <div className="mb-4">
        <Link
          href="/dashboards/pe-report"
          className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <span>📋</span> View PE Program Report
          <span className="text-xs text-muted">— shareable overview for ownership</span>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search deals..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded bg-surface-2 border border-border text-foreground text-sm w-64"
        />
        <MultiSelectFilter
          label="Location"
          options={locationOptions.map((l) => ({ value: l, label: `${shortLocation(l)} — ${l}` }))}
          selected={locationFilter}
          onChange={setLocationFilter}
        />
        <MultiSelectFilter
          label="Stage"
          options={stageOptions}
          selected={stageFilter}
          onChange={setStageFilter}
        />
        <MultiSelectFilter
          label="M1 Status"
          options={m1Options.map((s) => ({ value: s, label: s }))}
          selected={m1Filter}
          onChange={setM1Filter}
        />
        <MultiSelectFilter
          label="M2 Status"
          options={m2Options.map((s) => ({ value: s, label: s }))}
          selected={m2Filter}
          onChange={setM2Filter}
        />
      </div>

      {/* Tables by section */}
      {isLoading ? (
        <div className="text-center py-12 text-muted">Loading PE deals...</div>
      ) : (
        <div className="space-y-8">
          <DealSection
            title="Paid"
            subtitle={`${paidDeals.length} deal${paidDeals.length !== 1 ? "s" : ""} — M1 & M2 paid`}
            accent="emerald"
            deals={paidDeals}
            sortKey={sortKey}
            sortDir={sortDir}
            sortArrow={sortArrow}
            toggleSort={toggleSort}
            onStatusChange={handleStatusChange}
            savingDeals={savingDeals}
          />
          {partiallyPaidDeals.length > 0 && (
            <DealSection
              title="Partially Paid"
              subtitle={`${partiallyPaidDeals.length} deal${partiallyPaidDeals.length !== 1 ? "s" : ""} — M1 or M2 paid`}
              accent="orange"
              deals={partiallyPaidDeals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
            />
          )}
          {fullyApprovedDeals.length > 0 && (
            <DealSection
              title="Fully Approved — Waiting on Payment"
              subtitle={`${fullyApprovedDeals.length} deal${fullyApprovedDeals.length !== 1 ? "s" : ""} — M1 & M2 approved, awaiting PE payment`}
              accent="emerald"
              deals={fullyApprovedDeals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
            />
          )}
          {partiallyApprovedDeals.length > 0 && (
            <DealSection
              title="Partially Approved — In Progress"
              subtitle={`${partiallyApprovedDeals.length} deal${partiallyApprovedDeals.length !== 1 ? "s" : ""} — M1 or M2 approved, other milestone still in progress`}
              accent="orange"
              deals={partiallyApprovedDeals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
            />
          )}
          {m2Deals.length > 0 && (
            <DealSection
              title="M2 — Close Out"
              subtitle={`${m2Deals.length} deal${m2Deals.length !== 1 ? "s" : ""} pending PE payment (1/3)`}
              accent="emerald"
              deals={m2Deals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
            />
          )}
          {m1Deals.length > 0 && (
            <DealSection
              title="M1 — Permission To Operate"
              subtitle={`${m1Deals.length} deal${m1Deals.length !== 1 ? "s" : ""} pending PE payment (2/3)`}
              accent="orange"
              deals={m1Deals}
              sortKey={sortKey}
              sortDir={sortDir}
              sortArrow={sortArrow}
              toggleSort={toggleSort}
              onStatusChange={handleStatusChange}
              savingDeals={savingDeals}
            />
          )}
          <DealSection
            title="All Active PE Deals"
            subtitle={`${allDeals.length} total`}
            deals={allDeals}
            sortKey={sortKey}
            sortDir={sortDir}
            sortArrow={sortArrow}
            toggleSort={toggleSort}
            onStatusChange={handleStatusChange}
            savingDeals={savingDeals}
          />
        </div>
      )}
    </DashboardShell>
  );
}
