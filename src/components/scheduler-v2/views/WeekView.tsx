"use client";

import { useCallback, useMemo, useState } from "react";
import {
  addDaysYmd,
  getTodayStr,
  isWeekendDateYmd,
  toDateStr,
} from "@/lib/scheduling-utils";
import { LOCATIONS } from "@/lib/scheduler-v2/constants";
import { STATUS_COLORS } from "@/lib/scheduler-v2/colors";
import type { BoardData, WorkItem } from "@/lib/scheduler-v2/types";

type GroupMode = "location" | "resource";

export interface WeekViewProps {
  data?: BoardData;
  isLoading?: boolean;
  error?: Error | null;
  refetch?: () => void;
  /** Controlled week window (Monday). When omitted the view manages its own. */
  weekStart?: string;
  onWeekStartChange?: (next: string) => void;
  onSelectItem?: (item: WorkItem) => void;
}

/** Monday of the week containing `dateStr`. */
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + delta);
  return toDateStr(dt);
}

function formatDayLabel(dateStr: string): { dow: string; md: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    dow: dt.toLocaleDateString("en-US", { weekday: "short" }),
    md: dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }),
  };
}

function statusClass(item: WorkItem): string {
  const key = item.isForecast
    ? "forecast"
    : item.isOverdue
      ? "overdue"
      : item.status;
  return STATUS_COLORS[key] ?? STATUS_COLORS.scheduled;
}

/** Resolve the day-span [startIdx, endIdx] of a WorkItem within `days`. */
function spanWithin(item: WorkItem, days: string[]): { start: number; end: number } | null {
  if (!item.scheduledStart) return null;
  const totalDays = Math.max(1, Math.ceil(item.durationDays || 1));
  // Walk business days from start; collect calendar YMDs that the span covers.
  const covered: string[] = [];
  const startDate = new Date(item.scheduledStart + "T12:00:00");
  let bDay = 0;
  let calOffset = 0;
  let guard = 0;
  while (bDay < totalDays && guard < 60) {
    const check = new Date(startDate);
    check.setDate(check.getDate() + calOffset);
    const dow = check.getDay();
    if (dow !== 0 && dow !== 6) {
      covered.push(toDateStr(check));
      bDay++;
    }
    calOffset++;
    guard++;
  }
  const idxs = covered
    .map((d) => days.indexOf(d))
    .filter((i) => i >= 0);
  if (idxs.length === 0) return null;
  return { start: Math.min(...idxs), end: Math.max(...idxs) };
}

