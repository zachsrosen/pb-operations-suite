"use client";

import { memo, useMemo } from "react";
import { formatMoney } from "@/lib/format";

export interface MonthlyDataPoint {
  /** ISO date string — only year+month are used */
  date: string;
  count: number;
  value: number;
}

interface MonthlyBarChartProps {
  title: string;
  data: MonthlyDataPoint[];
  /** Number of recent months to display (default 6) */
  months?: number;
  /** Accent color for bars — matches existing Tailwind palette */
  accentColor?: "emerald" | "green" | "blue" | "orange" | "cyan" | "purple" | "pink";
  /** Optional secondary series rendered as lighter outlined bars */
  secondaryData?: MonthlyDataPoint[];
  secondaryLabel?: string;
  primaryLabel?: string;
}

const ACCENT_MAP: Record<string, { bar: string; glow: string; text: string; barLight: string }> = {
  emerald:  { bar: "bg-emerald-500", glow: "shadow-[0_0_12px_rgba(16,185,129,0.3)]", text: "text-emerald-400", barLight: "bg-emerald-500/30" },
  green:    { bar: "bg-green-500",   glow: "shadow-[0_0_12px_rgba(34,197,94,0.3)]",  text: "text-green-400",   barLight: "bg-green-500/30" },
  blue:     { bar: "bg-blue-500",    glow: "shadow-[0_0_12px_rgba(59,130,246,0.3)]",  text: "text-blue-400",    barLight: "bg-blue-500/30" },
  orange:   { bar: "bg-orange-500",  glow: "shadow-[0_0_12px_rgba(249,115,22,0.3)]",  text: "text-orange-400",  barLight: "bg-orange-500/30" },
  cyan:     { bar: "bg-cyan-500",    glow: "shadow-[0_0_12px_rgba(6,182,212,0.3)]",   text: "text-cyan-400",    barLight: "bg-cyan-500/30" },
  purple:   { bar: "bg-purple-500",  glow: "shadow-[0_0_12px_rgba(168,85,247,0.3)]",  text: "text-purple-400",  barLight: "bg-purple-500/30" },
  pink:     { bar: "bg-pink-500",    glow: "shadow-[0_0_12px_rgba(236,72,153,0.3)]",  text: "text-pink-400",    barLight: "bg-pink-500/30" },
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Aggregates raw date-based data points into monthly buckets.
 * Returns the most recent N months (including empty months).
 */
export function aggregateMonthly(
  items: { date?: string | null; amount?: number }[],
  months: number = 6,
): MonthlyDataPoint[] {
  const now = new Date();
  const buckets: Map<string, { count: number; value: number }> = new Map();

  // Initialize buckets for the last N months
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, { count: 0, value: 0 });
  }

  // Fill buckets
  for (const item of items) {
    if (!item.date) continue;
    const d = new Date(item.date);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.value += item.amount || 0;
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, data]) => ({ date: key + "-01", ...data }));
}

