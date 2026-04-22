"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import type {
  PaymentStatusGroup,
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

// Status-only groupings. Action items (Issues, Ready to Invoice) live on
// the separate /dashboards/payment-action-queue page.
const GROUPS: {
  key: PaymentStatusGroup;
  title: string;
  accent: "red" | "amber" | "blue" | "emerald";
  defaultCollapsed?: boolean;
  rowLimit?: number;
  showWhy?: boolean;
}[] = [
  { key: "partially_paid", title: "⏳ Partially Paid", accent: "blue" },
  { key: "not_started", title: "📋 Not Yet Paid", accent: "blue" },
  {
    key: "fully_paid",
    title: "✅ Fully Paid",
    accent: "emerald",
    defaultCollapsed: true,
    rowLimit: 500,
  },
];

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
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [closeDateFrom, setCloseDateFrom] = useState("");
  const [closeDateTo, setCloseDateTo] = useState("");

  const allLocations = useMemo(
    () =>
      Array.from(new Set((data?.deals ?? []).map((d) => d.pbLocation).filter(Boolean))).sort(),
    [data?.deals]
  );
  const allStages = useMemo(
    () =>
      Array.from(new Set((data?.deals ?? []).map((d) => d.dealStageLabel).filter(Boolean))).sort(),
    [data?.deals]
  );

  const filtered = useMemo(() => {
    const deals = data?.deals ?? [];
    const fromTs = closeDateFrom ? new Date(closeDateFrom).getTime() : null;
    const toTs = closeDateTo ? new Date(closeDateTo).getTime() : null;
    return deals.filter((d) => {
      if (locationFilter.length && !locationFilter.includes(d.pbLocation)) return false;
      if (typeFilter === "pe" && !d.isPE) return false;
      if (typeFilter === "std" && d.isPE) return false;
      if (stageFilter.length && !stageFilter.includes(d.dealStageLabel)) return false;
      if (statusFilter.length && !statusFilter.includes(d.statusGroup)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!d.dealName.toLowerCase().includes(q) && !d.dealId.includes(q)) return false;
      }
      if (fromTs || toTs) {
        if (!d.closeDate) return false;
        const cd = new Date(d.closeDate).getTime();
        if (fromTs && cd < fromTs) return false;
        if (toTs && cd > toTs) return false;
      }
      return true;
    });
  }, [data?.deals, locationFilter, typeFilter, stageFilter, statusFilter, search, closeDateFrom, closeDateTo]);

  const byGroup = useMemo(() => {
    const out: Record<PaymentStatusGroup, PaymentTrackingDeal[]> = {
      issues: [],
      ready_to_invoice: [],
      partially_paid: [],
      not_started: [],
      fully_paid: [],
    };
    for (const d of filtered) out[d.statusGroup].push(d);
    return out;
  }, [filtered]);

  const summary = data?.summary;

  const csvRows = useMemo(
    () =>
      filtered.map((d) => ({
        dealId: d.dealId,
        name: d.dealName,
        location: d.pbLocation,
        stage: d.dealStageLabel,
        type: d.isPE ? "PE" : "STD",
        statusGroup: d.statusGroup,
        contract: d.customerContractTotal,
        daStatus: d.daStatus ?? "",
        ccStatus: d.ccStatus ?? "",
        ptoStatus: d.ptoStatus ?? "",
        peM1Status: d.peM1Status ?? "",
        peM2Status: d.peM2Status ?? "",
        outstanding: d.customerOutstanding + (d.peBonusOutstanding ?? 0),
        collectedPct: d.collectedPct.toFixed(1),
        attentionReasons: d.attentionReasons.join(" | "),
      })),
    [filtered]
  );

  // Issues + Ready-to-Invoice counts to surface as a link to the action queue.
  const actionCount = useMemo(() => {
    const deals = data?.deals ?? [];
    return deals.filter((d) => d.statusGroup === "issues" || d.statusGroup === "ready_to_invoice").length;
  }, [data?.deals]);

  return (
    <DashboardShell
      title="Payment Tracking"
      accentColor="emerald"
      lastUpdated={data?.lastUpdated}
      exportData={{ data: csvRows, filename: "payment-tracking.csv" }}
      fullWidth
      headerRight={
        actionCount > 0 ? (
          <a
            href="/dashboards/payment-action-queue"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 text-xs font-medium transition-colors"
          >
            🚨 {actionCount} need{actionCount === 1 ? "s" : ""} action →
          </a>
        ) : undefined
      }
    >
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
          subtitle={summary ? `Out of ${fmt(summary.peBonusTotal)} (PE only)` : null}
          color="cyan"
        />
        <StatCard
          label="% Collected"
          value={summary ? `${summary.collectedPct.toFixed(0)}%` : null}
          subtitle={summary ? `${fmt(summary.customerOutstanding)} outstanding` : null}
          color="emerald"
        />
      </div>

      {/* Filter bar — restored stage filter + added date range + status filter */}
      <div className="bg-surface rounded-lg border border-border shadow-card p-3 mb-4 space-y-2">
        <div className="flex flex-wrap gap-3 items-center">
          <MultiSelectFilter
            label="Location"
            options={allLocations.map((l) => ({ value: l, label: l }))}
            selected={locationFilter}
            onChange={setLocationFilter}
          />
          <MultiSelectFilter
            label="Stage"
            options={allStages.map((s) => ({ value: s, label: s }))}
            selected={stageFilter}
            onChange={setStageFilter}
          />
          <MultiSelectFilter
            label="Status"
            options={GROUPS.map((g) => ({ value: g.key, label: g.title.replace(/^\W+\s*/, "") }))}
            selected={statusFilter}
            onChange={setStatusFilter}
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

        <div className="flex flex-wrap gap-3 items-center">
          <label className="flex items-center gap-1 text-xs text-muted">
            Close from
            <input
              type="date"
              value={closeDateFrom}
              onChange={(e) => setCloseDateFrom(e.target.value)}
              className="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-foreground"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">
            to
            <input
              type="date"
              value={closeDateTo}
              onChange={(e) => setCloseDateTo(e.target.value)}
              className="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-foreground"
            />
          </label>
          {(closeDateFrom || closeDateTo) && (
            <button
              onClick={() => {
                setCloseDateFrom("");
                setCloseDateTo("");
              }}
              className="text-[10px] text-muted hover:text-foreground"
            >
              clear dates
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-3 text-[10px] text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border border-zinc-700" /> not yet ready
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border bg-amber-500 border-amber-300 ring-2 ring-amber-400/60" /> ready to invoice
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border bg-zinc-500 border-zinc-400 ring-1 ring-zinc-300/40" /> draft
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border bg-amber-500 border-amber-500" /> sent
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border bg-amber-500 border-amber-300 ring-1 ring-emerald-400/40" /> partial
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full border bg-emerald-500 border-emerald-500" /> paid
          </span>
          <span>· hover for amounts · click to open invoice</span>
        </div>
      </div>

      {GROUPS.map((g) => {
        const deals = byGroup[g.key];
        if (deals.length === 0) return null;
        return (
          <DealSection
            key={g.key}
            title={g.title}
            accent={g.accent}
            deals={deals}
            defaultCollapsed={g.defaultCollapsed}
            rowLimit={g.rowLimit}
            showWhy={g.showWhy}
          />
        );
      })}
    </DashboardShell>
  );
}
