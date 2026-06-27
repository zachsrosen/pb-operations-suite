"use client";

import { useCallback, useMemo, useState } from "react";
import {
  addDaysYmd,
  getBusinessDatesInSpan,
  getTodayStr,
  isWeekendDateYmd,
} from "@/lib/scheduling-utils";
import { STATUS_COLORS } from "@/lib/scheduler-v2/colors";
import type { BoardData, WorkItem } from "@/lib/scheduler-v2/types";

/** ~3 working weeks visible. */
const GANTT_WEEKDAY_COUNT = 15;

export interface GanttViewProps {
  data?: BoardData;
  isLoading?: boolean;
  error?: Error | null;
  refetch?: () => void;
  /** Controlled window start (any day; the view snaps forward to weekdays). */
  ganttStart?: string;
  onGanttStartChange?: (next: string) => void;
  onSelectItem?: (item: WorkItem) => void;
}

function nextWeekday(dateStr: string): string {
  let cursor = dateStr;
  while (isWeekendDateYmd(cursor)) cursor = addDaysYmd(cursor, 1);
  return cursor;
}

function getNextWeekdays(dateStr: string, count: number): string[] {
  const days: string[] = [];
  let cursor = dateStr;
  let guard = 0;
  while (days.length < count && guard < count * 3 + 10) {
    if (!isWeekendDateYmd(cursor)) days.push(cursor);
    cursor = addDaysYmd(cursor, 1);
    guard++;
  }
  return days;
}

function formatShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
  });
}

function statusClass(item: WorkItem): string {
  const key = item.isForecast
    ? "forecast"
    : item.isOverdue
      ? "overdue"
      : item.status;
  return STATUS_COLORS[key] ?? STATUS_COLORS.scheduled;
}

/** A deal's row: its grouping key + the install WorkItems that belong to it. */
interface DealRow {
  key: string;
  label: string;
  projectNumber?: string;
  bars: {
    item: WorkItem;
    startDate: string;
    endDate: string;
    visibleStart: number;
    visibleEnd: number;
  }[];
}

