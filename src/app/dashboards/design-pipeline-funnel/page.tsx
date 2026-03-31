"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/lib/query-keys";
import { formatCurrencyCompact } from "@/lib/format";
import type { FunnelResponse, FunnelStageData } from "@/lib/funnel-aggregation";

const LOCATIONS = [
  "All Locations",
  "Denver Tech Center",
  "Westminster",
  "Colorado Springs",
  "California",
  "Camarillo",
] as const;

const TIMEFRAMES = [
  { label: "3 months", value: 3 },
  { label: "6 months", value: 6 },
  { label: "12 months", value: 12 },
] as const;

// Month label helpers — used by FunnelBars / MonthlyFunnelChart / CohortTable (Tasks 6-8)
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(month: string, includeYear = true): string {
  const [y, m] = month.split("-");
  return includeYear ? `${MONTH_NAMES[parseInt(m) - 1]} ${y}` : `${MONTH_NAMES[parseInt(m) - 1]} ${y.slice(2)}`;
}

export default function DesignPipelineFunnelPage() {
  const [months, setMonths] = useState(6);
  const [location, setLocation] = useState("all");

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery<FunnelResponse>({
    queryKey: queryKeys.funnel.designPipeline(months, location),
    queryFn: async () => {
      const params = new URLSearchParams({ months: String(months) });
      if (location !== "all") params.set("location", location);
      const res = await fetch(`/api/deals/funnel?${params}`);
      if (!res.ok) throw new Error("Failed to fetch funnel data");
      return res.json();
    },
  });

  useSSE(() => refetch(), { cacheKeyFilter: "funnel" });

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : null;

  if (error) {
    return (
      <DashboardShell title="Design Pipeline Funnel" accentColor="orange">
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      </DashboardShell>
    );
  }

  const s = data?.summary;

  // Stage-to-stage conversion percentages (using totals: active + cancelled)
  const closedTotal = s ? s.salesClosed.count + s.salesClosed.cancelledCount : 0;
  const surveyTotal = s ? s.surveyDone.count + s.surveyDone.cancelledCount : 0;
  const daSentTotal = s ? s.daSent.count + s.daSent.cancelledCount : 0;
  const daApprovedTotal = s ? s.daApproved.count + s.daApproved.cancelledCount : 0;

  const surveyPct = closedTotal > 0 ? Math.round((surveyTotal / closedTotal) * 100) : 0;
  const daSentPct = surveyTotal > 0 ? Math.round((daSentTotal / surveyTotal) * 100) : 0;
  const daApprovedPct = daSentTotal > 0 ? Math.round((daApprovedTotal / daSentTotal) * 100) : 0;

  return (
    <DashboardShell
      title="Design Pipeline Funnel"
      accentColor="orange"
      fullWidth
      lastUpdated={lastUpdated}
    >
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="bg-surface border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground"
        >
          {LOCATIONS.map((loc) => (
            <option key={loc} value={loc === "All Locations" ? "all" : loc}>
              {loc}
            </option>
          ))}
        </select>
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="bg-surface border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground"
        >
          {TIMEFRAMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading || !s ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* Row 1: StatCards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Sales Closed"
              value={s.salesClosed.count + s.salesClosed.cancelledCount}
              subtitle={`${formatCurrencyCompact(s.salesClosed.amount + s.salesClosed.cancelledAmount)}${s.salesClosed.cancelledCount > 0 ? ` · ${s.salesClosed.cancelledCount} cancelled` : ""}`}
              color="orange"
            />
            <StatCard
              label="Survey Done"
              value={s.surveyDone.count + s.surveyDone.cancelledCount}
              subtitle={`${formatCurrencyCompact(s.surveyDone.amount + s.surveyDone.cancelledAmount)} · ${surveyPct}% of closed`}
              color="blue"
            />
            <StatCard
              label="DA Sent"
              value={s.daSent.count + s.daSent.cancelledCount}
              subtitle={`${formatCurrencyCompact(s.daSent.amount + s.daSent.cancelledAmount)} · ${daSentPct}% of surveyed`}
              color="purple"
            />
            <StatCard
              label="DA Approved"
              value={s.daApproved.count + s.daApproved.cancelledCount}
              subtitle={`${formatCurrencyCompact(s.daApproved.amount + s.daApproved.cancelledAmount)} · ${daApprovedPct}% of DA sent`}
              color="green"
            />
          </div>

          {/* Rows 2-4 added in subsequent tasks */}
          <FunnelBars summary={s} medianDays={data.medianDays} />
          <MonthlyFunnelChart cohorts={data.cohorts} />
          <CohortTable cohorts={data.cohorts} />
        </>
      )}
    </DashboardShell>
  );
}