export function WeekView({
  data,
  isLoading,
  error,
  refetch,
  weekStart: weekStartProp,
  onWeekStartChange,
  onSelectItem,
}: WeekViewProps) {
  const [internalWeekStart, setInternalWeekStart] = useState<string>(() =>
    mondayOf(getTodayStr()),
  );
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>("location");

  const weekStart = weekStartProp ?? internalWeekStart;
  const setWeekStart = useCallback(
    (updater: string | ((w: string) => string)) => {
      const next = typeof updater === "function" ? updater(weekStart) : updater;
      onWeekStartChange?.(next);
      if (weekStartProp === undefined) setInternalWeekStart(next);
    },
    [weekStart, onWeekStartChange, weekStartProp],
  );

  const today = getTodayStr();

  const days = useMemo(() => {
    const all: string[] = [];
    for (let i = 0; i < 7; i++) all.push(addDaysYmd(weekStart, i));
    return includeWeekends ? all : all.filter((d) => !isWeekendDateYmd(d));
  }, [weekStart, includeWeekends]);

  // Resolve the resource name a work item is assigned to (first match).
  const resourceNameForItem = useCallback(
    (item: WorkItem): string | null => {
      if (!data) return null;
      const a = data.assignments.find((x) => x.workItemId === item.id);
      return a?.resourceName ?? null;
    },
    [data],
  );

  // Build the ordered list of row groups + the items that belong to each.
  const groups = useMemo(() => {
    const items = data?.workItems ?? [];
    const placed = items.filter((wi) => spanWithin(wi, days));

    if (groupMode === "resource") {
      const byResource = new Map<string, WorkItem[]>();
      for (const wi of placed) {
        const name = resourceNameForItem(wi) ?? "Unassigned";
        const arr = byResource.get(name) ?? [];
        arr.push(wi);
        byResource.set(name, arr);
      }
      // Order resources by canonical resource list, unknown/Unassigned last.
      const order = new Map((data?.resources ?? []).map((r, i) => [r.name, i]));
      return Array.from(byResource.entries())
        .sort(([a], [b]) => {
          if (a === "Unassigned") return 1;
          if (b === "Unassigned") return -1;
          return (order.get(a) ?? 9999) - (order.get(b) ?? 9999);
        })
        .map(([label, rowItems]) => ({ label, items: rowItems }));
    }

    // Group by location (default).
    const byLoc = new Map<string, WorkItem[]>();
    for (const wi of placed) {
      const loc = wi.location || "Unassigned";
      const arr = byLoc.get(loc) ?? [];
      arr.push(wi);
      byLoc.set(loc, arr);
    }
    const ordered: { label: string; items: WorkItem[] }[] = [];
    for (const loc of LOCATIONS) {
      if (byLoc.has(loc)) {
        ordered.push({ label: loc, items: byLoc.get(loc)! });
        byLoc.delete(loc);
      }
    }
    for (const [loc, rowItems] of byLoc) ordered.push({ label: loc, items: rowItems });
    return ordered;
  }, [data, days, groupMode, resourceNameForItem]);

  const goPrev = () => setWeekStart((w) => addDaysYmd(w, -7));
  const goNext = () => setWeekStart((w) => addDaysYmd(w, 7));
  const goToday = () => setWeekStart(mondayOf(getTodayStr()));

  const gridCols = `repeat(${days.length}, minmax(110px, 1fr))`;

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-6 text-center">
        <p className="text-sm font-medium text-red-400">Couldn’t load the week.</p>
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
    <div className="rounded-xl border border-t-border bg-surface shadow-card">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-t-border p-3">
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="rounded p-1.5 hover:bg-surface-2" aria-label="Previous week">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="min-w-[160px] text-center text-sm font-semibold text-foreground">
            {formatDayLabel(days[0] ?? weekStart).md} – {formatDayLabel(days[days.length - 1] ?? weekStart).md}
          </span>
          <button onClick={goNext} className="rounded p-1.5 hover:bg-surface-2" aria-label="Next week">
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
          {/* Grouping toggle */}
          <div className="inline-flex rounded-md border border-t-border bg-surface" role="tablist" aria-label="Group rows by">
            <button
              role="tab"
              aria-selected={groupMode === "location"}
              onClick={() => setGroupMode("location")}
              className={`rounded-l-md px-2.5 py-1 text-xs transition-colors ${
                groupMode === "location" ? "bg-surface-2 font-medium text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              Location
            </button>
            <button
              role="tab"
              aria-selected={groupMode === "resource"}
              onClick={() => setGroupMode("resource")}
              className={`rounded-r-md px-2.5 py-1 text-xs transition-colors ${
                groupMode === "resource" ? "bg-surface-2 font-medium text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              Resource
            </button>
          </div>
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
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-8 w-40 animate-pulse rounded bg-surface-2" />
              <div className="h-8 flex-1 animate-pulse rounded bg-surface-2" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted">
          No scheduled work for this week.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            {/* Header row */}
            <div className="flex border-b border-t-border bg-surface/60">
              <div className="sticky left-0 z-20 w-40 shrink-0 border-r border-t-border bg-surface px-2 py-2 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
                {groupMode === "location" ? "Location" : "Resource"}
              </div>
              <div className="min-w-0 flex-1 grid" style={{ gridTemplateColumns: gridCols }}>
                {days.map((day) => {
                  const { dow, md } = formatDayLabel(day);
                  const isToday = day === today;
                  const weekend = isWeekendDateYmd(day);
                  return (
                    <div
                      key={`hdr-${day}`}
                      className={`border-r border-t-border/60 p-1 text-center last:border-r-0 ${
                        isToday ? "bg-blue-500/15" : weekend ? "bg-surface-2/40" : ""
                      }`}
                    >
                      <div className={`text-[0.65rem] font-semibold ${isToday ? "text-blue-300" : "text-muted"}`}>
                        {dow}
                      </div>
                      <div className={`text-[0.6rem] ${isToday ? "text-blue-300" : "text-muted"}`}>{md}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Group rows */}
            {groups.map(({ label, items }) => {
              // Lay items into lanes (stacked rows) so overlapping spans don't collide.
              const spans = items
                .map((item) => ({ item, span: spanWithin(item, days)! }))
                .sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
              const lanes: { item: WorkItem; span: { start: number; end: number } }[][] = [];
              for (const entry of spans) {
                let placed = false;
                for (const lane of lanes) {
                  const last = lane[lane.length - 1];
                  if (entry.span.start > last.span.end) {
                    lane.push(entry);
                    placed = true;
                    break;
                  }
                }
                if (!placed) lanes.push([entry]);
              }
              return (
                <div key={`grp-${label}`} className="flex border-b border-t-border">
                  <div className="sticky left-0 z-10 flex w-40 shrink-0 items-center border-r border-t-border bg-surface px-2 py-1.5">
                    <span className="text-xs font-semibold text-foreground">{label}</span>
                    <span className="ml-1 text-[0.65rem] text-muted">({items.length})</span>
                  </div>
                  <div
                    className="relative min-w-0 flex-1 grid gap-y-1 py-1"
                    style={{
                      gridTemplateColumns: gridCols,
                      gridTemplateRows: `repeat(${Math.max(lanes.length, 1)}, minmax(1.75rem, auto))`,
                    }}
                  >
                    {/* Day column dividers (background) */}
                    {days.map((day, i) => (
                      <div
                        key={`bg-${label}-${day}`}
                        className={`border-r border-t-border/40 last:border-r-0 ${
                          isWeekendDateYmd(day) ? "bg-surface-2/20" : ""
                        }`}
                        style={{ gridColumn: `${i + 1} / ${i + 2}`, gridRow: `1 / -1` }}
                      />
                    ))}
                    {/* Job bars */}
                    {lanes.map((lane, laneIdx) =>
                      lane.map(({ item, span }) => (
                        <button
                          key={`${item.id}-${laneIdx}`}
                          type="button"
                          onClick={() => onSelectItem?.(item)}
                          title={`${item.customer}${
                            item.projectNumber ? ` (${item.projectNumber})` : ""
                          } · ${item.workType}${item.subSystem ? `/${item.subSystem}` : ""}${
                            !item.hasZuperJob ? " · no Zuper job" : ""
                          }`}
                          className={`z-10 mx-0.5 flex min-w-0 items-center gap-1 overflow-hidden rounded px-1.5 py-0.5 text-left text-[0.65rem] leading-tight hover:brightness-110 ${statusClass(
                            item,
                          )} ${
                            !item.hasZuperJob ? "border border-dashed border-amber-400/80" : ""
                          }`}
                          style={{
                            gridColumn: `${span.start + 1} / ${span.end + 2}`,
                            gridRow: `${laneIdx + 1}`,
                          }}
                        >
                          <span className="truncate font-medium">{item.customer}</span>
                          {item.projectNumber && (
                            <span className="shrink-0 opacity-70">{item.projectNumber}</span>
                          )}
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
