"use client";

import { useCallback, useMemo, useState } from "react";
import { isWeekendDateYmd, toDateStr } from "@/lib/scheduling-utils";
import { STATUS_COLORS } from "@/lib/scheduler-v2/colors";
import type { BoardData, WorkItem } from "@/lib/scheduler-v2/types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface MonthViewProps {
  data?: BoardData;
  isLoading?: boolean;
  error?: Error | null;
  refetch?: () => void;
  /** Controlled "anchor" date (any day in the displayed month). */
  monthAnchor?: string;
  onMonthAnchorChange?: (next: string) => void;
  onSelectItem?: (item: WorkItem) => void;
}

/** Same status-fill precedence used by JobBar: forecast → overdue → status. */
function statusClass(item: WorkItem): string {
  const key = item.isForecast
    ? "forecast"
    : item.isOverdue
      ? "overdue"
      : item.status;
  return STATUS_COLORS[key] ?? STATUS_COLORS.scheduled;
}

/** A WorkItem occupying one calendar day, annotated with its business-day index. */
interface DayItem {
  item: WorkItem;
  dayNum: number; // 1-based business day within the span
  totalDays: number;
}

export function MonthView({
  data,
  isLoading,
  error,
  refetch,
  monthAnchor: anchorProp,
  onMonthAnchorChange,
  onSelectItem,
}: MonthViewProps) {
  const [internalAnchor, setInternalAnchor] = useState<string>(() =>
    toDateStr(new Date()),
  );
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const anchor = anchorProp ?? internalAnchor;
  const setAnchor = useCallback(
    (next: string) => {
      onMonthAnchorChange?.(next);
      if (anchorProp === undefined) setInternalAnchor(next);
    },
    [onMonthAnchorChange, anchorProp],
  );

  const [year, month] = useMemo(() => {
    const [y, m] = anchor.split("-").map(Number);
    return [y, m - 1] as const;
  }, [anchor]);

  const today = toDateStr(new Date());

  // Six-week calendar grid (Monday-first), with leading/trailing spill days.
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = (firstDay.getDay() + 6) % 7; // 0 = Monday
    const days: string[] = [];
    for (let i = startDow - 1; i >= 0; i--) {
      days.push(toDateStr(new Date(year, month, -i)));
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`);
    }
    while (days.length % 7 !== 0) {
      const last = new Date(days[days.length - 1] + "T12:00:00");
      last.setDate(last.getDate() + 1);
      days.push(toDateStr(last));
    }
    return days;
  }, [year, month]);

  // Map each WorkItem across its business-day span onto YYYY-MM-DD keys.
  // Mirrors ConstructionMonthView.eventsForDate: walk calendar days, skip
  // weekends, count business days up to durationDays.
  const itemsByDate = useMemo(() => {
    const map = new Map<string, DayItem[]>();
    for (const item of data?.workItems ?? []) {
      const start = item.scheduledStart;
      if (!start) continue; // unscheduled items don't land on the calendar
      const totalDays = Math.max(1, Math.ceil(item.durationDays || 1));
      const startDate = new Date(start + "T12:00:00");
      let bDay = 0;
      let calOffset = 0;
      let guard = 0;
      while (bDay < totalDays && guard < 60) {
        const check = new Date(startDate);
        check.setDate(check.getDate() + calOffset);
        const dow = check.getDay();
        if (dow !== 0 && dow !== 6) {
          const ymd = toDateStr(check);
          const arr = map.get(ymd) ?? [];
          arr.push({ item, dayNum: bDay + 1, totalDays });
          map.set(ymd, arr);
          bDay++;
        }
        calOffset++;
        guard++;
      }
    }
    return map;
  }, [data?.workItems]);

  const goPrev = () => setAnchor(toDateStr(new Date(year, month - 1, 1)));
  const goNext = () => setAnchor(toDateStr(new Date(year, month + 1, 1)));
  const goToday = () => setAnchor(toDateStr(new Date()));

  const visibleDayNames = includeWeekends ? DAY_NAMES : DAY_NAMES.slice(0, 5);
  const gridCols = includeWeekends ? "grid-cols-7" : "grid-cols-5";

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-6 text-center">
        <p className="text-sm font-medium text-red-400">Couldn’t load the calendar.</p>
        <p className="mt-1 text-xs text-muted">{error.message}</p>
        {refetch && (
          <button
            onClick={() => refetch()}
            className="mt-3 rounded bg-surface-2 px-3 py-1 text-xs text-foreground hover:brightness-110"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-t-border bg-surface shadow-card">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-t-border p-3">
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="rounded p-1.5 hover:bg-surface-2" aria-label="Previous month">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="min-w-[180px] text-center text-sm font-semibold text-foreground">
            {MONTH_NAMES[month]} {year}
          </span>
          <button onClick={goNext} className="rounded p-1.5 hover:bg-surface-2" aria-label="Next month">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            onClick={goToday}
            className="rounded bg-surface-2 px-3 py-1 text-xs text-foreground hover:brightness-110"
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={includeWeekends}
              onChange={(e) => setIncludeWeekends(e.target.checked)}
              className="accent-blue-500"
            />
            Weekends
          </label>
          {isLoading && <span className="text-xs text-muted">Refreshing…</span>}
        </div>
      </div>

      {isLoading && !data ? (
        <div className="grid grid-cols-5 gap-px p-4">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded bg-surface-2" />
          ))}
        </div>
      ) : (
        <>
          {/* Weekday header */}
          <div className={`grid ${gridCols} border-b border-t-border`}>
            {visibleDayNames.map((d) => (
              <div key={d} className="p-2 text-center text-xs font-medium text-muted">
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className={`grid ${gridCols}`}>
            {calendarDays
              .filter((d) => includeWeekends || !isWeekendDateYmd(d))
              .map((dateStr) => {
                const [y, m] = dateStr.split("-").map(Number);
                const isCurrentMonth = m - 1 === month && y === year;
                const isToday = dateStr === today;
                const weekend = isWeekendDateYmd(dateStr);
                const events = itemsByDate.get(dateStr) ?? [];
                const isSelected = selectedDay === dateStr;
                return (
                  <div
                    key={dateStr}
                    onClick={() =>
                      setSelectedDay((prev) => (prev === dateStr ? null : dateStr))
                    }
                    className={`min-h-[110px] max-h-[200px] cursor-pointer overflow-y-auto border-b border-r border-t-border p-1.5 transition-colors hover:bg-surface-2/40 ${
                      isCurrentMonth ? "" : "opacity-40"
                    } ${weekend ? "bg-surface-2/30" : ""} ${
                      isToday ? "bg-blue-500/10" : ""
                    } ${isSelected ? "ring-2 ring-inset ring-blue-500/40" : ""}`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`text-xs font-medium ${
                          isToday ? "text-blue-400" : "text-muted"
                        }`}
                      >
                        {Number(dateStr.split("-")[2])}
                      </span>
                      {events.length > 0 && (
                        <span className="text-[0.55rem] text-muted">{events.length}</span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {events.map(({ item, dayNum, totalDays }) => (
                        <button
                          key={`${item.id}-d${dayNum}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectItem?.(item);
                          }}
                          title={`${item.customer}${
                            item.projectNumber ? ` (${item.projectNumber})` : ""
                          } · ${item.workType}${
                            item.subSystem ? `/${item.subSystem}` : ""
                          }${totalDays > 1 ? ` · Day ${dayNum}/${totalDays}` : ""}${
                            !item.hasZuperJob ? " · no Zuper job" : ""
                          }`}
                          className={`flex w-full items-center gap-1 overflow-hidden truncate rounded px-1 py-0.5 text-left text-[0.62rem] leading-tight hover:brightness-110 ${statusClass(
                            item,
                          )} ${
                            !item.hasZuperJob
                              ? "border border-dashed border-amber-400/80"
                              : ""
                          }`}
                        >
                          {totalDays > 1 && (
                            <span className="shrink-0 font-semibold opacity-80">
                              D{dayNum}
                            </span>
                          )}
                          <span className="truncate">{item.customer}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}
