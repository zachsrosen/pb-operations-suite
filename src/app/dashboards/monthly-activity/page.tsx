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
    case "last-month":
      // Look back two months so the previous calendar month is fully inside
      // the window; the page then filters the display to that single month.
      return 2;
    case "this-quarter": {
      const qStart = Math.floor(thisMonth / 3) * 3; // 0, 3, 6, 9
      return thisMonth - qStart + 1;
    }
    case "this-year":
      return thisMonth + 1;
    case "last-year":
      return thisMonth + 13;
    default:
      return parseInt(key) || 6;
  }
}

const TIMEFRAMES = [
  { label: "This Month", value: "this-month" },
  { label: "Last Month", value: "last-month" },
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

/**
 * Throughput columns: every milestone counted by the month it actually
 * occurred, across ALL deals regardless of when they were sold. A deal sold
 * three years ago whose design got approved this month counts under "DAs
 * Approved" for this month.
 */
const ACTIVITY_COLUMNS: Array<{
  key: keyof ProjectMonthlyActivity;
  label: string;
  color: string;
  amountKey?: keyof ProjectMonthlyActivity;
}> = [
  { key: "salesClosed", label: "Sales Closed", color: "text-orange-400", amountKey: "salesClosedAmount" },
  { key: "surveysScheduled", label: "Surveys Sched.", color: "text-amber-400", amountKey: "surveysScheduledAmount" },
  { key: "surveysCompleted", label: "Surveys Done", color: "text-yellow-400", amountKey: "surveysCompletedAmount" },
  { key: "dasSent", label: "DAs Sent", color: "text-lime-400", amountKey: "dasSentAmount" },
  { key: "dasApproved", label: "DAs Approved", color: "text-blue-400", amountKey: "dasApprovedAmount" },
  { key: "designsCompleted", label: "Designs Done", color: "text-indigo-400", amountKey: "designsCompletedAmount" },
  { key: "permitsSubmitted", label: "Permits Sub.", color: "text-purple-400", amountKey: "permitsSubmittedAmount" },
  { key: "permitsIssued", label: "Permits Issued", color: "text-violet-400", amountKey: "permitsIssuedAmount" },
  { key: "constructionsScheduled", label: "Constr. Sched.", color: "text-cyan-400", amountKey: "constructionsScheduledAmount" },
  { key: "constructionsComplete", label: "Constr. Done", color: "text-green-400", amountKey: "constructionsCompleteAmount" },
  { key: "inspectionsPassed", label: "Inspections", color: "text-emerald-400", amountKey: "inspectionsPassedAmount" },
  { key: "ptosGranted", label: "PTOs", color: "text-teal-400", amountKey: "ptosGrantedAmount" },
  { key: "closedOut", label: "Closed Out", color: "text-sky-400", amountKey: "closedOutAmount" },
  { key: "cancelled", label: "Cancelled", color: "text-red-400", amountKey: "cancelledAmount" },
];

/** Hero cards — the milestones teams most often track output against. */
const HERO_KEYS: Array<{ key: keyof ProjectMonthlyActivity; label: string; color: string; amountKey?: keyof ProjectMonthlyActivity }> = [
  { key: "salesClosed", label: "Sales Closed", color: "orange", amountKey: "salesClosedAmount" },
  { key: "surveysCompleted", label: "Surveys Done", color: "yellow", amountKey: "surveysCompletedAmount" },
  { key: "dasApproved", label: "DAs Approved", color: "blue", amountKey: "dasApprovedAmount" },
  { key: "designsCompleted", label: "Designs Done", color: "indigo", amountKey: "designsCompletedAmount" },
  { key: "permitsIssued", label: "Permits Issued", color: "purple", amountKey: "permitsIssuedAmount" },
  { key: "constructionsComplete", label: "Constr. Done", color: "green", amountKey: "constructionsCompleteAmount" },
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

export default function MonthlyActivityPage() {
  const [timeframe, setTimeframe] = useState("6");
  const [locations, setLocations] = useState<string[]>([]);
  const [chartMetric, setChartMetric] = useState<keyof ProjectMonthlyActivity>("dasApproved");
  const [chartValueMode, setChartValueMode] = useState<"count" | "revenue">("count");

  const months = useMemo(() => resolveMonths(timeframe), [timeframe]);

  const locationOptions = useMemo(
    () => CANONICAL_LOCATIONS.map((loc) => ({ value: loc, label: loc })),
    []
  );

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery<ProjectFunnelResponse>({
    queryKey: queryKeys.funnel.monthlyActivity(months, locations),
    queryFn: async () => {
      const params = new URLSearchParams({ months: String(months) });
      if (locations.length > 0) params.set("locations", locations.join(","));
      const res = await fetch(`/api/deals/project-funnel?${params}`);
      if (!res.ok) throw new Error("Failed to fetch monthly activity data");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  useSSE(() => refetch(), { cacheKeyFilter: "funnel" });

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  // Chronological for the chart, descending (newest first) for the table.
  // "Last Month" narrows the fetched window down to the single prior calendar month.
  const activity = useMemo(() => {
    const rows = data?.monthlyActivity ?? [];
    if (timeframe !== "last-month") return rows;
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    const lastMonthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return rows.filter((r) => r.month === lastMonthKey);
  }, [data, timeframe]);
  const totals = useMemo(() => sumTotals(activity), [activity]);

  const exportRows = useMemo(
    () =>
      activity.map((row) => {
        const out: Record<string, string | number> = { Month: monthLabel(row.month) };
        for (const col of ACTIVITY_COLUMNS) {
          out[col.label] = row[col.key] as number;
        }
        return out;
      }),
    [activity]
  );

  if (error) {
    return (
      <DashboardShell title="Monthly Activity" accentColor="emerald">
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Monthly Activity"
      accentColor="emerald"
      fullWidth
      lastUpdated={lastUpdated}
      exportData={exportRows.length > 0 ? { data: exportRows, filename: "monthly-activity.csv" } : undefined}
    >
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={locations}
          onChange={setLocations}
          placeholder="All Locations"
          accentColor="emerald"
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

      <p className="text-xs text-muted mb-6 max-w-3xl">
        Counts every milestone by the month it <span className="text-foreground font-medium">actually happened</span> —
        regardless of when the deal was sold. A job sold three years ago that got design-approved this month shows up
        under DAs Approved this month. This is throughput, not a sales-cohort funnel.
      </p>

      {isLoading || !data ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* Window totals */}
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

          {/* Throughput chart */}
          <ThroughputChart
            activity={activity}
            metric={chartMetric}
            onMetricChange={setChartMetric}
            valueMode={chartValueMode}
            onValueModeChange={setChartValueMode}
          />

          {/* Full monthly breakdown */}
          <MonthlyActivityTable activity={activity} totals={totals} />
        </>
      )}
    </DashboardShell>
  );
}

function ThroughputChart({
  activity,
  metric,
  onMetricChange,
  valueMode,
  onValueModeChange,
}: {
  activity: ProjectMonthlyActivity[];
  metric: keyof ProjectMonthlyActivity;
  onMetricChange: (m: keyof ProjectMonthlyActivity) => void;
  valueMode: "count" | "revenue";
  onValueModeChange: (m: "count" | "revenue") => void;
}) {
  const chronological = useMemo(() => [...activity].reverse(), [activity]);
  const col = ACTIVITY_COLUMNS.find((c) => c.key === metric) ?? ACTIVITY_COLUMNS[0];
  const barColor = col.color.replace("text-", "bg-").replace("-400", "-500");

  // Revenue mode plots the matching amount column; every milestone has one.
  const valueKey: keyof ProjectMonthlyActivity =
    valueMode === "revenue" && col.amountKey ? col.amountKey : metric;
  const fmt = (v: number) =>
    valueMode === "revenue" ? formatCurrencyCompact(v) : String(v);

  const maxValue = useMemo(
    () => Math.max(1, ...chronological.map((c) => c[valueKey] as number)),
    [chronological, valueKey]
  );

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground/80">Monthly Throughput</h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-t-border overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => onValueModeChange("count")}
              className={`px-3 py-1.5 transition-colors ${valueMode === "count" ? "bg-emerald-500 text-white" : "bg-surface-2 text-muted hover:text-foreground"}`}
            >
              Count
            </button>
            <button
              type="button"
              onClick={() => onValueModeChange("revenue")}
              className={`px-3 py-1.5 transition-colors ${valueMode === "revenue" ? "bg-emerald-500 text-white" : "bg-surface-2 text-muted hover:text-foreground"}`}
            >
              Revenue
            </button>
          </div>
          <select
            value={metric}
            onChange={(e) => onMetricChange(e.target.value as keyof ProjectMonthlyActivity)}
            className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-xs text-foreground"
          >
            {ACTIVITY_COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {chronological.length === 0 ? (
        <p className="text-xs text-muted/60 italic">No activity in this window.</p>
      ) : (
        <div className="flex items-end justify-around gap-1" style={{ height: 180 }}>
          {chronological.map((row) => {
            const value = row[valueKey] as number;
            const heightPct = (value / maxValue) * 100;
            return (
              <div key={row.month} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <span className="text-[10px] text-muted tabular-nums">{value > 0 ? fmt(value) : ""}</span>
                <div className="w-full flex justify-center" style={{ height: 130 }}>
                  <div
                    className={`${barColor} rounded-t-sm w-4 lg:w-6 transition-all duration-300 mt-auto`}
                    style={{ height: `${Math.max(heightPct, value > 0 ? 3 : 0)}%` }}
                    title={`${monthLabel(row.month)}: ${fmt(value)}`}
                  />
                </div>
                <span className="text-[9px] text-muted truncate">{monthLabel(row.month, false)}</span>
              </div>
            );
          })}
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