export const MonthlyBarChart = memo(function MonthlyBarChart({
  title,
  data,
  months = 6,
  accentColor = "emerald",
  secondaryData,
  secondaryLabel,
  primaryLabel,
}: MonthlyBarChartProps) {
  const accent = ACCENT_MAP[accentColor] || ACCENT_MAP.emerald;

  // Merge data into month buckets
  const chartData = useMemo(() => {
    const now = new Date();
    const result: {
      month: string;
      monthShort: string;
      primary: { count: number; value: number };
      secondary: { count: number; value: number } | null;
    }[] = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const monthLabel = `${MONTH_NAMES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;

      const pMatch = data.find((dp) => dp.date.startsWith(key));
      const sMatch = secondaryData?.find((dp) => dp.date.startsWith(key));

      result.push({
        month: key,
        monthShort: monthLabel,
        primary: pMatch ? { count: pMatch.count, value: pMatch.value } : { count: 0, value: 0 },
        secondary: secondaryData ? (sMatch ? { count: sMatch.count, value: sMatch.value } : { count: 0, value: 0 }) : null,
      });
    }
    return result;
  }, [data, secondaryData, months]);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const d of chartData) {
      max = Math.max(max, d.primary.count);
      if (d.secondary) max = Math.max(max, d.secondary.count);
    }
    return Math.max(max, 1);
  }, [chartData]);

  const totalCount = useMemo(() => chartData.reduce((s, d) => s + d.primary.count, 0), [chartData]);
  const totalValue = useMemo(() => chartData.reduce((s, d) => s + d.primary.value, 0), [chartData]);
  const secondaryTotalCount = useMemo(
    () => (secondaryData ? chartData.reduce((s, d) => s + (d.secondary?.count || 0), 0) : 0),
    [chartData, secondaryData],
  );
  const secondaryTotalValue = useMemo(
    () => (secondaryData ? chartData.reduce((s, d) => s + (d.secondary?.value || 0), 0) : 0),
    [chartData, secondaryData],
  );

  const BAR_HEIGHT = 140;

  return (
    <div className="bg-surface/50 border border-t-border rounded-xl p-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <div className="flex items-center gap-4 text-xs text-muted">
          {primaryLabel && (
            <span className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${accent.bar}`} />
              {primaryLabel}
            </span>
          )}
          {secondaryLabel && (
            <span className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${accent.barLight}`} />
              {secondaryLabel}
            </span>
          )}
        </div>
      </div>

      {/* Summary line */}
      <div className="flex items-center gap-4 mb-5 text-sm">
        <span className={`font-semibold ${accent.text}`}>
          {totalCount} {primaryLabel || "completed"}
        </span>
        <span className="text-muted">{formatMoney(totalValue)}</span>
        {secondaryData && secondaryTotalCount > 0 && (
          <>
            <span className="text-muted/50">|</span>
            <span className="text-muted">
              {secondaryTotalCount} {secondaryLabel || "secondary"}
            </span>
            <span className="text-muted/70">{formatMoney(secondaryTotalValue)}</span>
          </>
        )}
        <span className="text-muted/50 text-xs ml-auto">Last {months} months</span>
      </div>

      {/* Chart */}
      <div className="flex items-end gap-2" style={{ height: BAR_HEIGHT + 28 }}>
        {chartData.map((d, i) => {
          const pHeight = maxCount > 0 ? (d.primary.count / maxCount) * BAR_HEIGHT : 0;
          const sHeight = d.secondary && maxCount > 0 ? (d.secondary.count / maxCount) * BAR_HEIGHT : 0;
          const hasSecondary = d.secondary !== null;

          return (
            <div key={d.month} className="flex-1 flex flex-col items-center gap-1 group">
              {/* Bars container */}
              <div
                className="w-full flex items-end justify-center gap-1"
                style={{ height: BAR_HEIGHT }}
              >
                {/* Primary bar */}
                <div className="flex flex-col items-center" style={{ width: hasSecondary ? "45%" : "70%" }}>
                  {d.primary.count > 0 && (
                    <span className={`text-[10px] font-medium ${accent.text} mb-1 opacity-0 group-hover:opacity-100 transition-opacity`}>
                      {d.primary.count}
                    </span>
                  )}
                  <div
                    className={`w-full rounded-t-md ${accent.bar} ${d.primary.count > 0 ? accent.glow : ""} transition-all duration-500`}
                    style={{
                      height: Math.max(pHeight, d.primary.count > 0 ? 4 : 0),
                      animationDelay: `${i * 60}ms`,
                    }}
                    title={`${d.primary.count} projects — ${formatMoney(d.primary.value)}`}
                  />
                </div>

                {/* Secondary bar */}
                {hasSecondary && (
                  <div className="flex flex-col items-center" style={{ width: "45%" }}>
                    {(d.secondary?.count || 0) > 0 && (
                      <span className="text-[10px] font-medium text-muted mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {d.secondary?.count}
                      </span>
                    )}
                    <div
                      className={`w-full rounded-t-md ${accent.barLight} transition-all duration-500`}
                      style={{
                        height: Math.max(sHeight, (d.secondary?.count || 0) > 0 ? 4 : 0),
                        animationDelay: `${i * 60 + 30}ms`,
                      }}
                      title={`${d.secondary?.count || 0} projects — ${formatMoney(d.secondary?.value || 0)}`}
                    />
                  </div>
                )}
              </div>

              {/* Month label */}
              <span className="text-[10px] text-muted mt-1">{d.monthShort}</span>
            </div>
          );
        })}
      </div>

      {/* Value subtotals per month (on hover row) */}
      <div className="flex gap-2 mt-1">
        {chartData.map((d) => (
          <div key={d.month + "-val"} className="flex-1 text-center">
            <span className="text-[9px] text-muted/60">
              {d.primary.value > 0 ? formatMoney(d.primary.value) : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
