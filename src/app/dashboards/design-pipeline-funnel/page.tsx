"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/lib/query-keys";
import { formatCurrencyCompact } from "@/lib/format";
import type { FunnelResponse, FunnelStageData, MonthlyActivity, PendingSalesChange, DrillDownDeal, DrillDown, StageGroup } from "@/lib/funnel-aggregation";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";

const TIMEFRAMES = [
  { label: "1 month", value: 1 },
  { label: "3 months", value: 3 },
  { label: "6 months", value: 6 },
  { label: "9 months", value: 9 },
  { label: "12 months", value: 12 },
  { label: "18 months", value: 18 },
  { label: "24 months", value: 24 },
] as const;

// Month label helpers — used by FunnelBars / MonthlyFunnelChart / CohortTable (Tasks 6-8)
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(month: string, includeYear = true): string {
  const [y, m] = month.split("-");
  return includeYear ? `${MONTH_NAMES[parseInt(m) - 1]} ${y}` : `${MONTH_NAMES[parseInt(m) - 1]} ${y.slice(2)}`;
}

export default function DesignPipelineFunnelPage() {
  const [months, setMonths] = useState(6);
  const [locations, setLocations] = useState<string[]>([]);

  const locationOptions = useMemo(
    () => CANONICAL_LOCATIONS.map((loc) => ({ value: loc, label: loc })),
    []
  );

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery<FunnelResponse>({
    queryKey: queryKeys.funnel.designPipeline(months, locations),
    queryFn: async () => {
      const params = new URLSearchParams({ months: String(months) });
      if (locations.length > 0) params.set("locations", locations.join(","));
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
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={locations}
          onChange={setLocations}
          placeholder="All Locations"
          accentColor="orange"
        />
        <div className="flex items-center gap-2">
          <label htmlFor="timeframe" className="text-xs text-muted font-medium">Closed In Last</label>
          <select
            id="timeframe"
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
              subtitle={`${formatCurrencyCompact(s.salesClosed.amount + s.salesClosed.cancelledAmount)}${s.salesClosed.cancelledCount > 0 ? ` · ${s.salesClosed.cancelledCount} cancelled (${formatCurrencyCompact(s.salesClosed.cancelledAmount)})` : ""}`}
              color="orange"
            />
            <StatCard
              label="Survey Done"
              value={s.surveyDone.count + s.surveyDone.cancelledCount}
              subtitle={`${formatCurrencyCompact(s.surveyDone.amount + s.surveyDone.cancelledAmount)} · ${surveyPct}% of closed${s.surveyDone.cancelledCount > 0 ? ` · ${s.surveyDone.cancelledCount} cancelled (${formatCurrencyCompact(s.surveyDone.cancelledAmount)})` : ""}`}
              color="blue"
            />
            <StatCard
              label="DA Sent"
              value={s.daSent.count + s.daSent.cancelledCount}
              subtitle={`${formatCurrencyCompact(s.daSent.amount + s.daSent.cancelledAmount)} · ${daSentPct}% of surveyed${s.daSent.cancelledCount > 0 ? ` · ${s.daSent.cancelledCount} cancelled (${formatCurrencyCompact(s.daSent.cancelledAmount)})` : ""}`}
              color="purple"
            />
            <StatCard
              label="DA Approved"
              value={s.daApproved.count + s.daApproved.cancelledCount}
              subtitle={`${formatCurrencyCompact(s.daApproved.amount + s.daApproved.cancelledAmount)} · ${daApprovedPct}% of DA sent${s.daApproved.cancelledCount > 0 ? ` · ${s.daApproved.cancelledCount} cancelled (${formatCurrencyCompact(s.daApproved.cancelledAmount)})` : ""}`}
              color="green"
            />
          </div>

          {/* Row 2: Backlog & DA Pacing */}
          <BacklogAndPacing summary={s} cohorts={data.cohorts} monthlyActivity={data.monthlyActivity} pendingSalesChange={data.pendingSalesChange} drillDown={data.drillDown} />

          {/* Row 3: Funnel bars */}
          <FunnelBars summary={s} medianDays={data.medianDays} />
          <MonthlyFunnelChart cohorts={data.cohorts} />
          <CohortTable cohorts={data.cohorts} monthlyActivity={data.monthlyActivity} />
          <div className="mt-6">
            <StageDistribution stages={data.stageDistribution} totalDeals={closedTotal} />
          </div>
        </>
      )}
    </DashboardShell>
  );
}

