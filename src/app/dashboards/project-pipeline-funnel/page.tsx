"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
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
} from "@/lib/project-funnel-aggregation";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { resolveMonths, calendarMonthRange, monthRangeToDates } from "@/lib/dashboard-timeframe";

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
  const heroView: "cards" | "loc" = searchParams.get("hv") === "loc" ? "loc" : "cards";
  const setHeroView = useCallback((v: "cards" | "loc") => setParam("hv", v === "loc" ? "loc" : ""), [setParam]);

  const months = useMemo(() => resolveMonths(timeframe), [timeframe]);

  const locationOptions = useMemo(
    () => CANONICAL_LOCATIONS.map((loc) => ({ value: loc, label: loc })),
    []
  );

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery<ProjectFunnelResponse>({
    queryKey: queryKeys.funnel.projectPipeline(months, locations, timeframe, pms, owners),
    queryFn: async () => {
      const params = new URLSearchParams({ months: String(months) });
      if (locations.length > 0) params.set("locations", locations.join(","));
      if (pms.length > 0) params.set("pms", pms.join(","));
      if (owners.length > 0) params.set("owners", owners.join(","));
      // Calendar timeframes (This Year, Last Year, …) pass exact month bounds so
      // the server clamps to real calendar boundaries instead of N-months-back.
      const range = calendarMonthRange(timeframe);
      if (range) {
        const dates = monthRangeToDates(range);
        params.set("start", dates.start);
        params.set("end", dates.end);
      }
      const res = await fetch(`/api/deals/project-funnel?${params}`);
      if (!res.ok) throw new Error("Failed to fetch project funnel data");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
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
      </div>

      {isLoading || !s ? (
        <LoadingSpinner />
      ) : (
        <>
          {heroView === "loc" ? (
            <HeroLocationMatrix summaryByLocation={data.summaryByLocation} totalSummary={s} />
          ) : (
            <>
              {/* Pre-construction: Sales → DA Sent (4) */}
              <HeroCards summary={s} previousSummary={data.previousSummary} stages={STAGE_CONFIG.slice(0, 4)} />
              {/* Design & Permitting: DA Approved → Permits Issued (4) */}
              <HeroCards summary={s} previousSummary={data.previousSummary} stages={STAGE_CONFIG.slice(4, 8)} />
              {/* Construction & Closeout: Construction Sched → PTO Granted (4) */}
              <HeroCards summary={s} previousSummary={data.previousSummary} stages={STAGE_CONFIG.slice(8)} />
            </>
          )}

          {/* Backlog */}
          <BacklogSection summary={s} drillDown={data.drillDown} />

          {/* Funnel bars */}
          <FunnelBars summary={s} medianDays={data.medianDays} />

          {/* Cohort chart + table */}
          <MonthlyFunnelChart cohorts={data.cohorts} />
          <CohortTable cohorts={data.cohorts} />

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
  previousSummary,
  stages,
}: {
  summary: ProjectFunnelResponse["summary"];
  previousSummary?: ProjectFunnelResponse["previousSummary"];
  stages: StageConfig[];
}) {
  return (
    <div className="grid gap-4 mb-4 grid-cols-2 lg:grid-cols-4">
      {stages.map((stage) => {
        const d = summary[stage.key];
        const stageTotal = total(d);
        // Conversion chains across the full funnel order, not the local row
        // slice — so the first card in a row still divides by the stage
        // immediately above it (e.g. Construction Sched. vs Permits Issued),
        // not by Sales Closed.
        const globalIdx = STAGE_CONFIG.findIndex((c) => c.key === stage.key);
        const prevKey = globalIdx > 0 ? STAGE_CONFIG[globalIdx - 1].key : null;
        // Both rates partition the same cohort — every deal that reached the
        // prior stage (active + cancelled) — so they sum to ≤ 100%:
        //   conv%   = of that cohort, the share now active at this stage
        //   cancel% = of that cohort, the share that reached this stage but
        //             has since cancelled
        // The remainder (100% − conv − cancel) is deals lost or stuck at the
        // prior stage without reaching this one.
        const prevReached = prevKey ? total(summary[prevKey]) : 0;
        const convPct = prevReached > 0 ? Math.round((d.count / prevReached) * 100) : 0;
        // Clamp so rounding can never display a pair that exceeds 100%.
        const cancelPct = prevReached > 0
          ? Math.min(Math.round((d.cancelledCount / prevReached) * 100), 100 - convPct)
          : 0;

        const cancelRaw = d.cancelledCount > 0
          ? `${d.cancelledCount} cancelled (${formatCurrencyCompact(d.cancelledAmount)})`
          : "";
        const amountStr = formatCurrencyCompact(d.amount + d.cancelledAmount);

        // Sales Closed has no prior stage, so it has no conv/cancel rate —
        // fall back to the raw cancelled count there.
        const subtitle = stage.key === "salesClosed"
          ? [amountStr, cancelRaw].filter(Boolean).join(" · ")
          : [
              amountStr,
              `${convPct}% conv.`,
              `${cancelPct}% cancelled${d.cancelledCount > 0 ? ` (${d.cancelledCount} · ${formatCurrencyCompact(d.cancelledAmount)})` : ""}`,
            ].join(" · ");

        // Trend vs the prior equal-length period (total reaching this stage).
        const trend = previousSummary
          ? { delta: stageTotal - total(previousSummary[stage.key]), label: "vs prior" }
          : null;

        return (
          <StatCard
            key={stage.key}
            label={stage.label}
            value={stageTotal}
            subtitle={subtitle}
            color={stage.color.replace("bg-", "").replace("-500", "") as "orange"}
            trend={trend}
          />
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
}: {
  summaryByLocation: ProjectFunnelResponse["summaryByLocation"];
  totalSummary: ProjectFunnelResponse["summary"];
}) {
  const locs = sortLocationKeys(Object.keys(summaryByLocation));

  // Step conversion for a stage in a given row: active deals here as a share of
  // everything that reached the prior stage (active + cancelled). Same basis as
  // the hero cards. Null for Sales Closed (no prior stage) or an empty prior.
  const convFor = (
    row: Record<ProjectFunnelStageKey, ProjectFunnelStageData>,
    i: number
  ): number | null => {
    if (i === 0) return null;
    const prevReached = total(row[STAGE_CONFIG[i - 1].key]);
    if (prevReached === 0) return null;
    return Math.round((row[STAGE_CONFIG[i].key].count / prevReached) * 100);
  };

  const cell = (d: ProjectFunnelStageData, conv: number | null) => {
    const t = total(d);
    return t > 0 ? (
      <>
        <div className="font-semibold">{t}</div>
        <div className="text-muted">{formatCurrencyCompact(d.amount + d.cancelledAmount)}</div>
        {conv != null && <div className="text-[10px] opacity-70">{conv}% conv.</div>}
      </>
    ) : (
      <span className="text-muted/40">—</span>
    );
  };

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6 overflow-x-auto">
      <h3 className="text-sm font-semibold text-foreground/80 mb-1">Stage Counts by Location</h3>
      <p className="text-xs text-muted mb-3">% is step conversion from the prior stage (active reaching this stage ÷ total reaching the prior stage).</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-t-border">
            <th className="text-left py-2 px-2 text-muted font-medium sticky left-0 bg-surface z-10">Location</th>
            {STAGE_CONFIG.map((s) => (
              <th key={s.key} className={`text-center py-2 px-1.5 font-medium ${s.textColor} whitespace-nowrap`}>
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {locs.map((loc, i) => (
            <tr key={loc} className={`border-b border-t-border/50 ${i % 2 === 0 ? "bg-surface-2/50" : ""}`}>
              <td className="py-2 px-2 font-semibold text-foreground whitespace-nowrap sticky left-0 bg-inherit z-10">
                {loc}
              </td>
              {STAGE_CONFIG.map((stage, si) => (
                <td key={stage.key} className={`text-center py-2 px-1.5 ${stage.textColor}`}>
                  {cell(summaryByLocation[loc][stage.key], convFor(summaryByLocation[loc], si))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {locs.length > 1 && (
          <tfoot>
            <tr className="border-t-2 border-t-border font-semibold">
              <td className="py-2 px-2 text-foreground sticky left-0 bg-surface z-10">Total</td>
              {STAGE_CONFIG.map((stage, si) => (
                <td key={stage.key} className={`text-center py-2 px-1.5 ${stage.textColor}`}>
                  {cell(totalSummary[stage.key], convFor(totalSummary, si))}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
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

  type StaffCol = { key: keyof ProjectFunnelDrillDownDeal; label: string };
  const PM: StaffCol = { key: "projectManager", label: "PM" };
  const OWNER: StaffCol = { key: "dealOwner", label: "Owner" };
  const SURVEYOR: StaffCol = { key: "siteSurveyor", label: "Surveyor" };
  const DESIGN: StaffCol = { key: "designLead", label: "Design" };
  const PERMIT: StaffCol = { key: "permitLead", label: "Permit" };
  const OPS: StaffCol = { key: "operationsManager", label: "Ops Lead" };
  const INSP: StaffCol = { key: "inspectionsLead", label: "Insp. Lead" };
  const IC: StaffCol = { key: "interconnectionsLead", label: "IC Lead" };
  // Interconnection runs parallel to permitting before construction — surface
  // its status in the pre-construction backlogs so blockers are visible.
  const ICSTATUS: StaffCol = { key: "interconnectionStatus", label: "IC Status" };

  const backlogs: Array<{
    key: string;
    label: string;
    count: number;
    color: string;
    deals: ProjectFunnelDrillDownDeal[];
    staffCols: StaffCol[];
  }> = [
    { key: "awaitingSurveySchedule", label: "Awaiting Survey Sched.", count: summary.salesClosed.count - summary.surveyScheduled.count, color: "bg-orange-500", deals: drillDown.awaitingSurveySchedule, staffCols: [PM, OWNER] },
    { key: "awaitingSurvey", label: "Awaiting Survey Complete", count: summary.surveyScheduled.count - summary.surveyDone.count, color: "bg-amber-500", deals: drillDown.awaitingSurvey, staffCols: [PM, OWNER, SURVEYOR] },
    { key: "awaitingDaSend", label: "Awaiting DA Send", count: summary.surveyDone.count - summary.daSent.count, color: "bg-lime-500", deals: drillDown.awaitingDaSend, staffCols: [PM, OWNER, DESIGN] },
    { key: "awaitingApproval", label: "Awaiting DA Approval", count: summary.daSent.count - summary.daApproved.count, color: "bg-blue-500", deals: drillDown.awaitingApproval, staffCols: [PM, OWNER, DESIGN] },
    { key: "awaitingDesignComplete", label: "Awaiting Design Complete", count: summary.daApproved.count - summary.designCompleted.count, color: "bg-indigo-500", deals: drillDown.awaitingDesignComplete, staffCols: [PM, OWNER, DESIGN] },
    { key: "awaitingPermitSubmit", label: "Awaiting Permit Submit", count: summary.designCompleted.count - summary.permitsSubmitted.count, color: "bg-purple-500", deals: drillDown.awaitingPermitSubmit, staffCols: [PM, OWNER, PERMIT, ICSTATUS] },
    { key: "awaitingPermitIssue", label: "Awaiting Permit Issue", count: summary.permitsSubmitted.count - summary.permitsIssued.count, color: "bg-violet-500", deals: drillDown.awaitingPermitIssue, staffCols: [PM, OWNER, PERMIT, ICSTATUS] },
    { key: "awaitingConstructionSchedule", label: "Awaiting Constr. Sched.", count: summary.permitsIssued.count - summary.constructionScheduled.count, color: "bg-cyan-500", deals: drillDown.awaitingConstructionSchedule, staffCols: [PM, OWNER, OPS, ICSTATUS] },
    { key: "awaitingConstructionComplete", label: "Awaiting Constr. Complete", count: summary.constructionScheduled.count - summary.constructionComplete.count, color: "bg-green-500", deals: drillDown.awaitingConstructionComplete, staffCols: [PM, OWNER, OPS] },
    { key: "awaitingInspection", label: "Awaiting Inspection", count: summary.constructionComplete.count - summary.inspectionPassed.count, color: "bg-emerald-500", deals: drillDown.awaitingInspection, staffCols: [PM, OWNER, INSP] },
    { key: "awaitingPto", label: "Awaiting PTO", count: summary.inspectionPassed.count - summary.ptoGranted.count, color: "bg-teal-500", deals: drillDown.awaitingPto, staffCols: [PM, OWNER, IC] },
    { key: "awaitingCloseOut", label: "Awaiting Close Out", count: drillDown.awaitingCloseOut.length, color: "bg-sky-500", deals: drillDown.awaitingCloseOut, staffCols: [PM, OWNER] },
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
              <DrillDownTable deals={b.deals} staffCols={b.staffCols} />
            )}
          </div>
        ))}
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
}: {
  deals: ProjectFunnelDrillDownDeal[];
  staffCols?: Array<{ key: keyof ProjectFunnelDrillDownDeal; label: string }>;
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
    // Conversion is computed on active deals only — cancelled excluded.
    const prevActive = summary[prevStage.key].count;
    const curActive = summary[stage.key].count;
    return {
      pct: prevActive > 0 ? Math.round((curActive / prevActive) * 100) : 0,
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

// useSearchParams requires a Suspense boundary.
export default function ProjectPipelineFunnelPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ProjectPipelineFunnelInner />
    </Suspense>
  );
}
