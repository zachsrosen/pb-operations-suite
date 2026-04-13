"use client";

import { useState, useMemo, useCallback } from "react";
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
      className={`text-xs rounded px-1.5 py-0.5 border border-border bg-surface-2 text-foreground cursor-pointer hover:bg-surface-elevated transition-colors ${saving ? "opacity-50" : ""}`}
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

  return (
    <div>
      <div className={`flex items-baseline gap-3 mb-2 ${accent ? `border-l-2 ${accentBorder} pl-3` : ""}`}>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-xs text-muted">{subtitle}</span>
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
                  <td className="px-1.5 py-1.5 whitespace-nowrap max-w-[140px]">
                    <a
                      href={deal.hubspotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-400 hover:text-orange-300 hover:underline"
                      title={deal.dealName}
                    >
                      {truncateName(deal.dealName, 16)}
                    </a>
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
  const paidIds = useMemo(() => new Set(paidDeals.map((d) => d.dealId)), [paidDeals]);
  const unpaid = useMemo(() => filtered.filter((d) => !paidIds.has(d.dealId)), [filtered, paidIds]);
  const m2Deals = useMemo(() => unpaid.filter((d) => d.milestoneHighlight === "m2"), [unpaid]);
  const m1Deals = useMemo(() => unpaid.filter((d) => d.milestoneHighlight === "m1"), [unpaid]);
  const allDeals = unpaid;

  // Summary stats (active deals only, exclude fully paid)
  const totalEPC = allDeals.reduce((s, d) => s + (d.epcPrice ?? 0), 0);
  const totalPEReceivable = allDeals.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);
  const totalRevenue = allDeals.reduce((s, d) => s + (d.totalPBRevenue ?? 0), 0);

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
      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 stagger-grid">
        <StatCard
          key={`deals-${allDeals.length}`}
          label="Active PE Deals"
          value={String(allDeals.length)}
          color="orange"
        />
        <StatCard
          key={`epc-${totalEPC}`}
          label="Total EPC"
          value={fmt(totalEPC)}
          color="blue"
        />
        <StatCard
          key={`recv-${totalPEReceivable}`}
          label="Total PE Receivable"
          value={fmt(totalPEReceivable)}
          color="emerald"
        />
        <StatCard
          key={`rev-${totalRevenue}`}
          label="Total PB Revenue"
          value={fmt(totalRevenue)}
          color="green"
        />
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
