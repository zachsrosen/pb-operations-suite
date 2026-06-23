"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatCard } from "@/components/ui/MetricCard";
import { formatCurrencyCompact } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type {
  ProjectFunnelResponse,
  ProjectMonthlyActivity,
  MilestoneCohort,
  CohortDrillDeal,
} from "@/lib/project-funnel-aggregation";

// Major-milestone palette for the Lifecycle view, ordered off-track → furthest.
// Keys double as the pipeline order for the legend + stack.
const LIFECYCLE_STAGE_COLORS: Record<string, string> = {
  Cancelled: "bg-red-500/80",
  "On Hold": "bg-yellow-500",
  Sold: "bg-zinc-500",
  "Design Approved": "bg-blue-500",
  "Construction Complete": "bg-green-500",
  "Inspection Passed": "bg-emerald-500",
  "PTO Granted": "bg-teal-500",
};
const stageColor = (name: string) => LIFECYCLE_STAGE_COLORS[name] || "bg-zinc-500";

// Week-start "YYYY-MM-DD" → "Mon D" (e.g. "Jan 19"), matching the PE chart.
function weekLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}`;
}

// Taller plot + dollar Y-axis + full-width weekly bars — matches the PE
// Analytics cohort chart's density and readability.
const BAR_AREA_H = 360;
const BAR_LABEL_H = 40;

interface BarSegment {
  key: string;
  className: string;
  amount: number;
  title?: string;
}
interface BarDatum {
  month: string;
  totalAmount: number;
  total: number;
  title: string;
  /** Stacked top → bottom. */
  segments: BarSegment[];
}

/** Shared revenue-scaled stacked bar chart: dollar Y-axis, weekly bars that
 * fill the width, click-to-drill-down. */
function ScaledBars({
  data,
  maxAmount,
  selected,
  onSelect,
}: {
  data: BarDatum[];
  maxAmount: number;
  selected: string | null;
  onSelect: (bucket: string) => void;
}) {
  // Thin out x-axis labels when there are many weeks so they don't collide.
  const labelStep = Math.max(1, Math.ceil(data.length / 26));
  return (
    <div className="flex gap-2">
      {/* Dollar Y-axis, aligned to the gridlines. */}
      <div className="relative w-11 shrink-0" style={{ marginTop: BAR_LABEL_H, height: BAR_AREA_H }}>
        {[1, 0.75, 0.5, 0.25, 0].map((f) => (
          <span
            key={f}
            className="absolute right-1 -translate-y-1/2 text-[9px] text-muted/70 tabular-nums"
            style={{ top: `${(1 - f) * 100}%` }}
          >
            {f === 0 ? "$0" : formatCurrencyCompact(maxAmount * f)}
          </span>
        ))}
      </div>
      <div className="relative flex-1 min-w-0">
        <div className="absolute inset-x-0 pointer-events-none" style={{ top: BAR_LABEL_H, height: BAR_AREA_H }}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <div key={f} className="absolute inset-x-0 border-t border-t-border/40" style={{ top: `${f * 100}%` }} />
          ))}
        </div>
        <div className="relative flex items-end justify-between gap-0.5 sm:gap-1">
          {data.map((row, i) => {
            const heightPct = (row.totalAmount / maxAmount) * 100;
            const segPct = (amount: number) => (row.totalAmount > 0 ? (amount / row.totalAmount) * 100 : 0);
            const isSel = selected === row.month;
            return (
              <button
                type="button"
                key={row.month}
                onClick={() => onSelect(row.month)}
                className={`flex flex-col items-center gap-1.5 flex-1 min-w-0 group rounded-md px-0.5 transition-colors ${isSel ? "bg-surface-2" : "hover:bg-surface-2/40"}`}
                title={row.title}
              >
                <div className="flex flex-col items-center leading-tight justify-end pb-0.5" style={{ height: BAR_LABEL_H }}>
                  {row.total > 0 && <span className="text-[10px] text-muted tabular-nums">{row.total}</span>}
                </div>
                <div className="w-full flex justify-center border-b border-t-border" style={{ height: BAR_AREA_H }}>
                  <div
                    className={`w-full max-w-[34px] mt-auto flex flex-col rounded-t-md overflow-hidden transition-all duration-300 ${isSel ? "opacity-100 ring-1 ring-emerald-400/60" : "opacity-90 group-hover:opacity-100"}`}
                    style={{ height: `${Math.max(heightPct, row.totalAmount > 0 ? 1.5 : 0)}%` }}
                  >
                    {row.segments.map((s) =>
                      s.amount > 0 ? (
                        <div key={s.key} className={`${s.className} w-full`} style={{ height: `${segPct(s.amount)}%` }} title={s.title} />
                      ) : null
                    )}
                  </div>
                </div>
                <span className="text-[9px] text-muted truncate h-3">
                  {i % labelStep === 0 ? weekLabel(row.month) : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import { resolveMonths, calendarMonthRange, monthRangeToDates } from "@/lib/dashboard-timeframe";

const THROUGHPUT_TIMEFRAMES = [
  { label: `This Year (${new Date().getFullYear()})`, value: "this-year" },
  { label: `Last Year (${new Date().getFullYear() - 1})`, value: "last-year" },
  { label: "This Quarter", value: "this-quarter" },
  { label: "Last Quarter", value: "last-quarter" },
  { label: "6 months", value: "6" },
  { label: "12 months", value: "12" },
  { label: "24 months", value: "24" },
] as const;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(month: string, includeYear = true): string {
  const [y, m] = month.split("-");
  return includeYear ? `${MONTH_NAMES[parseInt(m) - 1]} ${y}` : `${MONTH_NAMES[parseInt(m) - 1]} ${y.slice(2)}`;
}

/**
 * Throughput columns: every milestone counted by the month it actually
 * occurred, across ALL deals regardless of when they were sold.
 */
const ACTIVITY_COLUMNS: Array<{
  key: keyof ProjectMonthlyActivity;
  label: string;
  color: string;
  /** Literal bar class so Tailwind always generates it (don't derive at runtime). */
  bar: string;
  amountKey?: keyof ProjectMonthlyActivity;
}> = [
  { key: "salesClosed", label: "Sales Closed", color: "text-orange-400", bar: "bg-orange-500", amountKey: "salesClosedAmount" },
  { key: "surveysScheduled", label: "Surveys Scheduled", color: "text-amber-400", bar: "bg-amber-500", amountKey: "surveysScheduledAmount" },
  { key: "surveysCompleted", label: "Surveys Complete", color: "text-yellow-400", bar: "bg-yellow-500", amountKey: "surveysCompletedAmount" },
  { key: "dasSent", label: "DAs Sent", color: "text-lime-400", bar: "bg-lime-500", amountKey: "dasSentAmount" },
  { key: "dasApproved", label: "DAs Approved", color: "text-blue-400", bar: "bg-blue-500", amountKey: "dasApprovedAmount" },
  { key: "designsCompleted", label: "Designs Done", color: "text-indigo-400", bar: "bg-indigo-500", amountKey: "designsCompletedAmount" },
  { key: "permitsSubmitted", label: "Permits Submitted", color: "text-purple-400", bar: "bg-purple-500", amountKey: "permitsSubmittedAmount" },
  { key: "permitsIssued", label: "Permits Issued", color: "text-violet-400", bar: "bg-violet-500", amountKey: "permitsIssuedAmount" },
  { key: "icSubmitted", label: "IC Submitted", color: "text-fuchsia-400", bar: "bg-fuchsia-500", amountKey: "icSubmittedAmount" },
  { key: "icApproved", label: "IC Approved", color: "text-pink-400", bar: "bg-pink-500", amountKey: "icApprovedAmount" },
  { key: "constructionsScheduled", label: "Construction Scheduled", color: "text-cyan-400", bar: "bg-cyan-500", amountKey: "constructionsScheduledAmount" },
  { key: "constructionsComplete", label: "Construction Complete", color: "text-green-400", bar: "bg-green-500", amountKey: "constructionsCompleteAmount" },
  { key: "inspectionsPassed", label: "Inspections", color: "text-emerald-400", bar: "bg-emerald-500", amountKey: "inspectionsPassedAmount" },
  { key: "ptosGranted", label: "PTOs", color: "text-teal-400", bar: "bg-teal-500", amountKey: "ptosGrantedAmount" },
  { key: "closedOut", label: "Closed Out", color: "text-sky-400", bar: "bg-sky-500", amountKey: "closedOutAmount" },
  { key: "cancelled", label: "Cancelled", color: "text-red-400", bar: "bg-red-500", amountKey: "cancelledAmount" },
];

/** Hero cards — the milestones teams most often track output against. */
const HERO_KEYS: Array<{ key: keyof ProjectMonthlyActivity; label: string; color: string; amountKey?: keyof ProjectMonthlyActivity }> = [
  { key: "salesClosed", label: "Sales Closed", color: "orange", amountKey: "salesClosedAmount" },
  { key: "surveysCompleted", label: "Surveys Complete", color: "yellow", amountKey: "surveysCompletedAmount" },
  { key: "dasApproved", label: "DAs Approved", color: "blue", amountKey: "dasApprovedAmount" },
  { key: "designsCompleted", label: "Designs Done", color: "indigo", amountKey: "designsCompletedAmount" },
  { key: "permitsIssued", label: "Permits Issued", color: "purple", amountKey: "permitsIssuedAmount" },
  { key: "constructionsComplete", label: "Construction Complete", color: "green", amountKey: "constructionsCompleteAmount" },
  { key: "inspectionsPassed", label: "Inspections", color: "emerald", amountKey: "inspectionsPassedAmount" },
  { key: "ptosGranted", label: "PTOs Granted", color: "teal", amountKey: "ptosGrantedAmount" },
];

type Totals = Record<keyof ProjectMonthlyActivity, number>;

function sumTotals(rows: ProjectMonthlyActivity[]): Totals {
  const totals = {} as Totals;
  for (const row of rows) {
    for (const k of Object.keys(row) as Array<keyof ProjectMonthlyActivity>) {
      if (k === "month") continue;
      totals[k] = (totals[k] || 0) + (row[k] as number);
    }
  }
  return totals;
}

function sortLocationKeys(keys: string[]): string[] {
  const order = new Map<string, number>(CANONICAL_LOCATIONS.map((l, i) => [l, i]));
  return [...keys].sort(
    (a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b)
  );
}

/**
 * Monthly Activity (throughput) view, driven by the shared project-funnel
 * response. Counts every milestone by the month it actually happened, across
 * all deals — throughput, not a sales-cohort funnel.
 */
export function MonthlyActivityView({
  data,
  timeframe,
  locations,
  pms,
  owners,
}: {
  data: ProjectFunnelResponse;
  timeframe: string;
  locations: string[];
  pms: string[];
  owners: string[];
}) {
  const [heroView, setHeroView] = useState<"cards" | "loc">("cards");

  // Calendar timeframes are clamped to exact month boundaries so the rolling
  // fetch window doesn't bleed in an extra month.
  const activity = useMemo(() => {
    const rows = data.monthlyActivity ?? [];
    const range = calendarMonthRange(timeframe);
    if (!range) return rows;
    return rows.filter((r) => r.month >= range.start && r.month <= range.end);
  }, [data, timeframe]);
  const totals = useMemo(() => sumTotals(activity), [activity]);

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-xs text-muted max-w-3xl">
          Counts every milestone by the month it <span className="text-foreground font-medium">actually happened</span> —
          regardless of when the deal was sold. This is throughput, not a sales-cohort funnel.
        </p>
        <div className="flex rounded-lg border border-t-border overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setHeroView("cards")}
            className={`px-3 py-1.5 transition-colors ${heroView === "cards" ? "bg-emerald-500 text-white" : "bg-surface text-muted hover:text-foreground"}`}
          >
            Cards
          </button>
          <button
            type="button"
            onClick={() => setHeroView("loc")}
            className={`px-3 py-1.5 transition-colors ${heroView === "loc" ? "bg-emerald-500 text-white" : "bg-surface text-muted hover:text-foreground"}`}
          >
            By location
          </button>
        </div>
      </div>

      {heroView === "loc" ? (
        <ActivityByLocationMatrix activityByLocation={data.activityByLocation} totals={totals} />
      ) : (
        <div className="grid gap-4 mb-6 grid-cols-2 lg:grid-cols-4">
          {HERO_KEYS.map((h) => {
            const count = totals[h.key] || 0;
            const amount = h.amountKey ? totals[h.amountKey] || 0 : 0;
            return (
              <StatCard
                key={h.key}
                label={h.label}
                value={count}
                subtitle={h.amountKey && amount > 0 ? formatCurrencyCompact(amount) : null}
                color={h.color}
              />
            );
          })}
        </div>
      )}

      <ThroughputChart locations={locations} pms={pms} owners={owners} />

      <MilestoneCohortChart locations={locations} pms={pms} owners={owners} />

      <MonthlyActivityTable activity={activity} totals={totals} />
    </>
  );
}

/** Throughput by location — rows = PB locations, cols = the hero throughput metrics. */
function ActivityByLocationMatrix({
  activityByLocation,
  totals,
}: {
  activityByLocation: ProjectFunnelResponse["activityByLocation"];
  totals: Totals;
}) {
  // Every deal should carry a PB location; drop the "Unknown" catch-all row.
  const locs = sortLocationKeys(Object.keys(activityByLocation).filter((k) => k !== "Unknown"));
  const renderCell = (count: number, amount: number, showAmount: boolean) =>
    count > 0 ? (
      <>
        <div className="font-semibold text-foreground">{count}</div>
        {showAmount && amount > 0 && <div className="text-muted">{formatCurrencyCompact(amount)}</div>}
      </>
    ) : (
      <span className="text-muted/40">—</span>
    );

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6 overflow-x-auto">
      <h3 className="text-sm font-semibold text-foreground/80 mb-3">Throughput by Location</h3>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-t-border">
            <th className="text-left py-2 px-2 text-muted font-medium sticky left-0 bg-surface z-10">Location</th>
            {HERO_KEYS.map((c) => (
              <th key={c.key} className="text-center py-2 px-1.5 font-medium text-muted whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {locs.map((loc, i) => {
            const row = activityByLocation[loc];
            return (
              <tr key={loc} className={`border-b border-t-border/50 ${i % 2 === 0 ? "bg-surface-2/50" : ""}`}>
                <td className="py-2 px-2 font-semibold text-foreground whitespace-nowrap sticky left-0 bg-inherit z-10">
                  {loc}
                </td>
                {HERO_KEYS.map((c) => (
                  <td key={c.key} className="text-center py-2 px-1.5">
                    {renderCell(
                      (row[c.key] as number) || 0,
                      c.amountKey ? (row[c.amountKey] as number) || 0 : 0,
                      !!c.amountKey
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {locs.length > 1 && (
          <tfoot>
            <tr className="border-t-2 border-t-border font-semibold">
              <td className="py-2 px-2 text-foreground sticky left-0 bg-surface z-10">Total</td>
              {HERO_KEYS.map((c) => (
                <td key={c.key} className="text-center py-2 px-1.5">
                  {renderCell(totals[c.key] || 0, c.amountKey ? totals[c.amountKey] || 0 : 0, !!c.amountKey)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * Self-contained throughput chart with its own timeframe (default This Year),
 * independent of the tab. Each bar shows count AND revenue together for the
 * selected milestone, by the month it happened.
 */
function ThroughputChart({
  locations,
  pms,
  owners,
}: {
  locations: string[];
  pms: string[];
  owners: string[];
}) {
  const [metric, setMetric] = useState<keyof ProjectMonthlyActivity>("dasApproved");
  const [timeframe, setTimeframe] = useState<string>("this-year");

  const months = resolveMonths(timeframe);
  const { data, isLoading } = useQuery<ProjectFunnelResponse>({
    queryKey: [...queryKeys.funnel.root, "throughput", months, timeframe, locations, pms, owners],
    queryFn: async () => {
      const params = new URLSearchParams({ months: String(months) });
      if (locations.length > 0) params.set("locations", locations.join(","));
      if (pms.length > 0) params.set("pms", pms.join(","));
      if (owners.length > 0) params.set("owners", owners.join(","));
      const range = calendarMonthRange(timeframe);
      if (range) {
        const dates = monthRangeToDates(range);
        params.set("start", dates.start);
        params.set("end", dates.end);
      }
      const res = await fetch(`/api/deals/project-funnel?${params}`);
      if (!res.ok) throw new Error("Failed to fetch throughput data");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const activity = useMemo(() => {
    const rows = data?.monthlyActivity ?? [];
    const range = calendarMonthRange(timeframe);
    if (!range) return rows;
    return rows.filter((r) => r.month >= range.start && r.month <= range.end);
  }, [data, timeframe]);

  const chronological = useMemo(() => [...activity].reverse(), [activity]);
  const col = ACTIVITY_COLUMNS.find((c) => c.key === metric) ?? ACTIVITY_COLUMNS[0];
  const barColor = col.bar;
  const amountKey = col.amountKey;
  const maxValue = useMemo(
    () => Math.max(1, ...chronological.map((c) => c[metric] as number)),
    [chronological, metric]
  );

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground/80">Monthly Throughput</h3>
          <p className="text-[11px] text-muted">Count (bar height) and revenue per month — own timeframe.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as keyof ProjectMonthlyActivity)}
            className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-xs text-foreground"
          >
            {ACTIVITY_COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-xs text-foreground"
          >
            {THROUGHPUT_TIMEFRAMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted/60 italic">Loading…</p>
      ) : chronological.length === 0 ? (
        <p className="text-xs text-muted/60 italic">No activity in this window.</p>
      ) : (
        // Columns cap their width and center as a group, so a short window
        // (e.g. one quarter = 3 bars) reads as a tight cluster instead of a few
        // skinny bars lost in an empty box. Faint gridlines + baseline anchor
        // the bar heights.
        <div className="relative">
          <div className="absolute inset-x-0 top-[46px] bottom-[18px] pointer-events-none">
            {[0, 1, 2, 3].map((g) => (
              <div key={g} className="absolute inset-x-0 border-t border-t-border/40" style={{ top: `${g * 33.33}%` }} />
            ))}
          </div>
          <div className="relative flex items-end justify-center gap-3 sm:gap-5">
            {chronological.map((row) => {
              const count = row[metric] as number;
              const revenue = amountKey ? (row[amountKey] as number) : 0;
              const heightPct = (count / maxValue) * 100;
              return (
                <div
                  key={row.month}
                  className="flex flex-col items-center gap-1.5 flex-1 min-w-0 max-w-[88px] group"
                  title={`${monthLabel(row.month)}: ${count} · ${formatCurrencyCompact(revenue)}`}
                >
                  <div className="flex flex-col items-center leading-tight h-[40px] justify-end pb-0.5">
                    <span className="text-sm text-foreground font-bold tabular-nums">{count > 0 ? count : ""}</span>
                    {amountKey && revenue > 0 && (
                      <span className="text-[10px] text-muted tabular-nums">{formatCurrencyCompact(revenue)}</span>
                    )}
                  </div>
                  <div className="w-full flex justify-center border-b border-t-border" style={{ height: 130 }}>
                    <div
                      className={`${barColor} rounded-t-md w-9 sm:w-11 transition-all duration-300 mt-auto opacity-90 group-hover:opacity-100`}
                      style={{ height: `${Math.max(heightPct, count > 0 ? 3 : 0)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted truncate">{monthLabel(row.month, false)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Milestone-progression cohorts. Each bar = everyone who hit the selected
 * milestone that month; the bar's height encodes the cohort's revenue, split
 * bottom-up into deals that have SINCE advanced to the next milestone
 * (emerald), are still waiting (gray), or have cancelled (red). Inspired by the
 * PE Analytics "Ready-to-Submit Cohorts" chart. Own milestone + timeframe.
 */
function MilestoneCohortChart({
  locations,
  pms,
  owners,
}: {
  locations: string[];
  pms: string[];
  owners: string[];
}) {
  const [view, setView] = useState<"milestone" | "lifecycle">("milestone");
  const [milestone, setMilestone] = useState<string>("salesClosed");
  const [timeframe, setTimeframe] = useState<string>("this-year");
  // Week bucket the user clicked to drill into (null = none open).
  const [selected, setSelected] = useState<string | null>(null);

  const months = resolveMonths(timeframe);
  const { data, isLoading } = useQuery<ProjectFunnelResponse>({
    queryKey: [...queryKeys.funnel.root, "cohort-progression", months, timeframe, locations, pms, owners],
    queryFn: async () => {
      const params = new URLSearchParams({ months: String(months) });
      if (locations.length > 0) params.set("locations", locations.join(","));
      if (pms.length > 0) params.set("pms", pms.join(","));
      if (owners.length > 0) params.set("owners", owners.join(","));
      const range = calendarMonthRange(timeframe);
      if (range) {
        const dates = monthRangeToDates(range);
        params.set("start", dates.start);
        params.set("end", dates.end);
      }
      const res = await fetch(`/api/deals/project-funnel?${params}`);
      if (!res.ok) throw new Error("Failed to fetch cohort progression data");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const cohorts: MilestoneCohort[] = data?.milestoneCohorts ?? [];
  const cohort = cohorts.find((c) => c.key === milestone) ?? cohorts[0];

  // Server already windows to the timeframe; keys are week-start dates, so just
  // flip to chronological (oldest → newest) for the left-to-right axis.
  const chronological = useMemo(() => [...(cohort?.months ?? [])].reverse(), [cohort]);

  const maxAmount = useMemo(
    () => Math.max(1, ...chronological.map((c) => c.totalAmount)),
    [chronological]
  );

  // Lifecycle: deals grouped by sold-week, stacked by current stage.
  const lifecycle = useMemo(() => [...(data?.lifecycle ?? [])].reverse(), [data]);
  const lifecycleMax = useMemo(
    () => Math.max(1, ...lifecycle.map((c) => c.totalAmount)),
    [lifecycle]
  );
  // Stages actually present, ordered by pipeline progression, for the legend.
  const lifecycleStages = useMemo(() => {
    const order = Object.keys(LIFECYCLE_STAGE_COLORS);
    const seen = new Set<string>();
    for (const m of lifecycle) for (const s of m.stages) seen.add(s.stageName);
    return [...seen].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [lifecycle]);

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground/80">
            {view === "milestone" ? "Milestone Progression" : "Sold-Week Lifecycle"}
          </h3>
          <p className="text-[11px] text-muted">
            {view === "milestone"
              ? "Each bar is every deal that reached the selected milestone that week; the highlighted share has since reached the next one. Click a bar for the deals."
              : "Each bar is every deal sold that week, stacked by the furthest major milestone it's reached. Click a bar for the deals."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-t-border overflow-hidden text-xs">
            {(["milestone", "lifecycle"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setView(v);
                  setSelected(null);
                }}
                className={`px-3 py-1.5 transition-colors ${view === v ? "bg-emerald-500 text-white" : "bg-surface text-muted hover:text-foreground"}`}
              >
                {v === "milestone" ? "By Milestone" : "Lifecycle"}
              </button>
            ))}
          </div>
          <select
            value={timeframe}
            onChange={(e) => {
              setTimeframe(e.target.value);
              setSelected(null);
            }}
            className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-xs text-foreground"
          >
            {THROUGHPUT_TIMEFRAMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {view === "milestone" && (
        <>
          {/* Milestone selector — PE-style pills, one per step in the chain. */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {cohorts.map((c) => {
              const active = (cohort?.key ?? milestone) === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => {
                    setMilestone(c.key);
                    setSelected(null);
                  }}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    active
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : "bg-surface-2 border-t-border text-muted hover:text-foreground hover:border-emerald-500/40"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>

          {/* Explicit "what the bar means" callout, driven by the selected milestone. */}
          {cohort && (
            <p className="text-xs text-muted mb-3">
              Whole bar ={" "}
              <span className="text-foreground font-semibold">{cohort.label}</span> that week · highlighted ={" "}
              <span className="text-emerald-400 font-semibold">also reached {cohort.nextLabel}</span>
            </p>
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
              Reached {cohort?.nextLabel ?? "next"}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-zinc-500" />
              {cohort ? `${cohort.label}, not yet ${cohort.nextLabel}` : "Still waiting"}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-yellow-500" />
              On hold
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-red-500/80" />
              Cancelled
            </span>
          </div>
        </>
      )}

      {view === "lifecycle" && lifecycleStages.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 text-[11px] text-muted">
          {lifecycleStages.map((name) => (
            <span key={name} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-sm ${stageColor(name)}`} />
              {name}
            </span>
          ))}
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted/60 italic">Loading…</p>
      ) : view === "milestone" ? (
        chronological.length === 0 ? (
          <p className="text-xs text-muted/60 italic">No activity in this window.</p>
        ) : (
          <ScaledBars
            maxAmount={maxAmount}
            selected={selected}
            onSelect={(b) => setSelected(selected === b ? null : b)}
            data={chronological.map((row) => {
              const rate = row.total > 0 ? Math.round((row.advanced / row.total) * 100) : 0;
              return {
                month: row.month,
                totalAmount: row.totalAmount,
                total: row.total,
                title:
                  `${weekLabel(row.month)}: ${formatCurrencyCompact(row.totalAmount)} · ${row.total} deals\n` +
                  `Reached ${cohort?.nextLabel}: ${row.advanced} (${rate}%)\n` +
                  `Waiting: ${row.waiting} · On hold: ${row.onHold} · Cancelled: ${row.cancelled}`,
                segments: [
                  { key: "cancelled", className: "bg-red-500/80", amount: row.cancelledAmount, title: `Cancelled: ${row.cancelled}` },
                  { key: "onHold", className: "bg-yellow-500", amount: row.onHoldAmount, title: `On hold: ${row.onHold}` },
                  { key: "waiting", className: "bg-zinc-500", amount: row.waitingAmount, title: `${cohort?.label}, not yet ${cohort?.nextLabel}: ${row.waiting}` },
                  { key: "advanced", className: "bg-emerald-500", amount: row.advancedAmount, title: `Reached ${cohort?.nextLabel}: ${row.advanced}` },
                ],
              };
            })}
          />
        )
      ) : lifecycle.length === 0 ? (
        <p className="text-xs text-muted/60 italic">No deals sold in this window.</p>
      ) : (
        <ScaledBars
          maxAmount={lifecycleMax}
          selected={selected}
          onSelect={(b) => setSelected(selected === b ? null : b)}
          data={lifecycle.map((row) => ({
            month: row.month,
            totalAmount: row.totalAmount,
            total: row.total,
            title:
              `${weekLabel(row.month)} sold: ${formatCurrencyCompact(row.totalAmount)} · ${row.total} deals\n` +
              row.stages.map((s) => `${s.stageName}: ${s.count}`).join("\n"),
            segments: row.stages.map((s) => ({
              key: s.stageId,
              className: stageColor(s.stageName),
              amount: s.amount,
              title: `${s.stageName}: ${s.count} · ${formatCurrencyCompact(s.amount)}`,
            })),
          }))}
        />
      )}

      {selected &&
        (() => {
          // Build the drill rows for the open week from whichever view is active.
          type DrillRow = {
            id: string;
            name: string;
            projectNumber: string;
            amount: number;
            url: string;
            stage: string;
            location: string;
            pm: string;
            tag: string;
            tagClass: string;
          };
          const base = (d: CohortDrillDeal) => ({
            id: d.id,
            name: d.name,
            projectNumber: d.projectNumber,
            amount: d.amount,
            url: d.url,
            stage: d.stage,
            location: d.location,
            pm: d.pm,
          });
          const rows: DrillRow[] =
            view === "milestone"
              ? (cohort?.months.find((m) => m.month === selected)?.deals ?? []).map((d) => ({
                  ...base(d),
                  tag:
                    d.seg === "advanced"
                      ? `Reached ${cohort?.nextLabel}`
                      : d.seg === "cancelled"
                        ? "Cancelled"
                        : d.seg === "onHold"
                          ? "On hold"
                          : `Not yet ${cohort?.nextLabel}`,
                  tagClass:
                    d.seg === "advanced"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : d.seg === "cancelled"
                        ? "bg-red-500/20 text-red-300"
                        : d.seg === "onHold"
                          ? "bg-yellow-500/20 text-yellow-300"
                          : "bg-zinc-500/20 text-zinc-300",
                }))
              : (lifecycle.find((m) => m.month === selected)?.stages ?? []).flatMap((s) =>
                  s.deals.map((d) => ({ ...base(d), tag: s.stageName, tagClass: "bg-surface-2 text-muted" }))
                );
          const sorted = [...rows].sort((a, b) => b.amount - a.amount);
          return (
            <div className="mt-4 border-t border-t-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-foreground/80">
                  Week of {weekLabel(selected)} · {sorted.length} {sorted.length === 1 ? "deal" : "deals"}
                  {view === "milestone" ? ` — ${cohort?.label}` : " sold"}
                </h4>
                <button type="button" onClick={() => setSelected(null)} className="text-[11px] text-muted hover:text-foreground">
                  Close ✕
                </button>
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted border-b border-t-border">
                      <th className="text-left font-medium py-1 pr-3">Project</th>
                      <th className="text-left font-medium py-1 pr-3">{view === "milestone" ? "Status" : "Stage"}</th>
                      {view === "milestone" && <th className="text-left font-medium py-1 pr-3">Current stage</th>}
                      <th className="text-left font-medium py-1 pr-3">Location</th>
                      <th className="text-left font-medium py-1 pr-3">PM</th>
                      <th className="text-right font-medium py-1">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={`${r.id}-${r.tag}`} className="border-b border-t-border/40 hover:bg-surface-2/40">
                        <td className="py-1 pr-3 max-w-[22rem]">
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={r.name}
                            className="text-foreground/90 font-medium hover:text-cyan-400 truncate block"
                          >
                            {r.name}
                          </a>
                        </td>
                        <td className="py-1 pr-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${r.tagClass}`}>{r.tag}</span>
                        </td>
                        {view === "milestone" && <td className="py-1 pr-3 text-muted whitespace-nowrap">{r.stage}</td>}
                        <td className="py-1 pr-3 text-muted whitespace-nowrap">{r.location}</td>
                        <td className="py-1 pr-3 text-muted whitespace-nowrap">{r.pm}</td>
                        <td className="py-1 text-right tabular-nums text-muted whitespace-nowrap">{formatCurrencyCompact(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

function MonthlyActivityTable({
  activity,
  totals,
}: {
  activity: ProjectMonthlyActivity[];
  totals: Totals;
}) {
  return (
    <div className="bg-surface rounded-xl border border-t-border p-5">
      <h3 className="text-sm font-semibold text-foreground/80 mb-1">Monthly Breakdown</h3>
      <p className="text-xs text-muted mb-4">
        Sales Closed by close date · Closed Out &amp; Cancelled by date entered stage — all other milestones by the
        month they happened
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
          {activity.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-t-border font-semibold">
                <td className="py-2 px-2 text-foreground sticky left-0 bg-surface z-10">Total</td>
                {ACTIVITY_COLUMNS.map((col) => {
                  const count = totals[col.key] || 0;
                  const amount = col.amountKey ? totals[col.amountKey] || 0 : 0;
                  return (
                    <td key={col.key} className="text-center py-2 px-1.5">
                      {count > 0 ? (
                        <>
                          <div className={col.color}>{count}</div>
                          {col.amountKey && amount > 0 && (
                            <div className="text-muted font-normal">{formatCurrencyCompact(amount)}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted/40">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
