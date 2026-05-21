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
import type {
  ProjectFunnelResponse,
  ProjectFunnelStageData,
  ProjectFunnelStageKey,
  ProjectFunnelDrillDownDeal,
  ProjectFunnelDrillDown,
  ProjectFunnelStageGroup,
  ProjectMonthlyActivity,
} from "@/lib/project-funnel-aggregation";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";

/** Compute months lookback for a given timeframe key */
function resolveMonths(key: string): number {
  const now = new Date();
  const thisMonth = now.getMonth(); // 0-based
  switch (key) {
    case "this-month":
      return 1;
    case "this-quarter": {
      const qStart = Math.floor(thisMonth / 3) * 3; // 0, 3, 6, 9
      return thisMonth - qStart + 1;
    }
    case "this-year":
      return thisMonth + 1;
    case "last-year":
      return thisMonth + 13; // current partial year + full prior year
    case "ytd-vs-last":
      return thisMonth + 13;
    default:
      return parseInt(key) || 6;
  }
}

const TIMEFRAMES = [
  { label: "This Month", value: "this-month" },
  { label: "This Quarter", value: "this-quarter" },
  { label: `This Year (${new Date().getFullYear()})`, value: "this-year" },
  { label: `Last Year (${new Date().getFullYear() - 1})`, value: "last-year" },
  { label: "1 month", value: "1" },
  { label: "3 months", value: "3" },
  { label: "6 months", value: "6" },
  { label: "9 months", value: "9" },
  { label: "12 months", value: "12" },
  { label: "18 months", value: "18" },
  { label: "24 months", value: "24" },
] as const;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(month: string, includeYear = true): string {
  const [y, m] = month.split("-");
  return includeYear ? `${MONTH_NAMES[parseInt(m) - 1]} ${y}` : `${MONTH_NAMES[parseInt(m) - 1]} ${y.slice(2)}`;
}

interface StageConfig {
  key: ProjectFunnelStageKey;
  label: string;
  color: string;
  textColor: string;
}

const STAGE_CONFIG: StageConfig[] = [
  // Pre-construction
  { key: "salesClosed", label: "Sales Closed", color: "bg-orange-500", textColor: "text-orange-400" },
  { key: "surveyScheduled", label: "Survey Scheduled", color: "bg-amber-500", textColor: "text-amber-400" },
  { key: "surveyDone", label: "Survey Done", color: "bg-yellow-500", textColor: "text-yellow-400" },
  { key: "daSent", label: "DA Sent", color: "bg-lime-500", textColor: "text-lime-400" },
  // Design & permitting
  { key: "daApproved", label: "DA Approved", color: "bg-blue-500", textColor: "text-blue-400" },
  { key: "designCompleted", label: "Design Complete", color: "bg-indigo-500", textColor: "text-indigo-400" },
  { key: "permitsSubmitted", label: "Permits Submitted", color: "bg-purple-500", textColor: "text-purple-400" },
  { key: "permitsIssued", label: "Permits Issued", color: "bg-violet-500", textColor: "text-violet-400" },
  // Construction & closeout
  { key: "constructionScheduled", label: "Construction Sched.", color: "bg-cyan-500", textColor: "text-cyan-400" },
  { key: "constructionComplete", label: "Construction Complete", color: "bg-green-500", textColor: "text-green-400" },
  { key: "inspectionPassed", label: "Inspection Passed", color: "bg-emerald-500", textColor: "text-emerald-400" },
  { key: "ptoGranted", label: "PTO Granted", color: "bg-teal-500", textColor: "text-teal-400" },
];

const MEDIAN_KEYS: Array<{
  key: keyof ProjectFunnelResponse["medianDays"];
}> = [
  { key: "closedToSurveyScheduled" },
  { key: "surveyScheduledToComplete" },
  { key: "surveyToDaSent" },
  { key: "daSentToApproved" },
  { key: "approvedToDesignComplete" },
  { key: "designCompleteToPermitSubmit" },
  { key: "permitSubmitToIssued" },
  { key: "permitIssuedToConstructionScheduled" },
  { key: "constructionScheduledToComplete" },
  { key: "constructionCompleteToInspection" },
  { key: "inspectionToPto" },
];

