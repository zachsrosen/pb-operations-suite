"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Types (mirrors API response)
// ---------------------------------------------------------------------------

interface PeDeal {
  dealId: string;
  dealName: string;
  companyName: string | null;
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
  milestoneHighlight: "m1" | "m2" | null;
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
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtFull(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
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

const COLUMNS: [SortKey, string][] = [
  ["dealName", "Deal"],
  ["companyName", "Company"],
  ["pbLocation", "Location"],
  ["dealStageLabel", "Stage"],
  ["closeDate", "Close Date"],
  ["systemType", "Type"],
  ["energyCommunity", "EC"],
  ["leaseFactor", "Factor"],
  ["epcPrice", "EPC Price"],
  ["customerPays", "Customer"],
  ["pePaymentTotal", "PE Total"],
  ["pePaymentIC", "PE @ IC"],
  ["pePaymentPC", "PE @ PC"],
  ["totalPBRevenue", "PB Revenue"],
  ["peM1Status", "M1"],
  ["peM2Status", "M2"],
];

function DealSection({
  title,
  subtitle,
  accent,
  deals,
  sortKey,
  sortDir,
  sortArrow,
  toggleSort,
}: {
  title: string;
  subtitle: string;
  accent?: "orange" | "emerald";
  deals: PeDeal[];
  sortKey: SortKey;
  sortDir: SortDir;
  sortArrow: (key: SortKey) => string;
  toggleSort: (key: SortKey) => void;
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
      <div className="overflow-x-auto bg-surface rounded-lg border border-border shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {COLUMNS.map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  className="px-3 py-2.5 text-xs font-medium text-muted whitespace-nowrap cursor-pointer hover:text-foreground select-none"
                >
                  {label}{sortArrow(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deals.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-muted">
                  No deals
                </td>
              </tr>
            ) : (
              deals.map((deal) => (
                <tr key={deal.dealId} className="border-b border-border/50 hover:bg-surface-2/50">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <a
                      href={deal.hubspotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-400 hover:text-orange-300 hover:underline"
                    >
                      {deal.dealName}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{deal.companyName ?? "—"}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{deal.pbLocation || "—"}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{deal.dealStageLabel}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">
                    {deal.closeDate ? new Date(deal.closeDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap capitalize">
                    {deal.systemType.replace("+", " + ")}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {deal.ecLookupFailed ? (
                      <span className="text-yellow-400" title="EC lookup failed">⚠️</span>
                    ) : deal.energyCommunity ? (
                      <span className="text-emerald-400">Yes</span>
                    ) : (
                      <span className="text-muted">No</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap text-right">{deal.leaseFactor.toFixed(3)}</td>
                  <td className="px-3 py-2 text-foreground whitespace-nowrap text-right font-medium">{fmtFull(deal.epcPrice)}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap text-right">{fmtFull(deal.customerPays)}</td>
                  <td className="px-3 py-2 text-blue-400 whitespace-nowrap text-right font-medium">{fmtFull(deal.pePaymentTotal)}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap text-right">{fmtFull(deal.pePaymentIC)}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap text-right">{fmtFull(deal.pePaymentPC)}</td>
                  <td className="px-3 py-2 text-emerald-400 whitespace-nowrap text-right font-medium">{fmtFull(deal.totalPBRevenue)}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{deal.peM1Status ?? "—"}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{deal.peM2Status ?? "—"}</td>
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

  // Apply filters
  const filtered = useMemo(() => {
    let result = deals;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.dealName.toLowerCase().includes(q) ||
          (d.companyName && d.companyName.toLowerCase().includes(q)),
      );
    }
    if (locationFilter.length > 0) {
      result = result.filter((d) => locationFilter.includes(d.pbLocation));
    }
    if (stageFilter.length > 0) {
      result = result.filter((d) => stageFilter.includes(d.dealStage));
    }
    return sortDeals(result, sortKey, sortDir);
  }, [deals, search, locationFilter, stageFilter, sortKey, sortDir]);

  // Split into priority sections
  const m1Deals = useMemo(() => filtered.filter((d) => d.milestoneHighlight === "m1"), [filtered]);
  const m2Deals = useMemo(() => filtered.filter((d) => d.milestoneHighlight === "m2"), [filtered]);
  const allDeals = filtered;

  // Summary stats (exclude deals with null pricing)
  const totalEPC = filtered.reduce((s, d) => s + (d.epcPrice ?? 0), 0);
  const totalPEReceivable = filtered.reduce((s, d) => s + (d.pePaymentTotal ?? 0), 0);
  const totalRevenue = filtered.reduce((s, d) => s + (d.totalPBRevenue ?? 0), 0);

  // CSV export data
  const exportData = filtered.map((d) => ({
    "Deal Name": d.dealName,
    Company: d.companyName ?? "",
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
      exportData={{ data: exportData, filename: "pe-deals-payments.csv" }}
    >
      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 stagger-grid">
        <StatCard
          key={`deals-${filtered.length}`}
          label="PE Deals"
          value={String(filtered.length)}
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
          placeholder="Search deals or companies..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded bg-surface-2 border border-border text-foreground text-sm w-64"
        />
        <MultiSelectFilter
          label="Location"
          options={locationOptions.map((l) => ({ value: l, label: l }))}
          selected={locationFilter}
          onChange={setLocationFilter}
        />
        <MultiSelectFilter
          label="Stage"
          options={stageOptions}
          selected={stageFilter}
          onChange={setStageFilter}
        />
      </div>

      {/* Tables by section */}
      {isLoading ? (
        <div className="text-center py-12 text-muted">Loading PE deals...</div>
      ) : (
        <div className="space-y-8">
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
            />
          )}
          <DealSection
            title="All PE Deals"
            subtitle={`${allDeals.length} total`}
            deals={allDeals}
            sortKey={sortKey}
            sortDir={sortDir}
            sortArrow={sortArrow}
            toggleSort={toggleSort}
          />
        </div>
      )}
    </DashboardShell>
  );
}
