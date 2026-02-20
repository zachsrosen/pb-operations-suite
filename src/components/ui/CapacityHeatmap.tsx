"use client";

/**
 * CapacityHeatmap
 *
 * An 8-week grid showing forecasted crew utilization per location.
 * Pure frontend — reads from capacityAnalysis already computed by
 * useExecutiveData. No new API calls.
 *
 * Color scale:
 * - green  (≤ 80% capacity)
 * - yellow (81–100%)
 * - orange (101–120%)
 * - red    (> 120%)
 */

import type { CapacityAnalysis } from "@/lib/executive-shared";

interface CapacityHeatmapProps {
  capacityAnalysis: Record<string, CapacityAnalysis>;
}

function getWeekLabel(weekOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + weekOffset * 7);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getMonthKey(weekOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + weekOffset * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Count how many whole ISO weeks overlap a calendar month (year-month key). */
function weeksInCalendarMonth(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  // Each week is 7 days; a month spans ceil(daysInMonth / 7) week-slots at most
  // but the precise count is the number of distinct Mon–Sun windows that touch it.
  // Simple approximation that matches real calendars: ceil(daysInMonth / 7).
  // Feb always 4, months starting mid-week can be 5. Never under-counts.
  return Math.ceil(daysInMonth / 7);
}

function utilizationColor(pct: number): string {
  if (pct <= 0) return "bg-surface-2 text-muted/40"; // no jobs
  if (pct <= 80) return "bg-emerald-500/20 text-emerald-400";
  if (pct <= 100) return "bg-yellow-500/20 text-yellow-400";
  if (pct <= 120) return "bg-orange-500/20 text-orange-400";
  return "bg-red-500/20 text-red-400";
}

function utilizationBorder(pct: number): string {
  if (pct <= 0) return "border-t-border";
  if (pct <= 80) return "border-emerald-500/30";
  if (pct <= 100) return "border-yellow-500/40";
  if (pct <= 120) return "border-orange-500/50";
  return "border-red-500/60";
}

const WEEKS = 8;

export function CapacityHeatmap({ capacityAnalysis }: CapacityHeatmapProps) {
  const locations = Object.keys(capacityAnalysis);

  if (locations.length === 0) {
    return (
      <div className="bg-surface border border-t-border rounded-xl p-6 text-center text-muted text-sm">
        No capacity data available.
      </div>
    );
  }

  // Pre-compute week labels and month keys
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({
    offset: i,
    label: getWeekLabel(i),
    monthKey: getMonthKey(i),
  }));

  return (
    <div className="bg-surface border border-t-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-t-border">
        <div>
          <div className="font-semibold text-sm">Capacity Heatmap</div>
          <div className="text-[0.65rem] text-muted">
            8-week install forecast vs crew capacity — by location
          </div>
        </div>
        <div className="flex items-center gap-3 text-[0.6rem] text-muted">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/40 inline-block" /> ≤80%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-500/40 inline-block" /> 81–100%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-500/40 inline-block" /> 101–120%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/40 inline-block" /> {">"} 120%</span>
        </div>
      </div>

      {/* Grid */}
      <div className="p-4 overflow-x-auto">
        {/* Week header row */}
        <div
          className="grid gap-1 mb-2 text-[0.6rem] text-muted"
          style={{ gridTemplateColumns: `120px repeat(${WEEKS}, minmax(60px, 1fr))` }}
        >
          <div />
          {weeks.map((w) => (
            <div key={w.offset} className="text-center">
              {w.label}
            </div>
          ))}
        </div>

        {/* Location rows */}
        {locations.map((loc) => {
          const cap = capacityAnalysis[loc];
          // Monthly capacity → weekly (approx 4.33 weeks/month)
          const weeklyCapacity = cap.monthly_capacity / 4.33;

          return (
            <div
              key={loc}
              className="grid gap-1 mb-1.5 items-center"
              style={{ gridTemplateColumns: `120px repeat(${WEEKS}, minmax(60px, 1fr))` }}
            >
              {/* Location label */}
              <div className="text-[0.65rem] font-medium text-foreground/80 pr-2 truncate">
                {loc}
                <div className="text-[0.55rem] text-muted font-normal">
                  {cap.monthly_capacity}d/mo · {cap.crews.length} crew{cap.crews.length !== 1 ? "s" : ""}
                </div>
              </div>

              {/* Week cells */}
              {weeks.map((w) => {
                const forecast = cap.monthly_forecast[w.monthKey];
                // Distribute month's forecast evenly across all calendar weeks in that month
                const weeksInMonth = weeksInCalendarMonth(w.monthKey);
                const weekDays = forecast ? forecast.days_needed / weeksInMonth : 0;
                const pct = weeklyCapacity > 0 ? (weekDays / weeklyCapacity) * 100 : 0;
                const count = forecast ? Math.round(forecast.count / weeksInCalendarMonth(w.monthKey)) : 0;

                return (
                  <div
                    key={w.offset}
                    title={
                      forecast
                        ? `${loc} week of ${w.label}: ~${weekDays.toFixed(1)} install days (${pct.toFixed(0)}% capacity), ~${count} jobs`
                        : `${loc} week of ${w.label}: no installs forecast`
                    }
                    className={`rounded border text-center py-2 text-[0.6rem] font-mono transition-colors ${utilizationColor(pct)} ${utilizationBorder(pct)}`}
                  >
                    {pct > 0 ? `${pct.toFixed(0)}%` : "—"}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
