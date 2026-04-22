"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import type {
  PaymentBucket,
  PaymentTrackingDeal,
  PaymentTrackingResponse,
} from "@/lib/payment-tracking-types";
import { DealSection } from "./DealSection";

const BUCKET_META: {
  key: PaymentBucket;
  title: string;
  accent: "red" | "amber" | "blue" | "cyan" | "emerald";
  defaultCollapsed?: boolean;
  rowLimit?: number;
}[] = [
  { key: "attention", title: "🚨 Attention Needed", accent: "red" },
  { key: "awaiting_m1", title: "💼 Awaiting M1 / DA Invoice", accent: "amber" },
  { key: "awaiting_m2", title: "🔨 Awaiting M2 / CC Invoice", accent: "amber" },
  { key: "awaiting_pto", title: "📋 PTO Closeout Pending", accent: "blue" },
  { key: "awaiting_pe_m1", title: "⚡ Awaiting PE M1", accent: "cyan" },
  { key: "awaiting_pe_m2", title: "🎯 Awaiting PE M2", accent: "cyan" },
  {
    key: "fully_collected",
    title: "✅ Fully Collected",
    accent: "emerald",
    defaultCollapsed: true,
    rowLimit: 500,
  },
];

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function PaymentTrackingClient() {
  const { data, refetch } = useQuery<PaymentTrackingResponse>({
    queryKey: queryKeys.paymentTracking.list(),
    queryFn: async () => {
      const res = await fetch("/api/accounting/payment-tracking");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  useSSE(() => { refetch(); }, { url: "/api/stream", cacheKeyFilter: "accounting:payment-tracking" });

  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | "pe" | "std">("all");
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [outstandingOnly, setOutstandingOnly] = useState(true);

  const allLocations = useMemo(
    () =>
      Array.from(new Set((data?.deals ?? []).map((d) => d.pbLocation).filter(Boolean))).sort(),
    [data?.deals]
  );
  const allStages = useMemo(
    () =>
      Array.from(
        new Set((data?.deals ?? []).map((d) => d.dealStageLabel).filter(Boolean))
      ).sort(),
    [data?.deals]
  );

  const filtered = useMemo(() => {
    const deals = data?.deals ?? [];
    return deals.filter((d) => {
      if (locationFilter.length && !locationFilter.includes(d.pbLocation)) return false;
      if (typeFilter === "pe" && !d.isPE) return false;
      if (typeFilter === "std" && d.isPE) return false;
      if (stageFilter.length && !stageFilter.includes(d.dealStageLabel)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!d.dealName.toLowerCase().includes(q) && !d.dealId.includes(q)) return false;
      }
      if (outstandingOnly && d.bucket === "fully_collected") return false;
      return true;
    });
  }, [data?.deals, locationFilter, typeFilter, stageFilter, search, outstandingOnly]);

  const byBucket = useMemo(() => {
    const out: Record<PaymentBucket, PaymentTrackingDeal[]> = {
      attention: [],
      awaiting_m1: [],
      awaiting_m2: [],
      awaiting_pto: [],
      awaiting_pe_m1: [],
      awaiting_pe_m2: [],
      fully_collected: [],
    };
    for (const d of filtered) out[d.bucket].push(d);
    return out;
  }, [filtered]);

  const summary = data?.summary;

  const csvRows = useMemo(() => {
    return filtered.map((d) => ({
      dealId: d.dealId,
      name: d.dealName,
      location: d.pbLocation,
      stage: d.dealStageLabel,
      type: d.isPE ? "PE" : "STD",
      closeDate: d.closeDate ?? "",
      contract: d.customerContractTotal,
      daStatus: d.daStatus ?? "",
      daAmount: d.daAmount ?? "",
      daPaid: d.daPaidDate ?? "",
      ccStatus: d.ccStatus ?? "",
      ccAmount: d.ccAmount ?? "",
      ccPaid: d.ccPaidDate ?? "",
      ptoStatus: d.ptoStatus ?? "",
      peM1Status: d.peM1Status ?? "",
      peM1Amount: d.peM1Amount ?? "",
      peM2Status: d.peM2Status ?? "",
      peM2Amount: d.peM2Amount ?? "",
      totalRevenue: d.totalPBRevenue,
      outstanding: d.customerOutstanding + (d.peBonusOutstanding ?? 0),
      collectedPct: d.collectedPct.toFixed(1),
      paidInFullFlag: d.paidInFullFlag === null ? "" : String(d.paidInFullFlag),
      bucket: d.bucket,
    }));
  }, [filtered]);

  return (
    <DashboardShell
      title="Payment Tracking"
      accentColor="emerald"
      lastUpdated={data?.lastUpdated}
      exportData={{ data: csvRows, filename: "payment-tracking.csv" }}
      fullWidth
    >
      {/* Summary strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Customer Contract"
          value={summary ? fmt(summary.customerContractTotal) : null}
          subtitle={
            summary
              ? `Collected ${fmt(summary.customerCollected)} · Outstanding ${fmt(summary.customerOutstanding)}`
              : null
          }
          color="orange"
        />
        <StatCard
          label="PE Bonus Revenue"
          value={summary ? fmt(summary.peBonusTotal) : null}
          subtitle={
            summary
              ? `Collected ${fmt(summary.peBonusCollected)} · Outstanding ${fmt(summary.peBonusOutstanding)}`
              : null
          }
          color="cyan"
        />
        <StatCard
          label="Total PB Revenue"
          value={summary ? fmt(summary.totalPBRevenue) : null}
          subtitle={summary ? `${summary.dealCount} deals` : null}
          color="emerald"
        />
        <StatCard
          label="% Collected"
          value={summary ? `${summary.collectedPct.toFixed(1)}%` : null}
          color="emerald"
        />
      </div>

      {/* Filter bar */}
      <div className="bg-surface rounded-lg border border-border shadow-card p-3 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <MultiSelectFilter
            label="Location"
            options={allLocations.map((l) => ({ value: l, label: l }))}
            selected={locationFilter}
            onChange={setLocationFilter}
          />
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted">Type:</span>
            {(["all", "pe", "std"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2 py-0.5 rounded border ${
                  typeFilter === t
                    ? "bg-surface-elevated border-border text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <MultiSelectFilter
            label="Stage"
            options={allStages.map((s) => ({ value: s, label: s }))}
            selected={stageFilter}
            onChange={setStageFilter}
          />
          <input
            type="text"
            placeholder="Search deal / ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-foreground placeholder-muted"
          />
          <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={outstandingOnly}
              onChange={(e) => setOutstandingOnly(e.target.checked)}
            />
            Outstanding only
          </label>
        </div>
      </div>

      {/* All-PE section: every PE-tagged deal, regardless of milestone bucket.
          Only renders when the user hasn't already filtered to PE-only (would be
          redundant with the bucket sections below). */}
      {typeFilter !== "pe" && (() => {
        const peDeals = filtered.filter(
          (d) => d.isPE && (!outstandingOnly || d.bucket !== "fully_collected")
        );
        if (peDeals.length === 0) return null;
        return (
          <DealSection
            key="all-pe"
            title="⚡ All PE Deals"
            accent="blue"
            deals={peDeals}
          />
        );
      })()}

      {/* Sections by milestone bucket */}
      {BUCKET_META.map((meta) => {
        const deals = byBucket[meta.key];
        if (outstandingOnly && meta.key === "fully_collected") return null;
        if (deals.length === 0) return null;
        return (
          <DealSection
            key={meta.key}
            title={meta.title}
            accent={meta.accent}
            deals={deals}
            defaultCollapsed={meta.defaultCollapsed}
            rowLimit={meta.rowLimit}
          />
        );
      })}
    </DashboardShell>
  );
}