export function GanttView({
  data,
  isLoading,
  error,
  refetch,
  ganttStart: ganttStartProp,
  onGanttStartChange,
  onSelectItem,
}: GanttViewProps) {
  const [internalStart, setInternalStart] = useState<string>(() =>
    nextWeekday(getTodayStr()),
  );

  const ganttStart = ganttStartProp ?? internalStart;
  const setGanttStart = useCallback(
    (updater: string | ((s: string) => string)) => {
      const raw = typeof updater === "function" ? updater(ganttStart) : updater;
      const next = nextWeekday(raw);
      onGanttStartChange?.(next);
      if (ganttStartProp === undefined) setInternalStart(next);
    },
    [ganttStart, onGanttStartChange, ganttStartProp],
  );

  const ganttDays = useMemo(
    () => getNextWeekdays(ganttStart, GANTT_WEEKDAY_COUNT),
    [ganttStart],
  );
  const today = getTodayStr();

  // Group install work items by their deal (parentDealId preferred so split
  // PV/ESS/EV sub-jobs sequence on a single project row).
  const rows = useMemo<DealRow[]>(() => {
    const items = (data?.workItems ?? []).filter(
      (wi) => wi.workType === "install" && wi.scheduledStart,
    );
    const byDeal = new Map<string, WorkItem[]>();
    for (const wi of items) {
      const key = wi.parentDealId || wi.dealId || wi.id;
      const arr = byDeal.get(key) ?? [];
      arr.push(wi);
      byDeal.set(key, arr);
    }

    const out: DealRow[] = [];
    for (const [key, dealItems] of byDeal) {
      const bars = dealItems
        .map((item) => {
          const start = item.scheduledStart!;
          const span = getBusinessDatesInSpan(
            start,
            Math.max(1, Math.ceil(item.durationDays || 1)),
          );
          const endDate = span[span.length - 1] || start;
          const startIndex = ganttDays.indexOf(start);
          const endIndex = ganttDays.indexOf(endDate);
          // Clamp partially-visible spans into the window.
          const visibleStart =
            startIndex >= 0 ? startIndex : ganttDays.findIndex((d) => d > start);
          const visibleEnd =
            endIndex >= 0
              ? endIndex
              : (() => {
                  const idx = ganttDays.findIndex((d) => d > endDate);
                  return idx === -1 ? ganttDays.length - 1 : idx - 1;
                })();
          if (
            visibleStart === -1 ||
            visibleStart >= ganttDays.length ||
            visibleEnd < 0
          ) {
            return null;
          }
          return { item, startDate: start, endDate, visibleStart, visibleEnd };
        })
        .filter(
          (b): b is NonNullable<typeof b> => b !== null,
        )
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

      if (bars.length === 0) continue;
      const lead = dealItems[0];
      out.push({
        key,
        label: lead.customer,
        projectNumber: lead.projectNumber,
        bars,
      });
    }
    return out.sort((a, b) => {
      const aStart = a.bars[0]?.startDate ?? "";
      const bStart = b.bars[0]?.startDate ?? "";
      return aStart.localeCompare(bStart);
    });
  }, [data?.workItems, ganttDays]);

  const goPrev = () => setGanttStart((s) => addDaysYmd(s, -7));
  const goNext = () => setGanttStart((s) => addDaysYmd(s, 7));
  const goToday = () => setGanttStart(nextWeekday(getTodayStr()));

  const gridCols = `repeat(${ganttDays.length}, minmax(42px, 1fr))`;

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-6 text-center">
        <p className="text-sm font-medium text-red-400">Couldn’t load the timeline.</p>
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
          <button onClick={goPrev} className="rounded p-1.5 hover:bg-surface-2" aria-label="Previous">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="min-w-[220px] text-center text-sm font-semibold text-foreground">
            {formatShort(ganttDays[0] ?? ganttStart)} – {formatShort(ganttDays[ganttDays.length - 1] ?? ganttStart)}
          </span>
          <button onClick={goNext} className="rounded p-1.5 hover:bg-surface-2" aria-label="Next">
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
        {isLoading && <span className="text-xs text-muted">Refreshing…</span>}
      </div>

      {isLoading && !data ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-10 w-56 animate-pulse rounded bg-surface-2" />
              <div className="h-10 flex-1 animate-pulse rounded bg-surface-2" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted">
          No scheduled installs in this timeline window.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[1000px]">
            {/* Header */}
            <div className="flex border-b border-t-border bg-surface/50">
              <div className="w-56 shrink-0 border-r border-t-border p-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Project
              </div>
              <div className="flex-1 grid" style={{ gridTemplateColumns: gridCols }}>
                {ganttDays.map((day) => {
                  const isToday = day === today;
                  return (
                    <div
                      key={`g-h-${day}`}
                      className={`border-r border-t-border p-1 text-center text-[0.65rem] last:border-r-0 ${
                        isToday ? "bg-blue-500/15 text-blue-300" : "text-muted"
                      }`}
                    >
                      {formatShort(day)}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rows: one per deal; bars laid into lanes so sibling sub-jobs stack. */}
            {rows.map((row) => {
              // Lane-pack the deal's bars to avoid overlap on the same row.
              const lanes: DealRow["bars"][] = [];
              for (const bar of row.bars) {
                let placed = false;
                for (const lane of lanes) {
                  const last = lane[lane.length - 1];
                  if (bar.visibleStart > last.visibleEnd) {
                    lane.push(bar);
                    placed = true;
                    break;
                  }
                }
                if (!placed) lanes.push([bar]);
              }
              const laneCount = Math.max(lanes.length, 1);
              return (
                <div key={`g-r-${row.key}`} className="flex border-b border-t-border hover:bg-surface/40">
                  <div className="w-56 shrink-0 border-r border-t-border p-2">
                    <button
                      onClick={() => row.bars[0] && onSelectItem?.(row.bars[0].item)}
                      className="w-full text-left"
                    >
                      <div className="truncate text-sm text-foreground hover:text-blue-300">
                        {row.label}
                      </div>
                      <div className="truncate text-[0.68rem] text-muted">
                        {row.projectNumber ? `${row.projectNumber} · ` : ""}
                        {formatShort(row.bars[0].startDate)} – {formatShort(row.bars[row.bars.length - 1].endDate)}
                      </div>
                    </button>
                  </div>
                  <div
                    className="relative flex-1 grid gap-y-1 py-1.5"
                    style={{
                      gridTemplateColumns: gridCols,
                      gridTemplateRows: `repeat(${laneCount}, minmax(1.5rem, auto))`,
                    }}
                  >
                    {/* Day grid background */}
                    {ganttDays.map((day, i) => (
                      <div
                        key={`g-c-${row.key}-${day}`}
                        className="border-r border-t-border/50 last:border-r-0"
                        style={{ gridColumn: `${i + 1} / ${i + 2}`, gridRow: "1 / -1" }}
                      />
                    ))}
                    {/* Bars */}
                    {lanes.map((lane, laneIdx) =>
                      lane.map((bar) => (
                        <button
                          key={`${bar.item.id}-${laneIdx}`}
                          onClick={() => onSelectItem?.(bar.item)}
                          title={`${bar.item.customer}${
                            bar.item.projectNumber ? ` (${bar.item.projectNumber})` : ""
                          } · ${bar.item.workType}${
                            bar.item.subSystem ? `/${bar.item.subSystem}` : ""
                          } · ${formatShort(bar.startDate)} – ${formatShort(bar.endDate)}`}
                          className={`z-10 mx-0.5 flex items-center gap-1 overflow-hidden truncate rounded px-1 text-[0.66rem] leading-tight hover:brightness-110 ${statusClass(
                            bar.item,
                          )} ${
                            !bar.item.hasZuperJob
                              ? "border border-dashed border-amber-400/80"
                              : ""
                          }`}
                          style={{
                            gridColumn: `${bar.visibleStart + 1} / ${bar.visibleEnd + 2}`,
                            gridRow: `${laneIdx + 1}`,
                          }}
                        >
                          {bar.item.subSystem && (
                            <span className="shrink-0 rounded bg-black/25 px-1 text-[0.55rem] uppercase">
                              {bar.item.subSystem}
                            </span>
                          )}
                          <span className="truncate">{bar.item.customer}</span>
                        </button>
                      )),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
