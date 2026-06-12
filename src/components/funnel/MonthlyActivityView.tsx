"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatCard } from "@/components/ui/MetricCard";
import { formatCurrencyCompact } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type {
  ProjectFunnelResponse,
  ProjectMonthlyActivity,
} from "@/lib/project-funnel-aggregation";
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
  { key: "surveysCompleted", label: "Surveys Done", color: "text-yellow-400", bar: "bg-yellow-500", amountKey: "surveysCompletedAmount" },
  { key: "dasSent", label: "DAs Sent", color: "text-lime-400", bar: "bg-lime-500", amountKey: "dasSentAmount" },
  { key: "dasApproved", label: "DAs Approved", color: "text-blue-400", bar: "bg-blue-500", amountKey: "dasApprovedAmount" },
  { key: "designsCompleted", label: "Designs Done", color: "text-indigo-400", bar: "bg-indigo-500", amountKey: "designsCompletedAmount" },
  { key: "permitsSubmitted", label: "Permits Submitted", color: "text-purple-400", bar: "bg-purple-500", amountKey: "permitsSubmittedAmount" },
  { key: "permitsIssued", label: "Permits Issued", color: "text-violet-400", bar: "bg-violet-500", amountKey: "permitsIssuedAmount" },
  { key: "icSubmitted", label: "IC Submitted", color: "text-fuchsia-400", bar: "bg-fuchsia-500", amountKey: "icSubmittedAmount" },
  { key: "icApproved", label: "IC Approved", color: "text-pink-400", bar: "bg-pink-500", amountKey: "icApprovedAmount" },
  { key: "constructionsScheduled", label: "Construction Scheduled", color: "text-cyan-400", bar: "bg-cyan-500", amountKey: "constructionsScheduledAmount" },
  { key: "constructionsComplete", label: "Construction Done", color: "text-green-400", bar: "bg-green-500", amountKey: "constructionsCompleteAmount" },
  { key: "inspectionsPassed", label: "Inspections", color: "text-emerald-400", bar: "bg-emerald-500", amountKey: "inspectionsPassedAmount" },
  { key: "ptosGranted", label: "PTOs", color: "text-teal-400", bar: "bg-teal-500", amountKey: "ptosGrantedAmount" },
  { key: "closedOut", label: "Closed Out", color: "text-sky-400", bar: "bg-sky-500", amountKey: "closedOutAmount" },
  { key: "cancelled", label: "Cancelled", color: "text-red-400", bar: "bg-red-500", amountKey: "cancelledAmount" },
];

/** Hero cards — the milestones teams most often track output against. */
const HERO_KEYS: Array<{ key: keyof ProjectMonthlyActivity; label: string; color: string; amountKey?: keyof ProjectMonthlyActivity }> = [
  { key: "salesClosed", label: "Sales Closed", color: "orange", amountKey: "salesClosedAmount" },
  { key: "surveysCompleted", label: "Surveys Done", color: "yellow", amountKey: "surveysCompletedAmount" },
  { key: "dasApproved", label: "DAs Approved", color: "blue", amountKey: "dasApprovedAmount" },
  { key: "designsCompleted", label: "Designs Done", color: "indigo", amountKey: "designsCompletedAmount" },
  { key: "permitsIssued", label: "Permits Issued", color: "purple", amountKey: "permitsIssuedAmount" },
  { key: "constructionsComplete", label: "Construction Done", color: "green", amountKey: "constructionsCompleteAmount" },
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
