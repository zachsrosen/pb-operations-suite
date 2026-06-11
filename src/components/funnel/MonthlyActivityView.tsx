"use client";

import { useMemo, useState } from "react";
import { StatCard } from "@/components/ui/MetricCard";
import { formatCurrencyCompact } from "@/lib/format";
import type {
  ProjectFunnelResponse,
  ProjectMonthlyActivity,
} from "@/lib/project-funnel-aggregation";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import { calendarMonthRange } from "@/lib/dashboard-timeframe";

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
  { key: "icSubmitted", label: "IC Submitted", color: "text-fuchsia-400", amountKey: "icSubmittedAmount" },
  { key: "icApproved", label: "IC Approved", color: "text-pink-400", amountKey: "icApprovedAmount" },
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
}: {
  data: ProjectFunnelResponse;
  timeframe: string;
}) {
  const [chartMetric, setChartMetric] = useState<keyof ProjectMonthlyActivity>("dasApproved");
  const [chartValueMode, setChartValueMode] = useState<"count" | "revenue">("count");
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

      <ThroughputChart
        activity={activity}
        metric={chartMetric}
        onMetricChange={setChartMetric}
        valueMode={chartValueMode}
        onValueModeChange={setChartValueMode}
      />

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

  const valueKey: keyof ProjectMonthlyActivity =
    valueMode === "revenue" && col.amountKey ? col.amountKey : metric;
  const fmt = (v: number) => (valueMode === "revenue" ? formatCurrencyCompact(v) : String(v));

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
