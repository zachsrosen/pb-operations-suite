"use client";

import { Suspense, Fragment, useCallback, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
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
  ProjectFunnelStageDeal,
  MilestoneCohortResponse,
  MilestoneCohortBucket,
  ProjectFunnelCapacity,
  ProjectFunnelRtbForecast,
} from "@/lib/project-funnel-aggregation";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { resolveMonths, calendarMonthRange, monthRangeToDates } from "@/lib/dashboard-timeframe";
import { MonthlyActivityView } from "@/components/funnel/MonthlyActivityView";
import FunnelDailyTrend from "@/components/funnel/FunnelDailyTrend";
import BottleneckView from "@/components/bottlenecks/BottleneckView";

const TIMEFRAMES = [
  { label: "This Month", value: "this-month" },
  { label: "Last Month", value: "last-month" },
  { label: "This Quarter", value: "this-quarter" },
  { label: "Last Quarter", value: "last-quarter" },
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
  { key: "surveyDone", label: "Survey Complete", color: "bg-yellow-500", textColor: "text-yellow-400" },
  { key: "daSent", label: "DA Sent", color: "bg-lime-500", textColor: "text-lime-400" },
  // Design & permitting
  { key: "daApproved", label: "DA Approved", color: "bg-blue-500", textColor: "text-blue-400" },
  { key: "designCompleted", label: "Design Complete", color: "bg-indigo-500", textColor: "text-indigo-400" },
  { key: "permitsSubmitted", label: "Permits Submitted", color: "bg-purple-500", textColor: "text-purple-400" },
  { key: "permitsIssued", label: "Permits Issued", color: "bg-violet-500", textColor: "text-violet-400" },
  { key: "interconnectionApproved", label: "Interconnection Cleared", color: "bg-fuchsia-500", textColor: "text-fuchsia-400" },
  { key: "readyToBuild", label: "Ready to Build", color: "bg-cyan-600", textColor: "text-cyan-300" },
  // Construction & closeout
  { key: "constructionScheduled", label: "Construction Scheduled", color: "bg-cyan-500", textColor: "text-cyan-400" },
  { key: "constructionComplete", label: "Construction Complete", color: "bg-green-500", textColor: "text-green-400" },
  { key: "inspectionPassed", label: "Inspection Passed", color: "bg-emerald-500", textColor: "text-emerald-400" },
  { key: "ptoGranted", label: "PTO Granted", color: "bg-teal-500", textColor: "text-teal-400" },
];