function FunnelBars({
  summary,
  medianDays,
}: {
  summary: FunnelResponse["summary"];
  medianDays: FunnelResponse["medianDays"];
}) {
  const stages = [
    { key: "salesClosed", label: "Sales Closed", color: "bg-orange-500", data: summary.salesClosed },
    { key: "surveyDone", label: "Survey Done", color: "bg-blue-500", data: summary.surveyDone },
    { key: "daSent", label: "DA Sent", color: "bg-purple-500", data: summary.daSent },
    { key: "daApproved", label: "DA Approved", color: "bg-green-500", data: summary.daApproved },
  ] as const;

  const maxTotal = stages[0].data.count + stages[0].data.cancelledCount || 1;

  // Stage-to-stage conversion using totals (active + cancelled)
  function total(d: FunnelStageData) { return d.count + d.cancelledCount; }

  const conversions = [
    {
      pct: total(stages[0].data) > 0
        ? Math.round((total(stages[1].data) / total(stages[0].data)) * 100)
        : 0,
      days: medianDays.closedToSurvey,
    },
    {
      pct: total(stages[1].data) > 0
        ? Math.round((total(stages[2].data) / total(stages[1].data)) * 100)
        : 0,
      days: medianDays.surveyToDaSent,
    },
    {
      pct: total(stages[2].data) > 0
        ? Math.round((total(stages[3].data) / total(stages[2].data)) * 100)
        : 0,
      days: medianDays.daSentToApproved,
    },
  ];

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <h3 className="text-sm font-semibold text-foreground/80 mb-4">
        Pipeline Throughput
      </h3>
      {stages.map((stage, i) => {
        const active = stage.data.count;
        const cancelled = stage.data.cancelledCount;
        const stageTotal = active + cancelled;
        const widthPct = Math.max(2, (stageTotal / maxTotal) * 100);
        const activeWidthPct = stageTotal > 0 ? (active / stageTotal) * 100 : 100;

        return (
          <div key={stage.key}>
            <div className="flex items-center gap-3 mb-1">
              <span className="w-24 text-xs text-muted text-right shrink-0">
                {stage.label}
              </span>
              <div className="flex h-7" style={{ width: `${widthPct}%` }}>
                <div
                  className={`${stage.color} rounded-l-md flex items-center px-2.5 min-w-0`}
                  style={{ width: `${activeWidthPct}%` }}
                >
                  <span className="text-white text-xs font-semibold truncate">
                    {active} · {formatCurrencyCompact(stage.data.amount)}
                  </span>
                </div>
                {cancelled > 0 && (
                  <div
                    className="bg-zinc-600 rounded-r-md flex items-center justify-center px-1.5 min-w-0"
                    style={{ width: `${100 - activeWidthPct}%` }}
                  >
                    <span className="text-zinc-300 text-[10px]">{cancelled}</span>
                  </div>
                )}
              </div>
            </div>
            {/* Conversion arrow between bars */}
            {i < stages.length - 1 && (
              <div className="flex items-center gap-3 mb-2">
                <span className="w-24" />
                <div className="flex items-center gap-1.5 pl-2 text-muted">
                  <span className="text-base">↓</span>
                  <span className="text-[11px]">
                    {conversions[i].pct}% conversion
                    {conversions[i].days != null && ` · median ${conversions[i].days}d`}
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div className="flex gap-4 mt-3 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-orange-500 rounded-sm" /> Active
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-zinc-600 rounded-sm" /> Cancelled
        </span>
      </div>
    </div>
  );
}

// Placeholder components — implemented in Tasks 7-8
function MonthlyFunnelChart({ cohorts }: { cohorts: FunnelResponse["cohorts"] }) {
  return <div className="mb-6" />;
}
function CohortTable({ cohorts }: { cohorts: FunnelResponse["cohorts"] }) {
  return <div />;
}
