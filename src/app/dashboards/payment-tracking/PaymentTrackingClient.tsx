"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import type {
  PaymentTrackingDeal,
  PaymentTrackingResponse,
} from "@/lib/payment-tracking-types";
import { DealSection } from "./DealSection";

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
  const [search, setSearch] = useState("");

  const allLocations = useMemo(
    () =>
      Array.from(new Set((data?.deals ?? []).map((d) => d.pbLocation).filter(Boolean))).sort(),
    [data?.deals]
  );

  const filtered = useMemo(() => {
    const deals = data?.deals ?? [];
    return deals.filter((d) => {
      if (locationFilter.length && !locationFilter.includes(d.pbLocation)) return false;
      if (typeFilter === "pe" && !d.isPE) return false;
      if (typeFilter === "std" && d.isPE) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!d.dealName.toLowerCase().includes(q) && !d.dealId.includes(q)) return false;
      }
      return true;
    });
  }, [data?.deals, locationFilter, typeFilter, search]);

  // Two-section split: anything with attention reasons goes on top.
  const { needsAction, inProgress } = useMemo(() => {
    const a: PaymentTrackingDeal[] = [];
    const b: PaymentTrackingDeal[] = [];
    for (const d of filtered) {
      if (d.attentionReasons.length > 0) a.push(d);
      else if (d.bucket !== "fully_collected") b.push(d);
    }
    return { needsAction: a, inProgress: b };
  }, [filtered]);

  const summary = data?.summary;

  const csvRows = useMemo(() => {
    return filtered.map((d) => ({
      dealId: d.dealId,
      name: d.dealName,
      location: d.pbLocation,
      stage: d.dealStageLabel,
      type: d.isPE ? "PE" : "STD",
      contract: d.customerContractTotal,
      daStatus: d.daStatus ?? "",
      ccStatus: d.ccStatus ?? "",
      ptoStatus: d.ptoStatus ?? "",
      peM1Status: d.peM1Status ?? "",
      peM2Status: d.peM2Status ?? "",
      outstanding: d.customerOutstanding + (d.peBonusOutstanding ?? 0),
      collectedPct: d.collectedPct.toFixed(1),
      attentionReasons: d.attentionReasons.join(" | "),
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
      {/* Summary strip — 4 cards reflecting the unified money model:
          deal.amount = total contract; customer + PE collections sum against it. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Total Contract Value"
          value={summary ? fmt(summary.customerContractTotal) : null}
          subtitle={summary ? `${summary.dealCount} active deals` : null}
          color="orange"
        />
        <StatCard
          label="Collected from Customer"
          value={summary ? fmt(summary.customerCollected) : null}
          subtitle="DA + CC + PTO invoices"
          color="emerald"
        />
        <StatCard
          label="Collected from PE"
          value={summary ? fmt(summary.peBonusCollected) : null}
          subtitle={summary ? `Out of ${fmt(summary.peBonusTotal)} expected (PE only)` : null}
          color="cyan"
        />
        <StatCard
          label="% Collected"
          value={summary ? `${summary.collectedPct.toFixed(0)}%` : null}
          subtitle={summary ? `${fmt(summary.customerOutstanding)} outstanding` : null}
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
          <input
            type="text"
            placeholder="Search deal / ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-foreground placeholder-muted"
          />
        </div>

        {/* Legend */}
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border border-zinc-700" /> not started
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border bg-zinc-500 border-zinc-500" /> pending
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border bg-amber-500 border-amber-500" /> open
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border bg-amber-500 border-amber-300 ring-2 ring-amber-400/50" /> ready (work done, not paid)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border bg-emerald-500 border-emerald-500" /> paid
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border bg-red-500 border-red-500" /> rejected
          </span>
          <span>· Order: DA · CC · PTO · PE M1 · PE M2 (PE only)</span>
        </div>
      </div>

      {needsAction.length > 0 && (
        <DealSection
          title="🚨 Needs Action"
          accent="red"
          deals={needsAction}
          showWhy
        />
      )}
      <DealSection
        title="📊 In Progress"
        accent="amber"
        deals={inProgress}
      />
    </DashboardShell>
  );
}