function ProjectPipelineFunnelInner() {
  // The URL query string is the source of truth for filters, so views are
  // shareable and reload-safe.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const timeframe = searchParams.get("tf") || "6";
  const locations = useMemo(() => (searchParams.get("loc") || "").split(",").filter(Boolean), [searchParams]);
  const pms = useMemo(() => (searchParams.get("pm") || "").split(",").filter(Boolean), [searchParams]);
  const owners = useMemo(() => (searchParams.get("own") || "").split(",").filter(Boolean), [searchParams]);

  const setParam = useCallback(
    (key: string, value: string | string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      const v = Array.isArray(value) ? value.join(",") : value;
      if (v) params.set(key, v);
      else params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname]
  );
  const setTimeframe = useCallback((v: string) => setParam("tf", v === "6" ? "" : v), [setParam]);
  const setLocations = useCallback((v: string[]) => setParam("loc", v), [setParam]);
  const setPms = useCallback((v: string[]) => setParam("pm", v), [setParam]);
  const setOwners = useCallback((v: string[]) => setParam("own", v), [setParam]);
  const peParam = searchParams.get("pe");
  const pe: "all" | "pe" | "non-pe" = peParam === "pe" || peParam === "non-pe" ? peParam : "all";
  const includeOnHold = searchParams.get("oh") !== "0";
  const includeRejected = searchParams.get("pr") !== "0";
  const includeCancelled = searchParams.get("cx") !== "0";
  const heroView: "cards" | "loc" = searchParams.get("hv") === "loc" ? "loc" : "cards";
  const setHeroView = useCallback((v: "cards" | "loc") => setParam("hv", v === "loc" ? "loc" : ""), [setParam]);
  const tabParam = searchParams.get("tab");
  const tab: "funnel" | "sales-funnel" | "bottlenecks" | "activity" | "cohorts" | "incoming" =
    tabParam === "activity" ? "activity"
      : tabParam === "cohorts" ? "cohorts"
      : tabParam === "bottlenecks" ? "bottlenecks"
      : tabParam === "incoming" ? "incoming"
      : tabParam === "sales-funnel" ? "sales-funnel"
      : "funnel";
  const setTab = useCallback(
    (v: "funnel" | "sales-funnel" | "bottlenecks" | "activity" | "cohorts" | "incoming") => setParam("tab", v === "funnel" ? "" : v),
    [setParam]
  );
  // The Funnel tab + Bottlenecks are the live active-pipeline snapshot (no date
  // window). Sales Funnel, Analysis, and Monthly Activity are time-based: Sales
  // Funnel is the same hero/backlog but windowed by close date (sales cohort).
  const useActiveScope = tab === "funnel" || tab === "incoming";
  // Funnel and Sales Funnel both render the stage-funnel hero + backlog.
  const isFunnelView = tab === "funnel" || tab === "sales-funnel";
  // The Bottlenecks tab self-fetches its own data, so skip the page-level query.
  const mainQueryEnabled = tab !== "bottlenecks";

  // Which backlog row is expanded — lifted so the hero connectors can open one.
  const [expandedBacklog, setExpandedBacklog] = useState<string | null>(null);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const openBacklog = useCallback((backlogKey: string) => {
    setExpandedBacklog(backlogKey);
    setTimeout(() => {
      document.getElementById(`backlog-${backlogKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }, []);
  const handleConvClick = useCallback(
    (stageKey: ProjectFunnelStageKey) => {
      const bk = STAGE_TO_BACKLOG[stageKey];
      if (bk) openBacklog(bk);
    },
    [openBacklog]
  );

  const months = useMemo(() => resolveMonths(timeframe), [timeframe]);

  const locationOptions = useMemo(
    () => CANONICAL_LOCATIONS.map((loc) => ({ value: loc, label: loc })),
    []
  );

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery<ProjectFunnelResponse>({
    queryKey: [...queryKeys.funnel.projectPipeline(months, locations, useActiveScope ? "active" : timeframe, pms, owners), pe, includeOnHold, includeRejected, includeCancelled],
    queryFn: async () => {
      const params = new URLSearchParams({ months: String(months) });
      if (locations.length > 0) params.set("locations", locations.join(","));
      if (pms.length > 0) params.set("pms", pms.join(","));
      if (owners.length > 0) params.set("owners", owners.join(","));
      if (pe !== "all") params.set("pe", pe);
      if (!includeOnHold) params.set("onhold", "0");
      if (!includeRejected) params.set("rejected", "0");
      if (!includeCancelled) params.set("cancelled", "0");
      if (useActiveScope) {
        // Funnel tab: live snapshot of all active deals, no date window.
        params.set("scope", "active");
      } else {
        // Cohorts / Monthly Activity tabs are time-based. Calendar timeframes
        // (This Year, Last Year, …) pass exact month bounds so the server
        // clamps to real calendar boundaries instead of N-months-back.
        const range = calendarMonthRange(timeframe);
        if (range) {
          const dates = monthRangeToDates(range);
          params.set("start", dates.start);
          params.set("end", dates.end);
        }
      }
      const res = await fetch(`/api/deals/project-funnel?${params}`);
      if (!res.ok) throw new Error("Failed to fetch project funnel data");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
    enabled: mainQueryEnabled,
  });

  const pmOptions = useMemo(
    () => (data?.filterOptions?.projectManagers ?? []).map((v) => ({ value: v, label: v })),
    [data]
  );
  const ownerOptions = useMemo(
    () => (data?.filterOptions?.dealOwners ?? []).map((v) => ({ value: v, label: v })),
    [data]
  );

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
      title="Project Pipeline"
      accentColor="cyan"
      fullWidth
      lastUpdated={lastUpdated}
    >
      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-t-border">
        {([
          { key: "funnel", label: "Active Pipeline" },
          { key: "bottlenecks", label: "Bottlenecks" },
          { key: "sales-funnel", label: "Sales Funnel" },
          { key: "incoming", label: "Incoming" },
          { key: "activity", label: "Monthly Throughput" },
          // Analysis hidden for now (still reachable via ?tab=cohorts);
          // re-add { key: "cohorts", label: "Analysis" } to restore.
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.key
                ? "border-cyan-500 text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters (shared across tabs) */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={locations}
          onChange={setLocations}
          placeholder="All Locations"
          accentColor="cyan"
        />
        <MultiSelectFilter
          label="PM"
          options={pmOptions}
          selected={pms}
          onChange={setPms}
          placeholder="All PMs"
          accentColor="cyan"
        />
        <MultiSelectFilter
          label="Owner"
          options={ownerOptions}
          selected={owners}
          onChange={setOwners}
          placeholder="All Owners"
          accentColor="cyan"
        />
        {/* Participate Energy filter */}
        <div className="inline-flex rounded-lg border border-t-border overflow-hidden text-xs">
          {PE_OPTIONS.map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setParam("pe", o.v === "all" ? "" : o.v)}
              className={`px-2.5 py-1.5 transition-colors ${pe === o.v ? "bg-cyan-500 text-white" : "bg-surface text-muted hover:text-foreground"}`}
              title="Filter by Participate Energy"
            >
              {o.label}
            </button>
          ))}
        </div>
        {/* On-hold toggle */}
        <button
          type="button"
          onClick={() => setParam("oh", includeOnHold ? "0" : "")}
          className={`px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${includeOnHold ? "border-t-border bg-surface text-muted hover:text-foreground" : "border-yellow-500/40 bg-yellow-500/10 text-yellow-300"}`}
          title={includeOnHold ? "On-hold deals included — click to hide" : "On-hold deals hidden — click to show"}
        >
          {includeOnHold ? "On Hold: shown" : "On Hold: hidden"}
        </button>
        {/* Project-rejected toggle */}
        <button
          type="button"
          onClick={() => setParam("pr", includeRejected ? "0" : "")}
          className={`px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${includeRejected ? "border-t-border bg-surface text-muted hover:text-foreground" : "border-red-500/40 bg-red-500/10 text-red-300"}`}
          title={includeRejected ? "Project-rejected deals included — click to hide" : "Project-rejected deals hidden — click to show"}
        >
          {includeRejected ? "Rejected: shown" : "Rejected: hidden"}
        </button>
        {/* Cancelled toggle */}
        <button
          type="button"
          onClick={() => setParam("cx", includeCancelled ? "0" : "")}
          className={`px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${includeCancelled ? "border-t-border bg-surface text-muted hover:text-foreground" : "border-zinc-500/40 bg-zinc-500/10 text-zinc-300"}`}
          title={includeCancelled ? "Cancelled deals included — click to hide" : "Cancelled deals hidden — click to show"}
        >
          {includeCancelled ? "Cancelled: shown" : "Cancelled: hidden"}
        </button>
        {tab === "funnel" || tab === "bottlenecks" || tab === "incoming" ? (
          <span className="text-xs text-muted font-medium px-1">
            Live snapshot · all active deals
          </span>
        ) : (
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
        )}
        {isFunnelView && (
          <div className="flex rounded-lg border border-t-border overflow-hidden text-xs ml-auto">
            <button
              type="button"
              onClick={() => setHeroView("cards")}
              className={`px-3 py-1.5 transition-colors ${heroView === "cards" ? "bg-cyan-500 text-white" : "bg-surface text-muted hover:text-foreground"}`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => setHeroView("loc")}
              className={`px-3 py-1.5 transition-colors ${heroView === "loc" ? "bg-cyan-500 text-white" : "bg-surface text-muted hover:text-foreground"}`}
            >
              By location
            </button>
          </div>
        )}
      </div>

      {tab === "bottlenecks" ? (
        /* Self-fetches the live pipeline — independent of the page query. */
        <BottleneckView />
      ) : isLoading || !data || !s ? (
        <LoadingSpinner />
      ) : tab === "activity" ? (
        <>
          <FunnelDailyTrend />
          <MonthlyActivityView data={data} timeframe={timeframe} locations={locations} pms={pms} owners={owners} />
        </>
      ) : tab === "incoming" ? (
        <>
          {data.capacity && <CapacityRow capacity={data.capacity} />}
          {data.rtbForecast && <RtbForecastSection forecast={data.rtbForecast} />}
          <IncomingView data={data} />
        </>
      ) : tab === "cohorts" ? (
        <>
          <MonthlyFunnelChart cohorts={data.cohorts} />
          <RevenueConversionTable cohorts={data.cohorts} />
          <CohortTable cohorts={data.cohorts} />
          <MilestoneCohortSection locations={locations} pms={pms} owners={owners} />
        </>
      ) : (
        <>
          {/* Funnel tab = active snapshot (cancelled always 0 → hidden, no prior-
              period trend). Sales Funnel = the same hero windowed by close date
              (sales cohort), so it shows cancelled + trend vs the prior window. */}
          {heroView === "loc" ? (
            <HeroLocationMatrix summaryByLocation={data.summaryByLocation} totalSummary={s} hideCancelled={tab === "funnel"} />
          ) : (
            <>
              <div className="flex justify-end mb-2">
                <ConversionLegend hideCancelled={tab === "funnel"} />
              </div>
              {/* Sales Closed → Permits Issued (7) */}
              <HeroCards summary={s} stages={STAGE_CONFIG.slice(0, 7)} hideCancelled={tab === "funnel"} previousSummary={tab === "funnel" ? undefined : data.previousSummary} onConvClick={handleConvClick} />
              {/* Interconnection Approved → PTO Granted (7) */}
              <HeroCards summary={s} stages={STAGE_CONFIG.slice(7)} hideCancelled={tab === "funnel"} previousSummary={tab === "funnel" ? undefined : data.previousSummary} onConvClick={handleConvClick} />
            </>
          )}

          {/* Backlog */}
          <BacklogSection summary={s} drillDown={data.drillDown} medianDays={data.medianDays} expanded={expandedBacklog} onToggle={setExpandedBacklog} />

          {/* Current pipeline position */}
          <div className="mt-6">
            <StageDistribution
              stages={data.stageDistribution}
              totalDeals={s.salesClosed.count + s.salesClosed.cancelledCount}
              expanded={expandedStage}
              onToggle={setExpandedStage}
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

/**
 * Shares for the transition INTO stage index `i`, all relative to everything
 * that reached the prior stage (active + cancelled):
 *   conv     — advanced to this stage (active)
 *   cancelled — reached this stage but has since cancelled
 *   onHold   — reached the prior stage, then parked On Hold before advancing
 *   pending  — reached the prior stage but none of the above (still actively stuck)
 * The four sum to 100%. on-hold is a split of what would otherwise be "pending"
 * (on-hold deals stay counted as active, so the counts still reconcile).
 * Returns null for Sales Closed (no prior) or empty prior.
 */
function transitionStats(
  row: Record<ProjectFunnelStageKey, ProjectFunnelStageData>,
  i: number
): { conv: number; cancelled: number; onHold: number; pending: number } | null {
  if (i === 0) return null;
  const prev = row[STAGE_CONFIG[i - 1].key];
  const prevReached = total(prev);
  if (prevReached === 0) return null;
  const cur = row[STAGE_CONFIG[i].key];
  const conv = Math.round((cur.count / prevReached) * 100);
  const cancelled = Math.min(Math.round((cur.cancelledCount / prevReached) * 100), 100 - conv);
  // On-hold deals stuck at this gate = reached prior but not this stage, and on hold.
  const onHoldStuck = Math.max(0, prev.onHoldCount - cur.onHoldCount);
  const onHold = Math.min(Math.round((onHoldStuck / prevReached) * 100), 100 - conv - cancelled);
  const pending = Math.max(0, 100 - conv - cancelled - onHold);
  return { conv, cancelled, onHold, pending };
}

type ConvStats = { conv: number; cancelled: number; onHold: number; pending: number };

/** Compact colored conversion numbers: green conv · red cancelled · yellow on-hold · gray pending. */
function ConvNumbers({
  stats,
  hideCancelled,
}: {
  stats: ConvStats;
  hideCancelled?: boolean;
}) {
  return (
    <span className="font-semibold tabular-nums whitespace-nowrap">
      <span className="text-emerald-400">{stats.conv}%</span>
      {!hideCancelled && (
        <>
          <span className="text-muted/40"> · </span>
          <span className="text-red-400/80">{stats.cancelled}%</span>
        </>
      )}
      {stats.onHold > 0 && (
        <>
          <span className="text-muted/40"> · </span>
          <span className="text-yellow-400/80">{stats.onHold}%</span>
        </>
      )}
      <span className="text-muted/40"> · </span>
      <span className="text-zinc-400">{stats.pending}%</span>
    </span>
  );
}

/** Legend explaining the conversion arrow colors (the numbers are % of prior stage). */
function ConversionLegend({ className = "", hideCancelled }: { className?: string; hideCancelled?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 text-[11px] text-muted ${className}`}>
      <span className="text-muted/70">→ % of prior stage:</span>
      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" />converted</span>
      {!hideCancelled && (
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400/80" />cancelled</span>
      )}
      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400/80" />on hold</span>
      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-400" />pending</span>
    </div>
  );
}

/** Arrow connector with the compact colored numbers, used between cards. */
function ConvConnector({
  stats,
  hideCancelled,
  onClick,
  title,
}: {
  stats: ConvStats | null;
  hideCancelled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const inner = (
    <>
      <span className="text-muted/50 text-sm leading-none">→</span>
      {stats && <span className="text-[10px] mt-1"><ConvNumbers stats={stats} hideCancelled={hideCancelled} /></span>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="shrink-0 flex flex-col items-center justify-center px-1.5 self-center rounded-md hover:bg-surface-2 transition-colors cursor-pointer"
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="shrink-0 flex flex-col items-center justify-center px-1 self-center">
      {inner}
    </div>
  );
}

const PE_OPTIONS = [
  { v: "all", label: "All" },
  { v: "pe", label: "PE" },
  { v: "non-pe", label: "Non-PE" },
] as const;

/** Each backlog bucket → the median-leg-time key that benchmarks "how long this stage takes". */
// Median leg(s) that benchmark how long each bucket should take. Most buckets
// anchor "days waiting" on the prior milestone date, so a single leg matches.
// Awaiting Survey Complete anchors on the CLOSE date (its survey may be future-
// dated), so its benchmark is cumulative: close→scheduled + scheduled→complete.
const BACKLOG_LEG: Record<string, Array<keyof ProjectFunnelResponse["medianDays"]>> = {
  awaitingSurveySchedule: ["closedToSurveyScheduled"],
  awaitingSurvey: ["closedToSurveyScheduled", "surveyScheduledToComplete"],
  awaitingDaSend: ["surveyToDaSent"],
  awaitingApproval: ["daSentToApproved"],
  awaitingDesignComplete: ["approvedToDesignComplete"],
  awaitingPermitSubmit: ["designCompleteToPermitSubmit"],
  awaitingPermitIssue: ["permitSubmitToIssued"],
  awaitingInterconnection: ["permitIssuedToReadyToBuild"],
  awaitingReadyToBuild: ["permitIssuedToReadyToBuild"],
  awaitingConstructionSchedule: ["readyToBuildToConstructionScheduled"],
  awaitingConstructionComplete: ["constructionScheduledToComplete"],
  awaitingInspection: ["constructionCompleteToInspection"],
  awaitingPto: ["inspectionToPto"],
};

/** Sum of the bucket's benchmark legs (null if no median data). */
function backlogBenchmark(bucketKey: string, medianDays: ProjectFunnelResponse["medianDays"]): number | null {
  const legs = BACKLOG_LEG[bucketKey];
  if (!legs) return null;
  const vals = legs.map((k) => medianDays[k]).filter((v): v is number => v != null);
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null;
}

/**
 * A deal is "late" if it's waited past its stage benchmark — but NOT if it has a
 * future scheduled date (survey/construction booked ahead = an appointment, not
 * overdue) or is parked (on hold).
 */
function isDealLate(d: ProjectFunnelDrillDownDeal, benchmark: number | null): boolean {
  if (benchmark == null || d.flag?.parked) return false;
  const todayIso = new Date().toISOString().slice(0, 10);
  if (d.scheduledDate && d.scheduledDate > todayIso) return false; // upcoming appointment
  return d.daysWaiting > benchmark;
}

/** Each between-card connector maps to the backlog of deals stuck at that transition. */
const STAGE_TO_BACKLOG: Partial<Record<ProjectFunnelStageKey, string>> = {
  surveyScheduled: "awaitingSurveySchedule",
  surveyDone: "awaitingSurvey",
  daSent: "awaitingDaSend",
  daApproved: "awaitingApproval",
  designCompleted: "awaitingDesignComplete",
  permitsSubmitted: "awaitingPermitSubmit",
  permitsIssued: "awaitingPermitIssue",
  interconnectionApproved: "awaitingInterconnection",
  readyToBuild: "awaitingReadyToBuild",
  constructionScheduled: "awaitingConstructionSchedule",
  constructionComplete: "awaitingConstructionComplete",
  inspectionPassed: "awaitingInspection",
  ptoGranted: "awaitingPto",
};

/**
 * Per-stage gradient/border keyed by the stage's own color — covers amber /
 * lime / violet, which the shared StatCard's accent map lacks (those silently
 * fell back to blue). Tighter than StatCard so 12 cards don't read as empty.
 */
const FUNNEL_CARD_STYLES: Record<string, string> = {
  "bg-orange-500": "from-orange-500/20 border-orange-500/30",
  "bg-amber-500": "from-amber-500/20 border-amber-500/30",
  "bg-yellow-500": "from-yellow-500/20 border-yellow-500/30",
  "bg-lime-500": "from-lime-500/20 border-lime-500/30",
  "bg-blue-500": "from-blue-500/20 border-blue-500/30",
  "bg-indigo-500": "from-indigo-500/20 border-indigo-500/30",
  "bg-purple-500": "from-purple-500/20 border-purple-500/30",
  "bg-violet-500": "from-violet-500/20 border-violet-500/30",
  "bg-cyan-500": "from-cyan-500/20 border-cyan-500/30",
  "bg-green-500": "from-green-500/20 border-green-500/30",
  "bg-emerald-500": "from-emerald-500/20 border-emerald-500/30",
  "bg-teal-500": "from-teal-500/20 border-teal-500/30",
};

function FunnelStatCard({
  stage,
  value,
  subtitle,
  trend,
}: {
  stage: StageConfig;
  value: number;
  subtitle: string;
  trend?: { delta: number; label: string } | null;
}) {
  const style = FUNNEL_CARD_STYLES[stage.color] || FUNNEL_CARD_STYLES["bg-blue-500"];
  return (
    <div className={`relative h-full bg-gradient-to-br ${style} to-transparent border rounded-lg px-3 py-2`}>
      <div className="flex items-baseline gap-1.5">
        <span
          key={String(value)}
          className="text-xl xl:text-2xl font-bold text-foreground tracking-tight tabular-nums animate-value-flash leading-none"
        >
          {value}
        </span>
        {trend && (
          <span
            className={`text-[10px] font-medium ${trend.delta > 0 ? "text-green-400" : trend.delta < 0 ? "text-red-400" : "text-muted"}`}
          >
            {trend.delta > 0 ? "▲" : trend.delta < 0 ? "▼" : "—"}{trend.delta > 0 ? "+" : ""}{trend.delta}
          </span>
        )}
      </div>
      <div className={`text-[11px] font-semibold mt-1 leading-tight ${stage.textColor}`}>{stage.label}</div>
      {subtitle && <div className="text-[10px] text-muted leading-tight truncate" title={subtitle}>{subtitle}</div>}
    </div>
  );
}

function HeroCards({
  summary,
  previousSummary,
  stages,
  hideCancelled,
  onConvClick,
}: {
  summary: ProjectFunnelResponse["summary"];
  previousSummary?: ProjectFunnelResponse["previousSummary"];
  stages: StageConfig[];
  hideCancelled?: boolean;
  /** Click a between-card connector to open the matching backlog. */
  onConvClick?: (stageKey: ProjectFunnelStageKey) => void;
}) {
  // Horizontal flow with arrow connectors between cards; scrolls on small
  // screens. conv/cancelled/pending live in the connector now (see legend),
  // not in the card subtitle — keeps cards clean.
  return (
    <div className="flex items-stretch gap-2 mb-2 overflow-x-auto pb-1">
      {stages.map((stage) => {
        const d = summary[stage.key];
        const stageTotal = total(d);
        // Conversion chains across the full funnel order, not the local row
        // slice. The connector before each card shows the transition INTO it,
        // so cross-row transitions stay visible at the start of later rows.
        const globalIdx = STAGE_CONFIG.findIndex((c) => c.key === stage.key);
        const ts = transitionStats(summary, globalIdx);

        const cancelRaw = d.cancelledCount > 0
          ? `${d.cancelledCount} cancelled (${formatCurrencyCompact(d.cancelledAmount)})`
          : "";
        const amountStr = formatCurrencyCompact(d.amount + d.cancelledAmount);
        const subtitle = stage.key === "salesClosed"
          ? [amountStr, cancelRaw].filter(Boolean).join(" · ")
          : amountStr;

        // Trend vs the prior equal-length period (total reaching this stage).
        const trend = previousSummary
          ? { delta: stageTotal - total(previousSummary[stage.key]), label: "vs prior" }
          : null;

        return (
          <Fragment key={stage.key}>
            {globalIdx > 0 && (
              <ConvConnector
                stats={ts}
                hideCancelled={hideCancelled}
                onClick={onConvClick && STAGE_TO_BACKLOG[stage.key] ? () => onConvClick(stage.key) : undefined}
                title={STAGE_TO_BACKLOG[stage.key] ? `Open backlog: pending ${stage.label}` : undefined}
              />
            )}
            <div className="flex-1 min-w-[120px]">
              <FunnelStatCard stage={stage} value={stageTotal} subtitle={subtitle} trend={trend} />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function sortLocationKeys(keys: string[]): string[] {
  const order = new Map<string, number>(CANONICAL_LOCATIONS.map((l, i) => [l, i]));
  return [...keys].sort(
    (a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b)
  );
}

/** Hero "By location" matrix — rows = PB locations, cols = funnel stages. */
function HeroLocationMatrix({
  summaryByLocation,
  totalSummary,
  hideCancelled,
}: {
  summaryByLocation: ProjectFunnelResponse["summaryByLocation"];
  totalSummary: ProjectFunnelResponse["summary"];
  hideCancelled?: boolean;
}) {
  // Every deal should carry a PB location; drop the "Unknown" catch-all column.
  const locs = sortLocationKeys(Object.keys(summaryByLocation).filter((k) => k !== "Unknown"));
  const showTotal = locs.length > 1;

  // Transposed: milestones run down the rows, PB locations across the columns
  // (+ a Total column). With only a handful of locations this avoids the wide
  // horizontal scroll the stage-columns layout required.
  const columns: Array<{
    key: string;
    label: string;
    row: Record<ProjectFunnelStageKey, ProjectFunnelStageData>;
    isTotal?: boolean;
  }> = [
    ...locs.map((loc) => ({ key: loc, label: loc, row: summaryByLocation[loc] })),
    ...(showTotal ? [{ key: "__total", label: "Total", row: totalSummary, isTotal: true }] : []),
  ];

  const cell = (d: ProjectFunnelStageData) => {
    const t = total(d);
    return t > 0 ? (
      <>
        <div className="font-semibold">{t}</div>
        <div className="text-muted">{formatCurrencyCompact(d.amount + d.cancelledAmount)}</div>
      </>
    ) : (
      <span className="text-muted/40">—</span>
    );
  };

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6 overflow-x-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h3 className="text-sm font-semibold text-foreground/80">Stage Counts by Location</h3>
        <ConversionLegend hideCancelled={hideCancelled} />
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-t-border">
            <th className="text-left py-2 px-2 text-muted font-medium sticky left-0 bg-surface z-10">Milestone</th>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`text-center py-2 px-2 font-medium whitespace-nowrap ${c.isTotal ? "text-foreground" : "text-muted"}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STAGE_CONFIG.map((stage, si) => (
            <Fragment key={stage.key}>
              {/* Conversion row: transition INTO this stage, per column. */}
              {si > 0 && (
                <tr className="text-[10px]">
                  <td className="py-0.5 px-2 text-right text-muted/40 sticky left-0 bg-surface z-10" aria-hidden>↓</td>
                  {columns.map((c) => {
                    const ts = transitionStats(c.row, si);
                    return (
                      <td key={c.key} className="text-center py-0.5 px-2 whitespace-nowrap">
                        {ts ? <ConvNumbers stats={ts} hideCancelled={hideCancelled} /> : <span className="text-muted/30">·</span>}
                      </td>
                    );
                  })}
                </tr>
              )}
              <tr className="border-b border-t-border/50">
                <td className={`py-2 px-2 font-semibold whitespace-nowrap sticky left-0 bg-surface z-10 ${stage.textColor}`}>
                  {stage.label}
                </td>
                {columns.map((c) => (
                  <td key={c.key} className={`text-center py-2 px-2 ${c.isTotal ? "font-semibold" : ""}`}>
                    {cell(c.row[stage.key])}
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Group a backlog's deals by their status label (descending by count), with
 *  the summed deal revenue per status. */
function statusBreakdown(
  deals: ProjectFunnelDrillDownDeal[]
): Array<{ status: string; count: number; amount: number }> {
  const m = new Map<string, { count: number; amount: number }>();
  for (const d of deals) {
    const st = d.status && d.status.trim() ? d.status : "No status";
    const e = m.get(st) || { count: 0, amount: 0 };
    e.count += 1;
    e.amount += d.amount || 0;
    m.set(st, e);
  }
  return [...m.entries()]
    .map(([status, v]) => ({ status, count: v.count, amount: v.amount }))
    .sort((a, b) => b.count - a.count);
}

// Stepped opacity so stacked status segments of one backlog color stay distinct.
const segOpacity = (i: number) => Math.max(0.4, 1 - i * 0.18);

/** Tone → Tailwind classes for backlog "not actionable" flags (literal so Tailwind keeps them). */
const FLAG_PILL: Record<string, string> = {
  yellow: "bg-yellow-500/20 text-yellow-300",
  red: "bg-red-500/20 text-red-300",
  orange: "bg-orange-500/20 text-orange-300",
};
const FLAG_TEXT: Record<string, string> = {
  yellow: "text-yellow-400/80",
  red: "text-red-400/80",
  orange: "text-orange-400/80",
};

// ── Capacity & Backlog row (Active Pipeline tab) ─────────────────────────────
// Answers "do we have enough shovel-ready work, and how many weeks of runway?"
// Backlog health: 4–8 wks green, 3 or 9–10 yellow, else red (shop-health bands).
function backlogTone(w: number | null): string {
  if (w == null) return "text-muted";
  if (w >= 4 && w <= 8) return "text-green-400";
  if ((w >= 3 && w < 4) || (w > 8 && w <= 10)) return "text-amber-400";
  return "text-red-400";
}
// RTB coverage: ≥2 wks green, 1–2 yellow, <1 red (shop-health RTB band).
function coverageTone(w: number | null): string {
  if (w == null) return "text-muted";
  if (w >= 2) return "text-green-400";
  if (w >= 1) return "text-amber-400";
  return "text-red-400";
}

function CapacityRow({ capacity: c }: { capacity: ProjectFunnelCapacity }) {
  const rate = c.weeklyInstallRate;
  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground/80">Capacity &amp; Backlog</h3>
        <span className="text-[11px] text-muted">
          Install pace ~<span className="text-foreground font-semibold tabular-nums">{rate}</span>/wk (trailing 8 wks)
        </span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* RTB Bench */}
        <div className="bg-gradient-to-br from-cyan-500/20 to-transparent border border-cyan-500/30 rounded-lg px-4 py-3">
          <div className="text-2xl font-bold text-foreground tabular-nums leading-none">{c.rtbBenchCount}</div>
          <div className="text-xs font-semibold text-cyan-300 mt-1.5">RTB Bench</div>
          <div className="text-[11px] text-muted mt-0.5 tabular-nums">
            {formatCurrencyCompact(c.rtbBenchAmount)} · shovel-ready
          </div>
        </div>
        {/* Weeks of RTB coverage */}
        <div className="bg-surface border border-t-border rounded-lg px-4 py-3">
          <div className={`text-2xl font-bold tabular-nums leading-none ${coverageTone(c.weeksOfRtbCoverage)}`}>
            {c.weeksOfRtbCoverage == null ? "—" : `${c.weeksOfRtbCoverage}w`}
          </div>
          <div className="text-xs font-semibold text-foreground mt-1.5">RTB Runway</div>
          <div className="text-[11px] text-muted mt-0.5">weeks before crews run dry</div>
        </div>
        {/* Weeks of backlog */}
        <div className="bg-surface border border-t-border rounded-lg px-4 py-3">
          <div className={`text-2xl font-bold tabular-nums leading-none ${backlogTone(c.weeksOfBacklog)}`}>
            {c.weeksOfBacklog == null ? "—" : `${c.weeksOfBacklog}w`}
          </div>
          <div className="text-xs font-semibold text-foreground mt-1.5">Total Backlog</div>
          <div className="text-[11px] text-muted mt-0.5 tabular-nums">
            {c.preconBacklogCount} precon · runway
          </div>
        </div>
        {/* RTB-Blocked risk */}
        <div className="bg-gradient-to-br from-red-500/15 to-transparent border border-red-500/30 rounded-lg px-4 py-3">
          <div className="text-2xl font-bold text-foreground tabular-nums leading-none">{c.blockedCount}</div>
          <div className="text-xs font-semibold text-red-300 mt-1.5">RTB‑Blocked</div>
          <div className="text-[11px] text-muted mt-0.5 truncate" title={c.blockedTopReason || undefined}>
            {formatCurrencyCompact(c.blockedAmount)}
            {c.blockedTopReason ? ` · ${c.blockedTopReason}` : " · jammed capacity"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── RTB inflow forecast (leading indicator) ──────────────────────────────────
// Projects how many DA-approved deals will ARRIVE in Ready-To-Build over the
// next 8 weeks, aged forward by average leg times and haircut by conversion.
function RtbForecastSection({ forecast: f }: { forecast: ProjectFunnelRtbForecast }) {
  const maxWeek = Math.max(1, ...f.weeks.map((w) => w.count));
  const weekLabel = (i: number) => {
    const d = new Date();
    d.setDate(d.getDate() + i * 7);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-foreground/80">RTB Inflow Forecast</h3>
        <span className="text-[11px] text-muted">
          From {f.population} DA-approved deals · {Math.round(f.conversionRate * 100)}% convert to RTB
        </span>
      </div>
      <p className="text-xs text-muted mb-4">
        Projected arrivals into Ready-To-Build, aged forward by avg stage times ({f.legDays.approvedToDesignComplete}+{f.legDays.designCompleteToPermitSubmit}+{f.legDays.permitSubmitToIssued}d)
      </p>

      {/* Rollups */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-gradient-to-br from-emerald-500/20 to-transparent border border-emerald-500/30 rounded-lg px-4 py-3">
          <div className="text-2xl font-bold text-foreground tabular-nums leading-none">{f.next2wkCount}</div>
          <div className="text-xs font-semibold text-emerald-300 mt-1.5">Next 2 weeks</div>
          <div className="text-[11px] text-muted mt-0.5 tabular-nums">{formatCurrencyCompact(f.next2wkAmount)}</div>
        </div>
        <div className="bg-gradient-to-br from-cyan-500/20 to-transparent border border-cyan-500/30 rounded-lg px-4 py-3">
          <div className="text-2xl font-bold text-foreground tabular-nums leading-none">{f.next4wkCount}</div>
          <div className="text-xs font-semibold text-cyan-300 mt-1.5">Next 4 weeks</div>
          <div className="text-[11px] text-muted mt-0.5 tabular-nums">{formatCurrencyCompact(f.next4wkAmount)}</div>
        </div>
        <div className="bg-surface-2 border border-t-border rounded-lg px-4 py-3">
          <div className="text-2xl font-bold text-muted tabular-nums leading-none">{f.beyond8wkCount}</div>
          <div className="text-xs font-semibold text-muted mt-1.5">Beyond 8 weeks</div>
          <div className="text-[11px] text-muted/70 mt-0.5 tabular-nums">{formatCurrencyCompact(f.beyond8wkAmount)}</div>
        </div>
      </div>

      {/* Weekly bars */}
      <div className="flex items-end gap-2 h-28">
        {f.weeks.map((w, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1" title={`Week of ${weekLabel(i)}: ${w.count} jobs · ${formatCurrencyCompact(w.amount)}`}>
            <span className="text-[10px] text-foreground/80 font-semibold tabular-nums">{w.count || ""}</span>
            <div
              className="w-full bg-emerald-500/60 rounded-t"
              style={{ height: `${Math.max(w.count > 0 ? 6 : 0, (w.count / maxWeek) * 88)}px` }}
            />
            <span className="text-[10px] text-muted tabular-nums">{weekLabel(i)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Incoming tab ─────────────────────────────────────────────────────────────
// Per step: backlog now, queued behind (immediate upstream), "not here yet" (the
// full strictly-upstream pipeline), and 30-day inflow vs outflow + net.
const INCOMING_GATES: Array<{
  key: keyof ProjectFunnelDrillDown;
  label: string;
  milestone: ProjectFunnelStageKey | null;
  prev: ProjectFunnelStageKey | null;
  color: string;
}> = [
  { key: "awaitingSurveySchedule", label: "Survey Scheduling", milestone: "surveyScheduled", prev: "salesClosed", color: "bg-orange-500" },
  { key: "awaitingSurvey", label: "Survey Completion", milestone: "surveyDone", prev: "surveyScheduled", color: "bg-amber-500" },
  { key: "awaitingDaSend", label: "DA Send", milestone: "daSent", prev: "surveyDone", color: "bg-lime-500" },
  { key: "awaitingApproval", label: "DA Approval", milestone: "daApproved", prev: "daSent", color: "bg-blue-500" },
  { key: "awaitingDesignComplete", label: "Design Complete", milestone: "designCompleted", prev: "daApproved", color: "bg-indigo-500" },
  { key: "awaitingPermitSubmit", label: "Permit Submit", milestone: "permitsSubmitted", prev: "designCompleted", color: "bg-purple-500" },
  { key: "awaitingPermitIssue", label: "Permit Issue", milestone: "permitsIssued", prev: "permitsSubmitted", color: "bg-violet-500" },
  { key: "awaitingConstructionSchedule", label: "Construction Scheduling", milestone: "constructionScheduled", prev: "permitsIssued", color: "bg-cyan-500" },
  { key: "awaitingConstructionComplete", label: "Construction Complete", milestone: "constructionComplete", prev: "constructionScheduled", color: "bg-green-500" },
  { key: "awaitingInspection", label: "Inspection", milestone: "inspectionPassed", prev: "constructionComplete", color: "bg-emerald-500" },
  { key: "awaitingPto", label: "PTO", milestone: "ptoGranted", prev: "inspectionPassed", color: "bg-teal-500" },
  { key: "awaitingCloseOut", label: "Close Out", milestone: null, prev: "ptoGranted", color: "bg-sky-500" },
];

// Median days for the hop that LANDS a deal at each gate's milestone (index
// aligns with INCOMING_GATES). Used to estimate how long the upstream deals
// take to travel down to a given step.
const INCOMING_HOP_MEDIAN: Array<keyof ProjectFunnelResponse["medianDays"] | null> = [
  "closedToSurveyScheduled",
  "surveyScheduledToComplete",
  "surveyToDaSent",
  "daSentToApproved",
  "approvedToDesignComplete",
  "designCompleteToPermitSubmit",
  "permitSubmitToIssued",
  "permitIssuedToConstructionScheduled",
  "constructionScheduledToComplete",
  "constructionCompleteToInspection",
  "inspectionToPto",
  null,
];

function IncomingView({ data }: { data: ProjectFunnelResponse }) {
  const rows = useMemo(() => {
    const counts = INCOMING_GATES.map((g) => data.drillDown[g.key]?.length ?? 0);
    const amounts = INCOMING_GATES.map((g) => (data.drillDown[g.key] ?? []).reduce((s, d) => s + (d.amount || 0), 0));
    // Cumulative median days to reach each gate from the top, so the transit time
    // from gate i down to step m is cumHop[m] − cumHop[i].
    const hopDays = INCOMING_HOP_MEDIAN.map((k) => (k ? data.medianDays[k] ?? 0 : 0));
    const cumHop = [0];
    for (let i = 0; i < hopDays.length; i++) cumHop[i + 1] = cumHop[i] + hopDays[i];
    return INCOMING_GATES.map((g, i) => {
      const backlogNow = counts[i];
      const backlogAmount = amounts[i];
      const queued = i > 0 ? counts[i - 1] : 0;
      // "Not here yet" = everything in strictly-upstream gates (prefix sum).
      const notHereYet = counts.slice(0, i).reduce((a, b) => a + b, 0);
      const notHereYetAmount = amounts.slice(0, i).reduce((a, b) => a + b, 0);
      const in30 = g.prev ? data.inflow30d[g.prev] ?? 0 : null;
      const out30 = g.milestone ? data.inflow30d[g.milestone] ?? 0 : null;
      // Where the "not here yet" deals actually are: one segment per upstream
      // step they're currently sitting in.
      const breakdown = INCOMING_GATES.slice(0, i)
        .map((ug, j) => ({ label: ug.label, color: ug.color, count: counts[j] }))
        .filter((seg) => seg.count > 0);
      // Count-weighted average travel time for those upstream deals to reach this
      // step (sum of median stage hops between where each sits and here).
      let weighted = 0;
      let maxEta = 0;
      for (let j = 0; j < i; j++) {
        if (counts[j] <= 0) continue;
        const transit = cumHop[i] - cumHop[j];
        weighted += counts[j] * transit;
        if (transit > maxEta) maxEta = transit;
      }
      const avgEta = notHereYet > 0 ? Math.round(weighted / notHereYet) : null;
      return {
        key: g.key as string,
        label: g.label,
        color: g.color,
        backlogNow,
        backlogAmount,
        queued,
        notHereYet,
        notHereYetAmount,
        breakdown,
        avgEta,
        maxEta,
        in30,
        out30,
        net: (in30 ?? 0) - (out30 ?? 0),
      };
    });
  }, [data]);

  const maxNotHereYet = Math.max(1, ...rows.map((r) => r.notHereYet));
  const netTone = (net: number) => (net > 0 ? "text-amber-400" : net < 0 ? "text-green-400" : "text-muted");

  return (
    <>
      {/* "Not here yet" — the upstream pipeline feeding each step */}
      <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
        <h3 className="text-sm font-semibold text-foreground/80 mb-1">Not Here Yet — where the upstream deals are</h3>
        <p className="text-xs text-muted mb-3">Each bar = deals not yet at that step, colored by the step they&apos;re sitting in now</p>
        {/* Legend: color → step */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3">
          {INCOMING_GATES.map((g) => (
            <span key={g.key as string} className="inline-flex items-center gap-1 text-[10px] text-muted">
              <span className={`inline-block h-2 w-2 rounded-sm ${g.color}`} />{g.label}
            </span>
          ))}
        </div>
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-3">
              <span className="w-48 text-xs text-muted text-right shrink-0 truncate" title={r.label}>{r.label}</span>
              <div className="flex items-center gap-2 flex-1">
                {r.notHereYet > 0 ? (
                  <div
                    className="flex h-5 rounded-md overflow-hidden"
                    style={{ width: `${Math.max(3, (r.notHereYet / maxNotHereYet) * 100)}%` }}
                  >
                    {r.breakdown.map((seg, i) => (
                      <div
                        key={seg.label}
                        className={`${seg.color} h-full ${i > 0 ? "border-l border-black/25" : ""}`}
                        style={{ width: `${(seg.count / r.notHereYet) * 100}%`, opacity: 0.8 }}
                        title={`${seg.count} at ${seg.label}`}
                      />
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted/50 italic">—</span>
                )}
                <span className="text-xs font-semibold text-foreground tabular-nums shrink-0">{r.notHereYet}</span>
                <span className="text-[11px] text-muted shrink-0 tabular-nums">{formatCurrencyCompact(r.notHereYetAmount)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Flow table */}
      <div className="bg-surface rounded-xl border border-t-border p-5 overflow-x-auto">
        <h3 className="text-sm font-semibold text-foreground/80 mb-3">Flow by step</h3>
        <table className="w-full text-xs border-collapse min-w-[860px]">
          <thead>
            <tr className="text-muted border-b border-t-border">
              <th className="text-left font-medium py-1.5 pr-3">Step</th>
              <th className="text-right font-medium py-1.5 pr-3" title="At this step right now, waiting">Backlog now</th>
              <th className="text-right font-medium py-1.5 pr-3" title="In the immediately-upstream step — the next wave in">Queued behind</th>
              <th className="text-right font-medium py-1.5 pr-3" title="Everything in any strictly-upstream step — the full pipeline feeding this one">Not here yet</th>
              <th className="text-right font-medium py-1.5 pr-3" title="Count-weighted average time for the not-here-yet deals to travel down to this step, using median stage durations">Avg to arrive</th>
              <th className="text-right font-medium py-1.5 pr-3" title="Reached this step in the last 30 days">30d In</th>
              <th className="text-right font-medium py-1.5 pr-3" title="Moved past this step in the last 30 days">30d Out</th>
              <th className="text-right font-medium py-1.5" title="In − Out: positive = backlog growing">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-t-border/40 hover:bg-surface-2/40">
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  <span className={`inline-block h-2 w-2 rounded-sm mr-2 ${r.color}`} />
                  {r.label}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  <span className="font-semibold text-foreground">{r.backlogNow}</span>
                  <span className="block text-[10px] text-muted/70">{formatCurrencyCompact(r.backlogAmount)}</span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{r.queued || "—"}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  <span className="text-foreground/90">{r.notHereYet || "—"}</span>
                  {r.notHereYet > 0 && <span className="block text-[10px] text-muted/70">{formatCurrencyCompact(r.notHereYetAmount)}</span>}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-foreground/80" title={r.avgEta != null ? `Furthest-back deals ~${r.maxEta}d out` : undefined}>
                  {r.avgEta != null ? `~${r.avgEta}d` : "—"}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-cyan-400/90">{r.in30 ?? "—"}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{r.out30 ?? "—"}</td>
                <td className={`py-1.5 text-right tabular-nums font-semibold ${netTone(r.net)}`}>{r.net > 0 ? "+" : ""}{r.net}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-muted/70 mt-3">
          Net is last-30-day inflow − outflow: <span className="text-amber-400">amber</span> = backlog growing, <span className="text-green-400">green</span> = shrinking.
          {" "}Avg to arrive estimates how long the upstream deals take to reach the step, from median stage durations.
        </p>
      </div>
    </>
  );
}


function BacklogSection({
  summary,
  drillDown,
  medianDays,
  expanded,
  onToggle,
}: {
  summary: ProjectFunnelResponse["summary"];
  drillDown: ProjectFunnelDrillDown;
  medianDays: ProjectFunnelResponse["medianDays"];
  expanded: string | null;
  onToggle: (key: string | null) => void;
}) {

  type StaffCol = { key: keyof ProjectFunnelDrillDownDeal; label: string };
  const PM: StaffCol = { key: "projectManager", label: "PM" };
  const OWNER: StaffCol = { key: "dealOwner", label: "Owner" };
  const SURVEYOR: StaffCol = { key: "siteSurveyor", label: "Surveyor" };
  const DESIGN: StaffCol = { key: "designLead", label: "Design" };
  const PERMIT: StaffCol = { key: "permitLead", label: "Permit" };
  const OPS: StaffCol = { key: "operationsManager", label: "Ops Lead" };
  const INSP: StaffCol = { key: "inspectionsLead", label: "Inspection Lead" };
  const IC: StaffCol = { key: "interconnectionsLead", label: "IC Lead" };
  // Interconnection runs parallel to permitting before construction — surface
  // its status in the pre-construction backlogs so blockers are visible.
  const ICSTATUS: StaffCol = { key: "interconnectionStatus", label: "IC Status" };

  // Deals that cancelled AT this gate (reached the prior milestone but not this
  // one) = cancelledCount(prior) − cancelledCount(this). The drill-down places
  // each cancelled deal in the same bucket, so adding this to the active count
  // keeps the bar count equal to the row list — and the funnel card-to-card
  // drop = the backlog exactly. All zero when cancelled deals are hidden (they
  // are filtered up front) and on the active-scope tabs (never included).
  const cancelledAtGate = (prior: ProjectFunnelStageKey, cur: ProjectFunnelStageKey) =>
    Math.max(0, summary[prior].cancelledCount - summary[cur].cancelledCount);

  const backlogs: Array<{
    key: string;
    label: string;
    count: number;
    color: string;
    deals: ProjectFunnelDrillDownDeal[];
    staffCols: StaffCol[];
  }> = [
    { key: "awaitingSurveySchedule", label: "Awaiting Survey Schedule", count: summary.salesClosed.count - summary.surveyScheduled.count + cancelledAtGate("salesClosed", "surveyScheduled"), color: "bg-orange-500", deals: drillDown.awaitingSurveySchedule, staffCols: [PM, OWNER] },
    { key: "awaitingSurvey", label: "Awaiting Survey Complete", count: summary.surveyScheduled.count - summary.surveyDone.count + cancelledAtGate("surveyScheduled", "surveyDone"), color: "bg-amber-500", deals: drillDown.awaitingSurvey, staffCols: [PM, OWNER, SURVEYOR] },
    { key: "awaitingDaSend", label: "Awaiting DA Send", count: summary.surveyDone.count - summary.daSent.count + cancelledAtGate("surveyDone", "daSent"), color: "bg-lime-500", deals: drillDown.awaitingDaSend, staffCols: [PM, OWNER, DESIGN] },
    { key: "awaitingApproval", label: "Awaiting DA Approval", count: summary.daSent.count - summary.daApproved.count + cancelledAtGate("daSent", "daApproved"), color: "bg-blue-500", deals: drillDown.awaitingApproval, staffCols: [PM, OWNER, DESIGN] },
    { key: "awaitingDesignComplete", label: "Awaiting Design Complete", count: summary.daApproved.count - summary.designCompleted.count + cancelledAtGate("daApproved", "designCompleted"), color: "bg-indigo-500", deals: drillDown.awaitingDesignComplete, staffCols: [PM, OWNER, DESIGN] },
    { key: "awaitingPermitSubmit", label: "Awaiting Permit Submit", count: summary.designCompleted.count - summary.permitsSubmitted.count + cancelledAtGate("designCompleted", "permitsSubmitted"), color: "bg-purple-500", deals: drillDown.awaitingPermitSubmit, staffCols: [PM, OWNER, PERMIT, ICSTATUS] },
    { key: "awaitingPermitIssue", label: "Awaiting Permit Issue", count: summary.permitsSubmitted.count - summary.permitsIssued.count + cancelledAtGate("permitsSubmitted", "permitsIssued"), color: "bg-violet-500", deals: drillDown.awaitingPermitIssue, staffCols: [PM, OWNER, PERMIT, ICSTATUS] },
    { key: "awaitingInterconnection", label: "Awaiting Interconnection Approval", count: drillDown.awaitingInterconnection.length, color: "bg-fuchsia-500", deals: drillDown.awaitingInterconnection, staffCols: [PM, OWNER, IC, ICSTATUS] },
    { key: "awaitingReadyToBuild", label: "Awaiting Ready to Build", count: drillDown.awaitingReadyToBuild.length, color: "bg-cyan-600", deals: drillDown.awaitingReadyToBuild, staffCols: [PM, OWNER, IC, ICSTATUS] },
    { key: "awaitingConstructionSchedule", label: "Awaiting Construction Schedule", count: drillDown.awaitingConstructionSchedule.length, color: "bg-cyan-500", deals: drillDown.awaitingConstructionSchedule, staffCols: [PM, OWNER, OPS, ICSTATUS] },
    { key: "awaitingConstructionComplete", label: "Awaiting Construction Complete", count: summary.constructionScheduled.count - summary.constructionComplete.count + cancelledAtGate("constructionScheduled", "constructionComplete"), color: "bg-green-500", deals: drillDown.awaitingConstructionComplete, staffCols: [PM, OWNER, OPS] },
    { key: "awaitingInspection", label: "Awaiting Inspection", count: summary.constructionComplete.count - summary.inspectionPassed.count + cancelledAtGate("constructionComplete", "inspectionPassed"), color: "bg-emerald-500", deals: drillDown.awaitingInspection, staffCols: [PM, OWNER, INSP] },
    { key: "awaitingPto", label: "Awaiting PTO", count: summary.inspectionPassed.count - summary.ptoGranted.count + cancelledAtGate("inspectionPassed", "ptoGranted"), color: "bg-teal-500", deals: drillDown.awaitingPto, staffCols: [PM, OWNER, IC, ICSTATUS] },
    { key: "awaitingCloseOut", label: "Awaiting Close Out", count: drillDown.awaitingCloseOut.length, color: "bg-sky-500", deals: drillDown.awaitingCloseOut, staffCols: [PM, OWNER] },
  ];

  const maxBacklog = Math.max(1, ...backlogs.map((b) => b.count));
  const anyCancelled = backlogs.some((b) => b.deals.some((d) => d.flag?.label === "Cancelled"));

  // Revenue per backlog = sum of its drill-down deals (the bucket membership).
  const backlogRevenue = (b: { deals: ProjectFunnelDrillDownDeal[] }) =>
    b.deals.reduce((sum, d) => sum + (d.amount || 0), 0);
  const totalBacklogRevenue = backlogs.reduce((sum, b) => sum + backlogRevenue(b), 0);
  const totalBacklogCount = backlogs.reduce((sum, b) => sum + Math.max(0, b.count), 0);

  function toggle(key: string) {
    onToggle(expanded === key ? null : key);
  }

  // Average days the pending deals have been waiting at this stage. Clamp each
  // deal at 0 so future-dated references (e.g. construction scheduled ahead)
  // don't produce a negative "days in stage".
  // Average excludes only "parked" deals (On Hold, Cancelled) — pauses/dead ends
  // we don't hold against the clock. RTB-Blocked and Sales Change still count: we
  // want to see how long they've been blocked/pending.
  const avgDaysInStage = (deals: ProjectFunnelDrillDownDeal[]): number | null => {
    const days = deals
      .filter((d) => !d.flag?.parked)
      .map((d) => Math.max(0, d.daysWaiting))
      .filter((n) => Number.isFinite(n));
    if (days.length === 0) return null;
    return Math.round(days.reduce((sum, n) => sum + n, 0) / days.length);
  };
  // Per-bucket summary of flagged (not-actionable) deals, grouped by label.
  const flagsInBucket = (deals: ProjectFunnelDrillDownDeal[]) => {
    const m = new Map<string, { count: number; tone: string; parked: boolean }>();
    for (const d of deals) {
      if (!d.flag) continue;
      const e = m.get(d.flag.label) || { count: 0, tone: d.flag.tone, parked: d.flag.parked };
      e.count++;
      m.set(d.flag.label, e);
    }
    return [...m.entries()].map(([label, v]) => ({ label, ...v }));
  };

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-foreground/80">
          Pipeline Backlog
        </h3>
        <span className="text-xs text-muted">
          <span className="text-foreground font-semibold">{totalBacklogCount}</span> deals · {formatCurrencyCompact(totalBacklogRevenue)} in backlog
        </span>
      </div>
      {anyCancelled ? (
        <p className="text-[11px] text-muted/70 mb-4">
          Deals stuck before each milestone. Deals that <span className="text-red-400/70">cancelled at a gate</span> are
          included in that bucket and flagged red in the drill-down — use the Cancelled toggle above to drop them.
        </p>
      ) : (
        <div className="mb-4" />
      )}
      <div className="space-y-1">
        {backlogs.map((b) => {
          const revenue = backlogRevenue(b);
          const segs = statusBreakdown(b.deals);
          const segTotal = b.deals.length || 1;
          const avgDays = avgDaysInStage(b.deals);
          const flags = flagsInBucket(b.deals);
          // Backlog aging: deals waiting longer than this stage's typical time
          // (future-scheduled / on-hold deals excluded — see isDealLate).
          const benchmark = backlogBenchmark(b.key, medianDays);
          const lateCount = b.deals.filter((d) => isDealLate(d, benchmark)).length;
          return (
          <div key={b.key} id={`backlog-${b.key}`} className="scroll-mt-24">
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
                  <>
                    {/* Stacked by status so the composition is visible at a glance. */}
                    <div
                      className="flex h-6 rounded-md overflow-hidden"
                      style={{ width: `${Math.max(8, (b.count / maxBacklog) * 100)}%` }}
                    >
                      {segs.map((seg, i) => (
                        <div
                          key={seg.status}
                          className={`${b.color} h-full ${i > 0 ? "border-l border-black/25" : ""}`}
                          style={{ width: `${(seg.count / segTotal) * 100}%`, opacity: segOpacity(i) }}
                          title={`${seg.status}: ${seg.count} · ${formatCurrencyCompact(seg.amount)}`}
                        />
                      ))}
                    </div>
                    <span className="text-xs font-bold text-foreground shrink-0">{b.count}</span>
                  </>
                ) : (
                  <span className="text-xs text-muted/60 italic">—</span>
                )}
                {b.count > 0 && (
                  <span className="text-xs text-muted shrink-0 tabular-nums">
                    {formatCurrencyCompact(revenue)}
                  </span>
                )}
                {b.count > 0 && avgDays != null && (
                  <span className="text-xs text-muted/70 shrink-0 tabular-nums" title="Average days the actionable (non-parked) deals have been at this stage">
                    {avgDays}d in stage
                  </span>
                )}
                {lateCount > 0 && benchmark != null && (
                  <span
                    className="text-xs text-red-400/90 shrink-0 tabular-nums font-medium"
                    title={`Waiting longer than the ${benchmark}d typical time for this stage`}
                  >
                    · {lateCount} late
                  </span>
                )}
                {flags.map((f) => (
                  <span
                    key={f.label}
                    className={`text-xs shrink-0 tabular-nums ${FLAG_TEXT[f.tone] || "text-muted"}`}
                    title={f.parked
                      ? `${f.label} — counted in this bucket but parked, so excluded from the average above`
                      : "Counted in this bucket and in the average; flagged so you can see why it's been waiting"}
                  >
                    · {f.count} {f.label.toLowerCase()}
                  </span>
                ))}
              </div>
            </button>
            {/* Per-status counts, aligned under the bar. */}
            {b.count > 0 && segs.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-[11.75rem] pb-1 text-[10px] text-muted">
                {segs.map((seg) => (
                  <span key={seg.status} className="whitespace-nowrap">
                    <span className="text-foreground/70 font-semibold tabular-nums">{seg.count}</span> {seg.status}{" "}
                    <span className="text-cyan-400/80 tabular-nums">{formatCurrencyCompact(seg.amount)}</span>
                  </span>
                ))}
              </div>
            )}
            {expanded === b.key && b.deals.length > 0 && (
              <DrillDownTable deals={b.deals} staffCols={b.staffCols} benchmark={benchmark} />
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function DrillDownTable({
  deals,
  staffCols = [],
  benchmark = null,
}: {
  deals: ProjectFunnelDrillDownDeal[];
  staffCols?: Array<{ key: keyof ProjectFunnelDrillDownDeal; label: string }>;
  /** Avg days this stage takes; deals waiting longer are flagged "late". */
  benchmark?: number | null;
}) {
  const hasScheduled = deals.some((d) => d.scheduledDate);
  const hasExtra = deals.some((d) => d.extraDate);
  const extraLabel = deals.find((d) => d.extraLabel)?.extraLabel || "Extra";

  type SortDir = "asc" | "desc";
  // Default mirrors the server ordering: longest-waiting first.
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "days", dir: "desc" });

  function sortValue(d: ProjectFunnelDrillDownDeal, key: string): string | number {
    switch (key) {
      case "project": return (d.projectNumber || d.name || "").toLowerCase();
      case "amount": return d.amount || 0;
      case "location": return (d.pbLocation || "").toLowerCase();
      case "stage": return (d.stage || "").toLowerCase();
      case "scheduled": return d.scheduledDate || "";
      case "extra": return d.extraDate || "";
      case "days": return d.daysWaiting;
      case "status": return (d.status || "").toLowerCase();
      default: return String((d[key as keyof ProjectFunnelDrillDownDeal] ?? "")).toLowerCase();
    }
  }

  const sorted = useMemo(() => {
    const arr = [...deals];
    arr.sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (typeof av === "number" && typeof bv === "number") {
        return sort.dir === "asc" ? av - bv : bv - av;
      }
      const as = String(av);
      const bs = String(bv);
      // Blanks always sort to the bottom regardless of direction.
      if (as === "" && bs !== "") return 1;
      if (bs === "" && as !== "") return -1;
      const cmp = as.localeCompare(bs);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [deals, sort]);

  function toggleSort(key: string, defaultDir: SortDir) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: defaultDir }
    );
  }

  const renderTh = (
    id: string,
    label: string,
    align: "left" | "right" = "left",
    defaultDir: SortDir = "asc"
  ) => {
    const active = sort.key === id;
    return (
      <th key={id} className={`${align === "right" ? "text-right" : "text-left"} py-1 px-1.5 text-muted font-medium`}>
        <button
          type="button"
          onClick={() => toggleSort(id, defaultDir)}
          className={`inline-flex items-center gap-0.5 hover:text-foreground transition-colors cursor-pointer ${active ? "text-foreground" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}
          title={`Sort by ${label}`}
        >
          {label}
          <span className="text-[8px] w-2">{active ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
        </button>
      </th>
    );
  };

  return (
    <div className="ml-[11.5rem] mt-1 mb-2 overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-t-border/50">
            {renderTh("project", "Project")}
            {renderTh("amount", "Amount", "right", "desc")}
            {renderTh("location", "Location")}
            {renderTh("stage", "Stage")}
            {staffCols.map((sc) => renderTh(String(sc.key), sc.label))}
            {hasScheduled && renderTh("scheduled", "Scheduled", "left", "desc")}
            {hasExtra && renderTh("extra", extraLabel, "left", "desc")}
            {renderTh("days", "Days", "right", "desc")}
            {renderTh("status", "Status")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => (
            <Fragment key={d.id}>
            <tr
              className={`${d.flag ? "" : "border-b border-t-border/30"} ${d.flag?.parked ? "opacity-60" : d.daysWaiting > 30 ? "bg-red-500/5" : ""}`}
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
                {d.flag && (
                  <span className={`ml-1.5 align-middle inline-block px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wide ${FLAG_PILL[d.flag.tone] || "bg-zinc-500/20 text-zinc-300"}`}>
                    {d.flag.label}
                  </span>
                )}
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
              {staffCols.map((sc) => {
                const val = d[sc.key] as string;
                return (
                  <td key={sc.key} className="py-1 px-1.5 text-muted truncate max-w-[110px]" title={val || "—"}>
                    {val || <span className="italic text-muted/60">—</span>}
                  </td>
                );
              })}
              {hasScheduled && (
                <td className="py-1 px-1.5 text-muted whitespace-nowrap">
                  {d.scheduledDate ? formatShortDate(d.scheduledDate) : <span className="italic text-muted/60">—</span>}
                </td>
              )}
              {hasExtra && (
                <td className="py-1 px-1.5 whitespace-nowrap">
                  {d.extraDate ? (
                    <span className="text-red-400">{formatShortDate(d.extraDate)}</span>
                  ) : (
                    <span className="italic text-muted/60">—</span>
                  )}
                </td>
              )}
              <td className={`text-right py-1 px-1.5 font-medium ${d.flag?.parked ? "text-muted/60" : d.daysWaiting > 30 ? "text-red-400" : d.daysWaiting > 14 ? "text-amber-400" : "text-muted"}`}>
                {d.daysWaiting}d
                {isDealLate(d, benchmark) && (
                  <span className="ml-1 text-[9px] text-red-400/90 font-semibold uppercase" title={`Over the ${benchmark}d stage average`}>late</span>
                )}
              </td>
              <td className="py-1 px-1.5 text-muted truncate max-w-[120px]" title={d.status || "—"}>
                {d.status || <span className="italic text-muted/60">—</span>}
              </td>
            </tr>
            {d.flag && (
              <tr className="border-b border-t-border/30">
                <td colSpan={6 + staffCols.length + (hasScheduled ? 1 : 0) + (hasExtra ? 1 : 0)} className="px-1.5 pb-1.5 pt-0">
                  <span className={`text-[11px] ${FLAG_TEXT[d.flag.tone] || "text-muted"}`}>↳ {d.flag.label}</span>
                  {d.flag.reason ? (
                    <span className="text-[11px] text-muted/80"> · {d.flag.reason}</span>
                  ) : (
                    <span className="text-[11px] text-muted/50 italic"> · no reason given in HubSpot</span>
                  )}
                  {d.flag.note && <span className="text-[11px] text-muted/70 italic"> — {d.flag.note}</span>}
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Revenue conversion by cohort: of each close-month's Sales Closed revenue,
 * the % (and $) that has reached DA Approved and Construction Complete. Recent
 * cohorts read low — those deals haven't had time to get there yet.
 */
function RevenueConversionTable({ cohorts }: { cohorts: ProjectFunnelResponse["cohorts"] }) {
  const MAX_MONTHS = 18;
  const rows = useMemo(() => [...cohorts].slice(0, MAX_MONTHS), [cohorts]);
  const TARGETS: Array<{ key: ProjectFunnelStageKey; label: string; bar: string; text: string }> = [
    { key: "daApproved", label: "DA Approved", bar: "bg-blue-500", text: "text-blue-400" },
    { key: "constructionComplete", label: "Construction Complete", bar: "bg-green-500", text: "text-green-400" },
  ];

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <h3 className="text-sm font-semibold text-foreground/80 mb-1">Revenue Conversion by Cohort</h3>
      <p className="text-xs text-muted mb-4">
        Of each month&apos;s Sales Closed revenue, the share that has reached each milestone. Recent
        months read low — those deals haven&apos;t had time to get there yet.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-t-border">
              <th className="text-left py-2 px-2 text-muted font-medium">Cohort</th>
              <th className="text-center py-2 px-2 text-orange-400 font-medium whitespace-nowrap">Sales Closed</th>
              {TARGETS.map((t) => (
                <th key={t.key} className={`text-center py-2 px-2 font-medium whitespace-nowrap ${t.text}`}>
                  → {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const closed = c.salesClosed.amount;
              return (
                <tr key={c.month} className={`border-b border-t-border/50 ${i % 2 === 0 ? "bg-surface-2/50" : ""}`}>
                  <td className="py-2 px-2 font-semibold text-foreground whitespace-nowrap">{monthLabel(c.month)}</td>
                  <td className="text-center py-2 px-2 text-muted tabular-nums">{formatCurrencyCompact(closed)}</td>
                  {TARGETS.map((t) => {
                    const rev = c[t.key].amount;
                    const pct = closed > 0 ? Math.min(100, Math.round((rev / closed) * 100)) : 0;
                    return (
                      <td key={t.key} className="py-2 px-2">
                        {closed > 0 ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`font-semibold tabular-nums ${t.text}`}>{pct}%</span>
                            <div className="w-full max-w-[90px] h-1.5 rounded-full bg-surface-2 overflow-hidden">
                              <div className={`${t.bar} h-full`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[10px] text-muted tabular-nums">{formatCurrencyCompact(rev)}</span>
                          </div>
                        ) : (
                          <span className="text-muted/40 block text-center">—</span>
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

function MonthlyFunnelChart({
  cohorts,
}: {
  cohorts: ProjectFunnelResponse["cohorts"];
}) {
  // cohorts arrive newest-first. Cap the chart to the most recent months so an
  // all-time (All active deals) scope doesn't cram years of bars together.
  const MAX_MONTHS = 18;
  const capped = cohorts.length > MAX_MONTHS;
  const chronological = useMemo(() => [...cohorts].slice(0, MAX_MONTHS).reverse(), [cohorts]);

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
      <h3 className="text-sm font-semibold text-foreground/80 mb-1">
        Monthly Cohort Trend
      </h3>
      <p className="text-xs text-muted mb-4">
        Deals grouped by the month they sold, then how far each cohort progressed.
        {capped ? ` Showing the most recent ${MAX_MONTHS} months.` : ""}
      </p>
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
              // Conversion is computed on active deals only — cancelled excluded.
              const closedActive = cohort.salesClosed.count;

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
                      stage.key === "salesClosed" || closedActive === 0
                        ? null
                        : Math.round((d.count / closedActive) * 100);

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
                            {d.cancelledCount} cancelled
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

/** RTB-Blocked and On Hold break down by reason, so label the drill-down column "Reason". */
const REASON_STAGES = new Set(["RTB - Blocked", "On Hold"]);

function StageDistribution({
  stages,
  totalDeals,
  expanded,
  onToggle,
}: {
  stages: ProjectFunnelStageGroup[];
  totalDeals: number;
  expanded: string | null;
  onToggle: (key: string | null) => void;
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
      <div className="space-y-1.5">
        {stages.map((stage) => {
          const pct = totalDeals > 0 ? Math.round((stage.count / totalDeals) * 100) : 0;
          const color = STAGE_COLORS[stage.stageName] || "bg-zinc-500";
          const segs = stage.statusBreakdown.length ? stage.statusBreakdown : [{ status: "No status", count: stage.count }];
          const segTotal = stage.count || 1;
          const hasRealStatus = stage.statusBreakdown.some((s) => s.status !== "No status");
          const isReasonStage = REASON_STAGES.has(stage.stageName);
          return (
            <div key={stage.stageId} id={`stage-${stage.stageId}`} className="scroll-mt-24">
              <button
                type="button"
                className="flex items-center gap-3 w-full py-0.5 rounded-md hover:bg-surface-2/50 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                onClick={() => stage.count > 0 && onToggle(expanded === stage.stageId ? null : stage.stageId)}
                disabled={stage.count <= 0}
              >
                <span className="w-44 text-xs text-muted text-right shrink-0 flex items-center justify-end gap-1">
                  {stage.count > 0 && (
                    <span className={`text-[10px] transition-transform ${expanded === stage.stageId ? "rotate-90" : ""}`}>▶</span>
                  )}
                  <span className="truncate" title={stage.stageName}>{stage.stageName}</span>
                </span>
                <div className="flex items-center gap-2 flex-1">
                  {stage.count > 0 ? (
                    <div
                      className="flex h-6 rounded-md overflow-hidden"
                      style={{ width: `${Math.max(6, (stage.count / maxCount) * 100)}%` }}
                    >
                      {segs.map((seg, i) => (
                        <div
                          key={seg.status}
                          className={`${color} h-full ${i > 0 ? "border-l border-black/25" : ""}`}
                          style={{ width: `${(seg.count / segTotal) * 100}%`, opacity: segOpacity(i) }}
                          title={`${seg.status}: ${seg.count}`}
                        />
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted/60 italic">—</span>
                  )}
                  <span className="text-[11px] text-muted shrink-0 tabular-nums">
                    <span className="text-foreground font-semibold">{stage.count}</span> · {formatCurrencyCompact(stage.amount)} · {pct}%
                  </span>
                </div>
              </button>
              {/* Per-status (or per-reason) counts, aligned under the bar. */}
              {stage.count > 0 && hasRealStatus && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-[11.75rem] pt-0.5 text-[10px] text-muted">
                  {stage.statusBreakdown.map((seg) => (
                    <span key={seg.status} className="whitespace-nowrap">
                      <span className="text-foreground/70 font-semibold tabular-nums">{seg.count}</span> {seg.status}
                    </span>
                  ))}
                </div>
              )}
              {expanded === stage.stageId && stage.deals.length > 0 && (
                <StagePositionTable deals={stage.deals} detailLabel={isReasonStage ? "Reason" : "Status"} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Drill-down table for one stage in the Current Pipeline Position chart. */
function StagePositionTable({
  deals,
  detailLabel,
}: {
  deals: ProjectFunnelStageDeal[];
  detailLabel: string;
}) {
  return (
    <div className="pl-[11.75rem] pt-1 pb-2 overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-muted border-b border-t-border">
            <th className="text-left font-medium py-1 pr-3">Project</th>
            <th className="text-left font-medium py-1 pr-3">Owner</th>
            <th className="text-left font-medium py-1 pr-3">PM</th>
            <th className="text-right font-medium py-1 pr-3">Amount</th>
            <th className="text-right font-medium py-1 pr-3">Days in stage</th>
            <th className="text-left font-medium py-1">{detailLabel}</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.id} className="border-b border-t-border/40 hover:bg-surface-2/40">
              <td className="py-1 pr-3 whitespace-nowrap">
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-foreground/90 font-medium hover:text-cyan-400">
                  {d.projectNumber || d.name}
                </a>
              </td>
              <td className="py-1 pr-3 text-muted whitespace-nowrap">{d.dealOwner || "—"}</td>
              <td className="py-1 pr-3 text-muted whitespace-nowrap">{d.projectManager || "—"}</td>
              <td className="py-1 pr-3 text-right tabular-nums text-muted whitespace-nowrap">{formatCurrencyCompact(d.amount)}</td>
              <td className="py-1 pr-3 text-right tabular-nums text-muted whitespace-nowrap">{d.daysInStage}d</td>
              <td className="py-1 text-foreground/80" title={d.notes || undefined}>
                {d.detail}
                {d.notes && <span className="text-muted/70 italic"> · {d.notes}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MILESTONE_COHORT_TIMEFRAMES = [
  { label: "Last Month", value: "last-month" },
  { label: "This Month", value: "this-month" },
  { label: "This Quarter", value: "this-quarter" },
  { label: "Last Quarter", value: "last-quarter" },
  { label: `This Year (${new Date().getFullYear()})`, value: "this-year" },
  { label: `Last Year (${new Date().getFullYear() - 1})`, value: "last-year" },
  { label: "3 months", value: "3" },
  { label: "6 months", value: "6" },
  { label: "12 months", value: "12" },
] as const;

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** One breakdown column (current stage OR furthest milestone) as a bar list. */
function BucketBars({
  title,
  subtitle,
  buckets,
  total,
  color,
}: {
  title: string;
  subtitle: string;
  buckets: MilestoneCohortBucket[];
  total: number;
  color: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="flex-1 min-w-0">
      <h4 className="text-xs font-semibold text-foreground/80">{title}</h4>
      <p className="text-[11px] text-muted mb-2">{subtitle}</p>
      {buckets.length === 0 ? (
        <p className="text-xs text-muted/60 italic">No deals in this window.</p>
      ) : (
        <div className="space-y-1.5">
          {buckets.map((b) => {
            const pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
            return (
              <div key={b.key} className="flex items-center gap-2">
                <span className="w-36 text-xs text-muted text-right shrink-0 truncate" title={b.label}>
                  {b.label}
                </span>
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <div
                    className={`${color} h-5 rounded flex items-center px-2`}
                    style={{ width: `${Math.max(6, (b.count / max) * 100)}%` }}
                  >
                    <span className="text-white text-[11px] font-semibold">{b.count}</span>
                  </div>
                  <span className="text-[11px] text-muted shrink-0">
                    {formatCurrencyCompact(b.amount)} · {pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Milestone Cohort: pick a milestone + a window on that milestone's own date,
 * then see where those deals are now — both by current pipeline stage and by
 * furthest milestone reached. Respects the page's location / PM / owner filters.
 */
function MilestoneCohortSection({
  locations,
  pms,
  owners,
}: {
  locations: string[];
  pms: string[];
  owners: string[];
}) {
  const [milestone, setMilestone] = useState<ProjectFunnelStageKey>("surveyDone");
  const [timeframe, setTimeframe] = useState<string>("last-month");

  const { start, end } = useMemo(() => {
    const r = calendarMonthRange(timeframe);
    if (r) return monthRangeToDates(r);
    const n = resolveMonths(timeframe);
    const now = new Date();
    return { start: isoDate(new Date(now.getFullYear(), now.getMonth() - n, now.getDate())), end: isoDate(now) };
  }, [timeframe]);

  const { data, isLoading, error } = useQuery<MilestoneCohortResponse>({
    queryKey: queryKeys.funnel.milestoneCohort(milestone, start, end, locations, pms, owners),
    queryFn: async () => {
      const params = new URLSearchParams({ milestone, start, end });
      if (locations.length > 0) params.set("locations", locations.join(","));
      if (pms.length > 0) params.set("pms", pms.join(","));
      if (owners.length > 0) params.set("owners", owners.join(","));
      const res = await fetch(`/api/deals/project-funnel/milestone-cohort?${params}`);
      if (!res.ok) throw new Error("Failed to fetch milestone cohort data");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const milestoneLabel = STAGE_CONFIG.find((s) => s.key === milestone)?.label || milestone;

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h3 className="text-sm font-semibold text-foreground/80">Milestone Cohort — where are they now?</h3>
        <div className="flex items-center gap-2">
          <select
            aria-label="Milestone"
            value={milestone}
            onChange={(e) => setMilestone(e.target.value as ProjectFunnelStageKey)}
            className="bg-surface-2 border border-t-border rounded-lg px-2.5 py-1.5 text-sm text-foreground/80 focus:outline-none focus:border-muted"
          >
            {STAGE_CONFIG.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <select
            aria-label="Milestone timeframe"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="bg-surface-2 border border-t-border rounded-lg px-2.5 py-1.5 text-sm text-foreground/80 focus:outline-none focus:border-muted"
          >
            {MILESTONE_COHORT_TIMEFRAMES.map((tf) => (
              <option key={tf.value} value={tf.value}>{tf.label}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted mb-4">
        Deals that reached <span className="text-foreground/80 font-medium">{milestoneLabel}</span> in the selected window, bucketed by where they sit today.
      </p>

      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <p className="text-xs text-red-400">Failed to load milestone cohort.</p>
      ) : data ? (
        <>
          <div className="mb-4 text-sm">
            <span className="font-semibold text-foreground">{data.totalCount}</span>
            <span className="text-muted"> deals · {formatCurrencyCompact(data.totalAmount)}</span>
          </div>
          {data.totalCount === 0 ? (
            <p className="text-xs text-muted/60 italic">No deals reached this milestone in the selected window.</p>
          ) : (
            <div className="flex flex-col lg:flex-row gap-6">
              <BucketBars
                title="Current pipeline stage"
                subtitle="Live HubSpot stage today"
                buckets={data.byCurrentStage}
                total={data.totalCount}
                color="bg-cyan-500"
              />
              <BucketBars
                title="Furthest milestone reached"
                subtitle="Deepest funnel milestone hit"
                buckets={data.byFurthestMilestone}
                total={data.totalCount}
                color="bg-indigo-500"
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

// useSearchParams requires a Suspense boundary.
export default function ProjectPipelineFunnelPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ProjectPipelineFunnelInner />
    </Suspense>
  );
}