function BacklogAndPacing({
  summary,
  cohorts,
  monthlyActivity,
  pendingSalesChange,
  drillDown,
}: {
  summary: FunnelResponse["summary"];
  cohorts: FunnelResponse["cohorts"];
  monthlyActivity: MonthlyActivity[];
  pendingSalesChange: PendingSalesChange;
  drillDown: DrillDown;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Active-only backlog (cancelled deals don't need to progress)
  const awaitingSurvey = summary.salesClosed.count - summary.surveyDone.count;
  const awaitingDaSend = summary.surveyDone.count - summary.daSent.count;
  const awaitingApproval = summary.daSent.count - summary.daApproved.count;
  const maxBacklog = Math.max(awaitingSurvey, awaitingDaSend, awaitingApproval, 1);

  function totalCount(d: FunnelStageData) { return d.count + d.cancelledCount; }

  // Activity-based DA Pacing: DAs the team actually completed this month
  // vs deals that closed last month (Matt's "1 month behind" benchmark).
  // cohorts[0] = newest close-date cohort; monthlyActivity[0] = newest activity month
  const currentMonth = cohorts[0];
  const priorMonth = cohorts[1];
  const currentActivity = monthlyActivity.find((a) => a.month === currentMonth?.month);
  const pacingTarget = priorMonth ? totalCount(priorMonth.salesClosed) : null;
  const pacingActual = currentActivity?.dasApproved ?? null;
  const pacingPct = pacingTarget && pacingTarget > 0 && pacingActual != null
    ? Math.round((pacingActual / pacingTarget) * 100)
    : null;

  // Prior month pacing for context ("design was ahead last month")
  const priorPriorMonth = cohorts[2];
  const priorActivity = monthlyActivity.find((a) => a.month === priorMonth?.month);
  const priorPacingTarget = priorPriorMonth ? totalCount(priorPriorMonth.salesClosed) : null;
  const priorPacingActual = priorActivity?.dasApproved ?? null;
  const priorPacingPct = priorPacingTarget && priorPacingTarget > 0 && priorPacingActual != null
    ? Math.round((priorPacingActual / priorPacingTarget) * 100)
    : null;

  const backlogs = [
    { key: "awaitingSurvey", label: "Awaiting Survey", count: awaitingSurvey, color: "bg-amber-500", deals: drillDown.awaitingSurvey },
    { key: "awaitingDaSend", label: "Awaiting DA Send", count: awaitingDaSend, color: "bg-purple-500", deals: drillDown.awaitingDaSend },
    { key: "awaitingApproval", label: "Awaiting Approval", count: awaitingApproval, color: "bg-green-500", deals: drillDown.awaitingApproval },
  ];

  function toggle(key: string) {
    setExpanded((prev) => (prev === key ? null : key));
  }

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <h3 className="text-sm font-semibold text-foreground/80 mb-4">
        Pipeline Backlog & DA Pacing
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Backlog bars */}
        <div className="space-y-1">
          {backlogs.map((b) => (
            <div key={b.key}>
              <button
                type="button"
                className="flex items-center gap-3 w-full py-1.5 rounded-md hover:bg-surface-2/50 transition-colors cursor-pointer"
                onClick={() => b.count > 0 && toggle(b.key)}
                disabled={b.count <= 0}
              >
                <span className="w-32 text-xs text-muted text-right shrink-0 flex items-center justify-end gap-1">
                  {b.count > 0 && (
                    <span className={`text-[10px] transition-transform ${expanded === b.key ? "rotate-90" : ""}`}>
                      ▶
                    </span>
                  )}
                  {b.label}
                </span>
                <div className="flex items-center gap-2 flex-1">
                  {b.count > 0 ? (
                    <div
                      className={`${b.color} h-6 rounded-md flex items-center px-2.5`}
                      style={{ width: `${Math.max(8, (b.count / maxBacklog) * 100)}%` }}
                    >
                      <span className="text-white text-xs font-bold">{b.count}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted/60 italic">—</span>
                  )}
                </div>
              </button>
              {expanded === b.key && b.deals.length > 0 && (
                <DrillDownTable deals={b.deals} />
              )}
            </div>
          ))}
          {/* Pending Sales Changes callout */}
          {pendingSalesChange.count > 0 && (
            <div className="mt-1 pt-3 border-t border-t-border/50">
              <button
                type="button"
                className="flex items-center gap-3 w-full py-1.5 rounded-md hover:bg-surface-2/50 transition-colors cursor-pointer"
                onClick={() => toggle("pendingSalesChange")}
              >
                <span className="w-32 text-xs text-red-400 text-right shrink-0 font-medium flex items-center justify-end gap-1">
                  <span className={`text-[10px] transition-transform ${expanded === "pendingSalesChange" ? "rotate-90" : ""}`}>
                    ▶
                  </span>
                  Pending Sales Change
                </span>
                <div className="flex items-center gap-2 flex-1">
                  <div
                    className="bg-red-500/80 h-6 rounded-md flex items-center px-2.5"
                    style={{ width: `${Math.max(8, (pendingSalesChange.count / maxBacklog) * 100)}%` }}
                  >
                    <span className="text-white text-xs font-bold">{pendingSalesChange.count}</span>
                  </div>
                  <span className="text-[11px] text-muted shrink-0">
                    {formatCurrencyCompact(pendingSalesChange.amount)}
                  </span>
                </div>
              </button>
              {expanded === "pendingSalesChange" && drillDown.pendingSalesChange.length > 0 && (
                <DrillDownTable deals={drillDown.pendingSalesChange} />
              )}
            </div>
          )}
        </div>

        {/* DA Pacing */}
        <div className="flex flex-col justify-center">
          {pacingPct != null && currentMonth && priorMonth && (
            <div className="bg-surface-2 rounded-lg p-4">
              <div className="text-xs text-muted mb-1">
                DA Pacing — {monthLabel(currentMonth.month)} DAs vs {monthLabel(priorMonth.month)} sales
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-bold ${pacingPct >= 100 ? "text-green-400" : "text-foreground"}`}>
                  {pacingPct}%
                </span>
                <span className="text-sm text-muted">
                  {pacingActual} of {pacingTarget} target
                </span>
              </div>
              {currentActivity && (
                <div className="text-xs text-muted mt-1">
                  {formatCurrencyCompact(currentActivity.dasApprovedAmount)} approved in {monthLabel(currentMonth.month)}
                </div>
              )}
              {priorPacingPct != null && priorMonth && priorPriorMonth && (
                <div className="text-xs text-muted mt-1">
                  {monthLabel(priorMonth.month)} was{" "}
                  <span className={priorPacingPct >= 100 ? "text-green-400 font-semibold" : ""}>
                    {priorPacingPct}%
                  </span>{" "}
                  ({priorPacingActual} / {priorPacingTarget}
                  {priorActivity ? ` · ${formatCurrencyCompact(priorActivity.dasApprovedAmount)}` : ""})
                  {priorPacingPct >= 100 && " — design was ahead"}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact inline deal table for backlog drill-down. */
function DrillDownTable({ deals }: { deals: DrillDownDeal[] }) {
  return (
    <div className="ml-[8.5rem] mt-1 mb-2 overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-t-border/50">
            <th className="text-left py-1 px-1.5 text-muted font-medium">Project</th>
            <th className="text-right py-1 px-1.5 text-muted font-medium">Amount</th>
            <th className="text-left py-1 px-1.5 text-muted font-medium">Location</th>
            <th className="text-left py-1 px-1.5 text-muted font-medium">Stage</th>
            <th className="text-right py-1 px-1.5 text-muted font-medium">Days</th>
            <th className="text-left py-1 px-1.5 text-muted font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr
              key={d.id}
              className={`border-b border-t-border/30 ${d.daysWaiting > 30 ? "bg-red-500/5" : ""}`}
            >
              <td className="py-1 px-1.5">
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground hover:text-orange-400 transition-colors"
                  title={d.name}
                >
                  {d.projectNumber ? `${d.projectNumber} — ` : ""}
                  <span className="max-w-[180px] truncate inline-block align-bottom">{d.name}</span>
                </a>
              </td>
              <td className="text-right py-1 px-1.5 text-muted">
                {formatCurrencyCompact(d.amount)}
              </td>
              <td className="py-1 px-1.5 text-muted truncate max-w-[100px]" title={d.pbLocation}>
                {d.pbLocation}
              </td>
              <td className="py-1 px-1.5 text-muted truncate max-w-[140px]" title={d.stage}>
                {d.stage}
              </td>
              <td className={`text-right py-1 px-1.5 font-medium ${d.daysWaiting > 30 ? "text-red-400" : d.daysWaiting > 14 ? "text-amber-400" : "text-muted"}`}>
                {d.daysWaiting}d
              </td>
              <td className="py-1 px-1.5 text-muted truncate max-w-[120px]" title={d.status || "—"}>
                {d.status || <span className="italic text-muted/60">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

        return (
          <div key={stage.key}>
            <div className="flex items-center gap-3 mb-1">
              <span className="w-24 text-xs text-muted text-right shrink-0">
                {stage.label}
              </span>
              {stageTotal === 0 ? (
                <span className="text-xs text-muted/60 italic">—</span>
              ) : (
                <div className="flex h-7" style={{ width: `${Math.max(2, (stageTotal / maxTotal) * 100)}%` }}>
                  <div
                    className={`${stage.color} rounded-l-md flex items-center px-2.5 min-w-0`}
                    style={{ width: `${(active / stageTotal) * 100}%` }}
                  >
                    <span className="text-white text-xs font-semibold truncate">
                      {active} · {formatCurrencyCompact(stage.data.amount)}
                    </span>
                  </div>
                  {cancelled > 0 && (
                    <div
                      className="bg-zinc-600 rounded-r-md flex items-center justify-center px-1.5 min-w-0"
                      style={{ width: `${(cancelled / stageTotal) * 100}%` }}
                      title={`${cancelled} cancelled · ${formatCurrencyCompact(stage.data.cancelledAmount)}`}
                    >
                      <span className="text-zinc-300 text-[10px] truncate">
                        {cancelled} · {formatCurrencyCompact(stage.data.cancelledAmount)}
                      </span>
                    </div>
                  )}
                </div>
              )}
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

function MonthlyFunnelChart({
  cohorts,
}: {
  cohorts: FunnelResponse["cohorts"];
}) {
  // Reverse to chronological order for display (oldest left → newest right)
  const chronological = useMemo(() => [...cohorts].reverse(), [cohorts]);

  const maxCount = useMemo(
    () =>
      Math.max(
        1,
        ...chronological.map(
          (c) => c.salesClosed.count + c.salesClosed.cancelledCount
        )
      ),
    [chronological]
  );

  const STAGE_COLORS = [
    { key: "salesClosed", color: "bg-orange-500", label: "Sales Closed" },
    { key: "surveyDone", color: "bg-blue-500", label: "Survey Done" },
    { key: "daSent", color: "bg-purple-500", label: "DA Sent" },
    { key: "daApproved", color: "bg-green-500", label: "DA Approved" },
  ] as const;

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <h3 className="text-sm font-semibold text-foreground/80 mb-4">
        Monthly Cohort Trend
      </h3>
      <div className="flex items-end justify-around gap-2" style={{ height: 160 }}>
        {chronological.map((cohort) => (
          <div key={cohort.month} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <div className="flex gap-0.5 items-end" style={{ height: 130 }}>
              {STAGE_COLORS.map(({ key, color }) => {
                const d = cohort[key as keyof typeof cohort] as FunnelStageData;
                const total = d.count + d.cancelledCount;
                const heightPct = (total / maxCount) * 100;
                return (
                  <div
                    key={key}
                    className={`${color} rounded-t-sm w-3 transition-all duration-300`}
                    style={{ height: `${Math.max(heightPct, total > 0 ? 3 : 0)}%` }}
                    title={`${STAGE_COLORS.find((s) => s.key === key)?.label}: ${total} · ${formatCurrencyCompact(d.amount + d.cancelledAmount)}`}
                  />
                );
              })}
            </div>
            <span className="text-[10px] text-muted truncate">
              {monthLabel(cohort.month, false)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 mt-3 text-[11px] text-muted">
        {STAGE_COLORS.map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 ${color} rounded-sm`} /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function CohortTable({ cohorts, monthlyActivity }: { cohorts: FunnelResponse["cohorts"]; monthlyActivity: MonthlyActivity[] }) {
  const STAGES = [
    { key: "salesClosed", label: "Sales Closed", textColor: "text-orange-400" },
    { key: "surveyDone", label: "Survey Done", textColor: "text-blue-400" },
    { key: "daSent", label: "DA Sent", textColor: "text-purple-400" },
    { key: "daApproved", label: "DA Approved", textColor: "text-green-400" },
  ] as const;

  function totalCount(d: FunnelStageData) { return d.count + d.cancelledCount; }

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5">
      <h3 className="text-sm font-semibold text-foreground/80 mb-3">
        Cohort Detail
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-t-border">
              <th className="text-left py-2 px-2 text-muted font-medium">Month</th>
              {STAGES.map((s) => (
                <th key={s.key} className={`text-center py-2 px-2 font-medium ${s.textColor}`}>
                  {s.label}
                </th>
              ))}
              <th className="text-center py-2 px-2 font-medium text-cyan-400">
                DA Pacing
              </th>
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort, i) => {
              const closedTotal = totalCount(cohort.salesClosed);

              // MoM sales delta (cohorts are newest-first, so i+1 is prior month)
              const priorCohort = cohorts[i + 1];
              const priorClosedTotal = priorCohort ? totalCount(priorCohort.salesClosed) : null;
              const momDelta = priorClosedTotal && priorClosedTotal > 0
                ? Math.round(((closedTotal - priorClosedTotal) / priorClosedTotal) * 100)
                : null;

              // DA Pacing: DAs actually completed this month vs prior month's Sales Closed
              const activity = monthlyActivity.find((a) => a.month === cohort.month);
              const pacingTarget = priorClosedTotal;
              const pacingActual = activity?.dasApproved ?? 0;
              const pacingPct = pacingTarget && pacingTarget > 0
                ? Math.round((pacingActual / pacingTarget) * 100)
                : null;

              return (
                <tr
                  key={cohort.month}
                  className={`border-b border-t-border/50 ${i % 2 === 0 ? "bg-surface-2/50" : ""}`}
                >
                  <td className="py-2 px-2 font-semibold text-foreground">
                    {monthLabel(cohort.month)}
                  </td>
                  {STAGES.map((stage) => {
                    const d = cohort[stage.key as keyof typeof cohort] as FunnelStageData;
                    const total = d.count + d.cancelledCount;
                    // Conversion from Sales Closed (not stage-to-stage)
                    const conversionPct =
                      stage.key === "salesClosed" || closedTotal === 0
                        ? null
                        : Math.round((total / closedTotal) * 100);

                    return (
                      <td key={stage.key} className="text-center py-2 px-2">
                        <div className={`font-semibold ${stage.textColor}`}>
                          {total}
                        </div>
                        <div className="text-muted">
                          {formatCurrencyCompact(d.amount + d.cancelledAmount)}
                        </div>
                        {d.cancelledCount > 0 && (
                          <div className="text-zinc-500">
                            {d.cancelledCount} cancelled ({formatCurrencyCompact(d.cancelledAmount)})
                          </div>
                        )}
                        {conversionPct != null && (
                          <div className={`${stage.textColor} text-[10px]`}>
                            {conversionPct}%
                          </div>
                        )}
                        {/* MoM delta on Sales Closed column */}
                        {stage.key === "salesClosed" && momDelta != null && (
                          <div className={`text-[10px] font-medium ${momDelta >= 0 ? "text-orange-400" : "text-muted"}`}>
                            {momDelta >= 0 ? "+" : ""}{momDelta}% MoM
                          </div>
                        )}
                      </td>
                    );
                  })}
                  {/* DA Pacing column */}
                  <td className="text-center py-2 px-2">
                    {pacingPct != null ? (
                      <>
                        <div className={`font-bold ${pacingPct >= 100 ? "text-green-400" : "text-cyan-400"}`}>
                          {pacingPct}%
                        </div>
                        <div className="text-muted">
                          {pacingActual} / {pacingTarget}
                        </div>
                        {pacingPct >= 100 && (
                          <div className="text-green-400 text-[10px]">on pace</div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted/60 italic">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StageDistribution({
  stages,
  totalDeals,
}: {
  stages: StageGroup[];
  totalDeals: number;
}) {
  const maxCount = Math.max(1, ...stages.map((s) => s.count));

  // Color by pipeline phase
  const STAGE_COLORS: Record<string, string> = {
    "Site Survey": "bg-amber-500",
    "Design & Engineering": "bg-blue-500",
    "Permitting & Interconnection": "bg-purple-500",
    "RTB - Blocked": "bg-red-500",
    "Ready To Build": "bg-cyan-500",
    "Construction": "bg-green-500",
    "Inspection": "bg-emerald-500",
    "Permission To Operate": "bg-teal-500",
    "Close Out": "bg-sky-500",
    "Project Complete": "bg-green-600",
    "On Hold": "bg-yellow-500",
    "Cancelled": "bg-zinc-600",
    "Project Rejected - Needs Review": "bg-red-400",
  };

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5">
      <h3 className="text-sm font-semibold text-foreground/80 mb-1">
        Current Pipeline Position
      </h3>
      <p className="text-xs text-muted mb-4">
        Where all {totalDeals} deals from this period currently sit
      </p>
      <div className="space-y-2">
        {stages.map((stage) => {
          const pct = totalDeals > 0 ? Math.round((stage.count / totalDeals) * 100) : 0;
          const color = STAGE_COLORS[stage.stageName] || "bg-zinc-500";
          return (
            <div key={stage.stageId} className="flex items-center gap-3">
              <span className="w-44 text-xs text-muted text-right shrink-0 truncate" title={stage.stageName}>
                {stage.stageName}
              </span>
              <div className="flex items-center gap-2 flex-1">
                {stage.count > 0 ? (
                  <div
                    className={`${color} h-6 rounded-md flex items-center px-2.5`}
                    style={{ width: `${Math.max(6, (stage.count / maxCount) * 100)}%` }}
                  >
                    <span className="text-white text-xs font-bold truncate">
                      {stage.count}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-muted/60 italic">—</span>
                )}
                <span className="text-[11px] text-muted shrink-0">
                  {formatCurrencyCompact(stage.amount)} · {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
