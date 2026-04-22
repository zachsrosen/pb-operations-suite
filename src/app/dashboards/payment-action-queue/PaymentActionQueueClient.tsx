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
import { DealSection } from "../payment-tracking/DealSection";

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Days a milestone has been "ready to invoice" — used as a proxy for
 * urgency on the action queue. We compute a per-deal staleness from the
 * earliest "work complete" trigger date that hasn't been paid yet.
 */
function daysSinceTrigger(deal: PaymentTrackingDeal, now: Date): number | null {
  const candidates: string[] = [];
  if (deal.daStatus !== "Paid In Full" && deal.designApprovalDate) {
    candidates.push(deal.designApprovalDate);
  }
  if (deal.ccStatus !== "Paid In Full" && deal.constructionCompleteDate) {
    candidates.push(deal.constructionCompleteDate);
  }
  if (
    !deal.isPE &&
    deal.ptoStatus !== "Paid In Full" &&
    deal.ptoGrantedDate
  ) {
    candidates.push(deal.ptoGrantedDate);
  }
  if (deal.isPE) {
    if (deal.peM1Status !== "Paid" && deal.inspectionPassedDate) {
      candidates.push(deal.inspectionPassedDate);
    }
    if (deal.peM2Status !== "Paid" && deal.ptoGrantedDate) {
      candidates.push(deal.ptoGrantedDate);
    }
  }
  if (candidates.length === 0) return null;
  const earliest = candidates
    .map((d) => new Date(d).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)[0];
  if (!earliest) return null;
  return Math.floor((now.getTime() - earliest) / 86_400_000);
}

export default function PaymentActionQueueClient() {
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
  const [minDaysWaiting, setMinDaysWaiting] = useState<string>("");

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

  const now = useMemo(() => new Date(), []);

  // Action-queue scope: only deals that need attention. Decorate each deal
  // with daysWaiting for sort + filter.
  const actionDeals = useMemo(() => {
    const deals = data?.deals ?? [];
    const minDays = minDaysWaiting ? parseInt(minDaysWaiting, 10) : 0;
    return deals
      .filter(
        (d) => d.statusGroup === "issues" || d.statusGroup === "ready_to_invoice"
      )
      .filter((d) => {
        if (locationFilter.length && !locationFilter.includes(d.pbLocation)) return false;
        if (typeFilter === "pe" && !d.isPE) return false;
        if (typeFilter === "std" && d.isPE) return false;
        if (stageFilter.length && !stageFilter.includes(d.dealStageLabel)) return false;
        if (search) {
          const q = search.toLowerCase();
          if (!d.dealName.toLowerCase().includes(q) && !d.dealId.includes(q)) return false;
        }
        if (minDays > 0) {
          const days = daysSinceTrigger(d, now) ?? 0;
          if (days < minDays) return false;
        }
        return true;
      });
  }, [data?.deals, locationFilter, typeFilter, stageFilter, search, minDaysWaiting, now]);

  // Three sections: rejected / overdue / ready-to-invoice. Splits the
  // attention bucket into actionable triage groups.
  const grouped = useMemo(() => {
    const rejected: PaymentTrackingDeal[] = [];
    const overdue: PaymentTrackingDeal[] = [];
    const ready: PaymentTrackingDeal[] = [];
    for (const d of actionDeals) {
      const reasons = d.attentionReasons.join(" ").toLowerCase();
      if (reasons.includes("rejected")) {
        rejected.push(d);
      } else if (reasons.includes("overdue") || reasons.includes("post-install") || reasons.includes(">14 days")) {
        overdue.push(d);
      } else {
        // Either "Ready to invoice" (work hit, not paid) or anything else
        // that landed in attention without a stronger label.
        ready.push(d);
      }
    }
    return { rejected, overdue, ready };
  }, [actionDeals]);

  const totalOutstanding = useMemo(
    () => actionDeals.reduce((sum, d) => sum + d.customerOutstanding + (d.peBonusOutstanding ?? 0), 0),
    [actionDeals]
  );

  const csvRows = useMemo(
    () =>
      actionDeals.map((d) => ({
        dealId: d.dealId,
        name: d.dealName,
        location: d.pbLocation,
        stage: d.dealStageLabel,
        type: d.isPE ? "PE" : "STD",
        contract: d.customerContractTotal,
        outstanding: d.customerOutstanding + (d.peBonusOutstanding ?? 0),
        daysWaiting: daysSinceTrigger(d, now) ?? "",
        attentionReasons: d.attentionReasons.join(" | "),
      })),
    [actionDeals, now]
  );

  return (
    <DashboardShell
      title="Payment Action Queue"
      subtitle="Deals that need accounting action: rejected invoices, overdue payments, and ready-to-invoice milestones"
      accentColor="red"
      lastUpdated={data?.lastUpdated}
      exportData={{ data: csvRows, filename: "payment-action-queue.csv" }}
      fullWidth
      headerRight={
        <a
          href="/dashboards/payment-tracking"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 text-xs font-medium transition-colors"
        >
          📊 Payment Tracking →
        </a>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Action Items"
          value={actionDeals.length.toString()}
          subtitle="Issues + Ready to Invoice"
          color="red"
        />
        <StatCard
          label="Rejected"
          value={grouped.rejected.length.toString()}
          subtitle="PE rejected our docs"
          color="red"
        />
        <StatCard
          label="Overdue / Stuck"
          value={grouped.overdue.length.toString()}
          subtitle=">30 days past close OR stuck post-install"
          color="amber"
        />
        <StatCard
          label="$ Outstanding"
          value={fmt(totalOutstanding)}
          subtitle="Across action items only"
          color="orange"
        />
      </div>

      <div className="bg-surface rounded-lg border border-border shadow-card p-3 mb-4">
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
          <label className="flex items-center gap-1 text-xs text-muted">
            Min days waiting
            <input
              type="number"
              min={0}
              value={minDaysWaiting}
              onChange={(e) => setMinDaysWaiting(e.target.value)}
              placeholder="0"
              className="w-16 bg-surface-2 border border-border rounded px-2 py-1 text-xs text-foreground placeholder-muted"
            />
          </label>
          <input
            type="text"
            placeholder="Search deal / ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-surface-2 border border-border rounded px-2 py-1 text-xs text-foreground placeholder-muted"
          />
        </div>
      </div>

      {grouped.rejected.length > 0 && (
        <DealSection
          title="❌ Rejected"
          accent="red"
          deals={grouped.rejected}
          showWhy
        />
      )}
      {grouped.overdue.length > 0 && (
        <DealSection
          title="🚨 Overdue / Stuck"
          accent="red"
          deals={grouped.overdue}
          showWhy
        />
      )}
      {grouped.ready.length > 0 && (
        <DealSection
          title="💰 Ready to Invoice"
          accent="amber"
          deals={grouped.ready}
          showWhy
        />
      )}
      {actionDeals.length === 0 && (
        <div className="bg-surface rounded-lg border border-border shadow-card p-8 text-center text-muted">
          🎉 No action items. All caught up.
        </div>
      )}
    </DashboardShell>
  );
}