export default function ProjectPipelineFunnelPage() {
  const [timeframe, setTimeframe] = useState("6");
  const [locations, setLocations] = useState<string[]>([]);

  const months = useMemo(() => resolveMonths(timeframe), [timeframe]);

  const locationOptions = useMemo(
    () => CANONICAL_LOCATIONS.map((loc) => ({ value: loc, label: loc })),
    []
  );

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery<ProjectFunnelResponse>({
    queryKey: queryKeys.funnel.projectPipeline(months, locations),
    queryFn: async () => {
      const params = new URLSearchParams({ months: String(months) });
      if (locations.length > 0) params.set("locations", locations.join(","));
      const res = await fetch(`/api/deals/project-funnel?${params}`);
      if (!res.ok) throw new Error("Failed to fetch project funnel data");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  useSSE(() => refetch(), { cacheKeyFilter: "funnel" });

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : null;

  if (error) {
    return (
      <DashboardShell title="Project Pipeline Funnel" accentColor="cyan">
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      </DashboardShell>
    );
  }

  const s = data?.summary;

  return (
    <DashboardShell
      title="Project Pipeline Funnel"
      accentColor="cyan"
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
          accentColor="cyan"
        />
        <div className="flex items-center gap-2">
          <label htmlFor="timeframe" className="text-xs text-muted font-medium">Timeframe</label>
          <select
            id="timeframe"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
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
          {/* Pre-construction: Sales → DA Sent (4) */}
          <HeroCards summary={s} stages={STAGE_CONFIG.slice(0, 4)} />
          {/* Design & Permitting: DA Approved → Permits Issued (4) */}
          <HeroCards summary={s} stages={STAGE_CONFIG.slice(4, 8)} />
          {/* Construction & Closeout: Construction Sched → PTO Granted (4) */}
          <HeroCards summary={s} stages={STAGE_CONFIG.slice(8)} />

          {/* Backlog */}
          <BacklogSection summary={s} drillDown={data.drillDown} />

          {/* Funnel bars */}
          <FunnelBars summary={s} medianDays={data.medianDays} />

          {/* Cohort chart + table */}
          <MonthlyFunnelChart cohorts={data.cohorts} />
          <CohortTable cohorts={data.cohorts} />

          {/* Monthly activity — milestones by the month they happened */}
          <div className="mt-6">
            <MonthlyActivityTable activity={data.monthlyActivity} />
          </div>

          {/* Stage distribution */}
          <div className="mt-6">
            <StageDistribution
              stages={data.stageDistribution}
              totalDeals={s.salesClosed.count + s.salesClosed.cancelledCount}
            />
          </div>
        </>
      )}
    </DashboardShell>
  );
}

function total(d: ProjectFunnelStageData) {
  return d.count + d.cancelledCount;
}

function HeroCards({
  summary,
  stages,
}: {
  summary: ProjectFunnelResponse["summary"];
  stages: StageConfig[];
}) {
  const closedTotal = total(summary.salesClosed);

  return (
    <div className="grid gap-4 mb-4 grid-cols-2 lg:grid-cols-4">
      {stages.map((stage, i) => {
        const d = summary[stage.key];
        const stageTotal = total(d);
        const prevKey = i > 0 ? stages[i - 1].key : null;
        const prevTotal = prevKey ? total(summary[prevKey]) : closedTotal;
        const convPct = prevTotal > 0 ? Math.round((stageTotal / prevTotal) * 100) : 0;

        const cancelNote = d.cancelledCount > 0
          ? ` · ${d.cancelledCount} cancelled (${formatCurrencyCompact(d.cancelledAmount)})`
          : "";

        const subtitle = stage.key === "salesClosed"
          ? `${formatCurrencyCompact(d.amount + d.cancelledAmount)}${cancelNote}`
          : `${formatCurrencyCompact(d.amount + d.cancelledAmount)} · ${convPct}% conv.${cancelNote}`;

        return (
          <StatCard
            key={stage.key}
            label={stage.label}
            value={stageTotal}
            subtitle={subtitle}
            color={stage.color.replace("bg-", "").replace("-500", "") as "orange"}
          />
        );
      })}
    </div>
  );
}

function BacklogSection({
  summary,
  drillDown,
}: {
  summary: ProjectFunnelResponse["summary"];
  drillDown: ProjectFunnelDrillDown;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const backlogs: Array<{
    key: string;
    label: string;
    count: number;
    color: string;
    deals: ProjectFunnelDrillDownDeal[];
  }> = [
    { key: "awaitingSurveySchedule", label: "Awaiting Survey Sched.", count: summary.salesClosed.count - summary.surveyScheduled.count, color: "bg-orange-500", deals: drillDown.awaitingSurveySchedule },
    { key: "awaitingSurvey", label: "Awaiting Survey Complete", count: summary.surveyScheduled.count - summary.surveyDone.count, color: "bg-amber-500", deals: drillDown.awaitingSurvey },
    { key: "awaitingDaSend", label: "Awaiting DA Send", count: summary.surveyDone.count - summary.daSent.count, color: "bg-lime-500", deals: drillDown.awaitingDaSend },
    { key: "awaitingApproval", label: "Awaiting DA Approval", count: summary.daSent.count - summary.daApproved.count, color: "bg-blue-500", deals: drillDown.awaitingApproval },
    { key: "awaitingDesignComplete", label: "Awaiting Design Complete", count: summary.daApproved.count - summary.designCompleted.count, color: "bg-indigo-500", deals: drillDown.awaitingDesignComplete },
    { key: "awaitingPermitSubmit", label: "Awaiting Permit Submit", count: summary.designCompleted.count - summary.permitsSubmitted.count, color: "bg-purple-500", deals: drillDown.awaitingPermitSubmit },
    { key: "awaitingPermitIssue", label: "Awaiting Permit Issue", count: summary.permitsSubmitted.count - summary.permitsIssued.count, color: "bg-violet-500", deals: drillDown.awaitingPermitIssue },
    { key: "awaitingConstructionSchedule", label: "Awaiting Constr. Sched.", count: summary.permitsIssued.count - summary.constructionScheduled.count, color: "bg-cyan-500", deals: drillDown.awaitingConstructionSchedule },
    { key: "awaitingConstructionComplete", label: "Awaiting Constr. Complete", count: summary.constructionScheduled.count - summary.constructionComplete.count, color: "bg-green-500", deals: drillDown.awaitingConstructionComplete },
    { key: "awaitingInspection", label: "Awaiting Inspection", count: summary.constructionComplete.count - summary.inspectionPassed.count, color: "bg-emerald-500", deals: drillDown.awaitingInspection },
    { key: "awaitingPto", label: "Awaiting PTO", count: summary.inspectionPassed.count - summary.ptoGranted.count, color: "bg-teal-500", deals: drillDown.awaitingPto },
  ];

  const maxBacklog = Math.max(1, ...backlogs.map((b) => b.count));

  function toggle(key: string) {
    setExpanded((prev) => (prev === key ? null : key));
  }

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <h3 className="text-sm font-semibold text-foreground/80 mb-4">
        Pipeline Backlog
      </h3>
      <div className="space-y-1">
        {backlogs.map((b) => (
          <div key={b.key}>
            <button
              type="button"
              className="flex items-center gap-3 w-full py-1.5 rounded-md hover:bg-surface-2/50 transition-colors cursor-pointer"
              onClick={() => b.count > 0 && toggle(b.key)}
              disabled={b.count <= 0}
            >
              <span className="w-44 text-xs text-muted text-right shrink-0 flex items-center justify-end gap-1">
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
      </div>
    </div>
  );
}

function DrillDownTable({ deals }: { deals: ProjectFunnelDrillDownDeal[] }) {
  return (
    <div className="ml-[11.5rem] mt-1 mb-2 overflow-x-auto">
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
                  className="text-foreground hover:text-cyan-400 transition-colors"
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
  summary: ProjectFunnelResponse["summary"];
  medianDays: ProjectFunnelResponse["medianDays"];
}) {
  const maxTotal = total(summary.salesClosed) || 1;

  const conversions = STAGE_CONFIG.slice(1).map((stage, i) => {
    const prevStage = STAGE_CONFIG[i];
    const prevTotal = total(summary[prevStage.key]);
    const curTotal = total(summary[stage.key]);
    return {
      pct: prevTotal > 0 ? Math.round((curTotal / prevTotal) * 100) : 0,
      days: medianDays[MEDIAN_KEYS[i].key],
    };
  });

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <h3 className="text-sm font-semibold text-foreground/80 mb-4">
        Pipeline Throughput
      </h3>
      {STAGE_CONFIG.map((stage, i) => {
        const d = summary[stage.key];
        const active = d.count;
        const cancelled = d.cancelledCount;
        const stageTotal = active + cancelled;

        return (
          <div key={stage.key}>
            <div className="flex items-center gap-3 mb-1">
              <span className="w-36 text-xs text-muted text-right shrink-0">
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
                      {active} · {formatCurrencyCompact(d.amount)}
                    </span>
                  </div>
                  {cancelled > 0 && (
                    <div
                      className="bg-zinc-600 rounded-r-md flex items-center justify-center px-1.5 min-w-0"
                      style={{ width: `${(cancelled / stageTotal) * 100}%` }}
                      title={`${cancelled} cancelled · ${formatCurrencyCompact(d.cancelledAmount)}`}
                    >
                      <span className="text-zinc-300 text-[10px] truncate">
                        {cancelled} · {formatCurrencyCompact(d.cancelledAmount)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            {i < STAGE_CONFIG.length - 1 && (
              <div className="flex items-center gap-3 mb-2">
                <span className="w-36" />
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
          <span className="w-2.5 h-2.5 bg-cyan-500 rounded-sm" /> Active
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
  cohorts: ProjectFunnelResponse["cohorts"];
}) {
  const chronological = useMemo(() => [...cohorts].reverse(), [cohorts]);

  const maxCount = useMemo(
    () =>
      Math.max(
        1,
        ...chronological.map((c) => total(c.salesClosed))
      ),
    [chronological]
  );

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <h3 className="text-sm font-semibold text-foreground/80 mb-4">
        Monthly Cohort Trend
      </h3>
      <div className="flex items-end justify-around gap-1" style={{ height: 160 }}>
        {chronological.map((cohort) => (
          <div key={cohort.month} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <div className="flex gap-px items-end" style={{ height: 130 }}>
              {STAGE_CONFIG.map(({ key, color, label }) => {
                const d = cohort[key];
                const t = total(d);
                const heightPct = (t / maxCount) * 100;
                return (
                  <div
                    key={key}
                    className={`${color} rounded-t-sm w-1.5 lg:w-2 transition-all duration-300`}
                    style={{ height: `${Math.max(heightPct, t > 0 ? 3 : 0)}%` }}
                    title={`${label}: ${t} · ${formatCurrencyCompact(d.amount + d.cancelledAmount)}`}
                  />
                );
              })}
            </div>
            <span className="text-[9px] text-muted truncate">
              {monthLabel(cohort.month, false)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-3 text-[10px] text-muted">
        {STAGE_CONFIG.map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1">
            <span className={`w-2 h-2 ${color} rounded-sm`} /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function CohortTable({ cohorts }: { cohorts: ProjectFunnelResponse["cohorts"] }) {
  return (
    <div className="bg-surface rounded-xl border border-t-border p-5">
      <h3 className="text-sm font-semibold text-foreground/80 mb-3">
        Cohort Detail
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-t-border">
              <th className="text-left py-2 px-2 text-muted font-medium sticky left-0 bg-surface z-10">Month</th>
              {STAGE_CONFIG.map((s) => (
                <th key={s.key} className={`text-center py-2 px-1.5 font-medium ${s.textColor} whitespace-nowrap`}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort, i) => {
              const closedTotal = total(cohort.salesClosed);

              return (
                <tr
                  key={cohort.month}
                  className={`border-b border-t-border/50 ${i % 2 === 0 ? "bg-surface-2/50" : ""}`}
                >
                  <td className="py-2 px-2 font-semibold text-foreground whitespace-nowrap sticky left-0 bg-inherit z-10">
                    {monthLabel(cohort.month)}
                  </td>
                  {STAGE_CONFIG.map((stage) => {
                    const d = cohort[stage.key];
                    const t = total(d);
                    const conversionPct =
                      stage.key === "salesClosed" || closedTotal === 0
                        ? null
                        : Math.round((t / closedTotal) * 100);

                    return (
                      <td key={stage.key} className="text-center py-2 px-1.5">
                        <div className={`font-semibold ${stage.textColor}`}>
                          {t}
                        </div>
                        <div className="text-muted">
                          {formatCurrencyCompact(d.amount + d.cancelledAmount)}
                        </div>
                        {d.cancelledCount > 0 && (
                          <div className="text-zinc-500">
                            {d.cancelledCount} canc.
                          </div>
                        )}
                        {conversionPct != null && (
                          <div className={`${stage.textColor} text-[10px]`}>
                            {conversionPct}%
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ACTIVITY_COLUMNS: Array<{
  key: keyof ProjectMonthlyActivity;
  label: string;
  color: string;
  amountKey?: keyof ProjectMonthlyActivity;
}> = [
  { key: "surveysScheduled", label: "Surveys Sched.", color: "text-amber-400" },
  { key: "surveysCompleted", label: "Surveys Done", color: "text-yellow-400" },
  { key: "dasSent", label: "DAs Sent", color: "text-lime-400" },
  { key: "dasApproved", label: "DAs Approved", color: "text-blue-400", amountKey: "dasApprovedAmount" },
  { key: "designsCompleted", label: "Designs Done", color: "text-indigo-400" },
  { key: "permitsSubmitted", label: "Permits Sub.", color: "text-purple-400" },
  { key: "permitsIssued", label: "Permits Issued", color: "text-violet-400" },
  { key: "constructionsScheduled", label: "Constr. Sched.", color: "text-cyan-400" },
  { key: "constructionsComplete", label: "Constr. Done", color: "text-green-400", amountKey: "constructionsCompleteAmount" },
  { key: "inspectionsPassed", label: "Inspections", color: "text-emerald-400" },
  { key: "ptosGranted", label: "PTOs", color: "text-teal-400", amountKey: "ptosGrantedAmount" },
];

function MonthlyActivityTable({ activity }: { activity: ProjectMonthlyActivity[] }) {
  return (
    <div className="bg-surface rounded-xl border border-t-border p-5">
      <h3 className="text-sm font-semibold text-foreground/80 mb-1">
        Monthly Activity
      </h3>
      <p className="text-xs text-muted mb-4">
        Milestones by the month they happened — not when the deal closed
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-t-border">
              <th className="text-left py-2 px-2 text-muted font-medium sticky left-0 bg-surface z-10">Month</th>
              {ACTIVITY_COLUMNS.map((col) => (
                <th key={col.key} className={`text-center py-2 px-1.5 font-medium ${col.color} whitespace-nowrap`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activity.map((row, i) => (
              <tr
                key={row.month}
                className={`border-b border-t-border/50 ${i % 2 === 0 ? "bg-surface-2/50" : ""}`}
              >
                <td className="py-2 px-2 font-semibold text-foreground whitespace-nowrap sticky left-0 bg-inherit z-10">
                  {monthLabel(row.month)}
                </td>
                {ACTIVITY_COLUMNS.map((col) => {
                  const count = row[col.key] as number;
                  const amount = col.amountKey ? (row[col.amountKey] as number) : 0;
                  return (
                    <td key={col.key} className="text-center py-2 px-1.5">
                      {count > 0 ? (
                        <>
                          <div className={`font-semibold ${col.color}`}>{count}</div>
                          {col.amountKey && amount > 0 && (
                            <div className="text-muted">{formatCurrencyCompact(amount)}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted/40">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
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
  stages: ProjectFunnelStageGroup[];
  totalDeals: number;
}) {
  const maxCount = Math.max(1, ...stages.map((s) => s.count));

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
