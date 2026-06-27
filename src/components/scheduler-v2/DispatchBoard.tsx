"use client";

import { useMemo, useState } from "react";
import {
  addDaysYmd,
  getTodayStr,
  isWeekendDateYmd,
  toDateStr,
} from "@/lib/scheduling-utils";
import { LOCATIONS } from "@/lib/scheduler-v2/constants";
import type {
  Assignment,
  CapacityCell,
  Resource,
  WorkItem,
} from "@/lib/scheduler-v2/types";
import { useBoardData } from "./useBoardData";
import { BoardRow } from "./BoardRow";

// ---------------------------------------------------------------------------
// Date helpers (local, weekday-aware)
// ---------------------------------------------------------------------------

/** Monday of the week containing `dateStr`. */
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0=Sun
  const delta = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + delta);
  return toDateStr(dt);
}

/** Inclusive day list between two YYYY-MM-DD, optionally dropping weekends. */
function dayList(from: string, to: string, includeWeekends: boolean): string[] {
  const out: string[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 400) {
    if (includeWeekends || !isWeekendDateYmd(cursor)) out.push(cursor);
    cursor = addDaysYmd(cursor, 1);
    guard++;
  }
  return out;
}

function formatDayLabel(dateStr: string): { dow: string; md: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    dow: dt.toLocaleDateString("en-US", { weekday: "short" }),
    md: dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }),
  };
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export interface DispatchBoardProps {
  onSelectItem?: (item: WorkItem) => void;
}

export function DispatchBoard({ onSelectItem }: DispatchBoardProps) {
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(getTodayStr()));
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const from = weekStart;
  const to = addDaysYmd(weekStart, 6); // Mon..Sun range; weekend filter trims display

  const { data, isLoading, error, refetch } = useBoardData({ from, to });

  const days = useMemo(
    () => dayList(from, to, includeWeekends),
    [from, to, includeWeekends]
  );
  const today = getTodayStr();

  // Group resources by primaryLocation, ordered by the canonical LOCATIONS list
  // (unknown locations appended after).
  const grouped = useMemo(() => {
    const byLoc = new Map<string, Resource[]>();
    for (const r of data?.resources ?? []) {
      const loc = r.primaryLocation || "Unassigned";
      const arr = byLoc.get(loc) ?? [];
      arr.push(r);
      byLoc.set(loc, arr);
    }
    const ordered: { location: string; resources: Resource[] }[] = [];
    for (const loc of LOCATIONS) {
      if (byLoc.has(loc)) {
        ordered.push({ location: loc, resources: byLoc.get(loc)! });
        byLoc.delete(loc);
      }
    }
    for (const [loc, resources] of byLoc) ordered.push({ location: loc, resources });
    return ordered;
  }, [data?.resources]);

  // Index assignments → work items per resource name.
  const itemsByResource = useMemo(() => {
    const map = new Map<string, WorkItem[]>();
    if (!data) return map;
    const itemById = new Map<string, WorkItem>();
    for (const wi of data.workItems) itemById.set(wi.id, wi);

    // Match strategy: Assignment.resourceName ↔ Resource.name. Each assignment
    // points at a workItemId; dedupe so a multi-day item appears once per row.
    const seen = new Set<string>(); // `${resourceName}|${workItemId}`
    for (const a of data.assignments as Assignment[]) {
      const wi = itemById.get(a.workItemId);
      if (!wi) continue;
      const key = `${a.resourceName}|${a.workItemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const arr = map.get(a.resourceName) ?? [];
      arr.push(wi);
      map.set(a.resourceName, arr);
    }
    return map;
  }, [data]);

  // Capacity cells indexed by `${resourceId}|${date}`.
  const capacityByResourceDate = useMemo(() => {
    const map = new Map<string, Map<string, CapacityCell>>();
    for (const c of data?.capacity ?? []) {
      if (!c.resourceId) continue;
      const inner = map.get(c.resourceId) ?? new Map<string, CapacityCell>();
      inner.set(c.date, c);
      map.set(c.resourceId, inner);
    }
    return map;
  }, [data?.capacity]);

  const unscheduledCount = useMemo(
    () =>
      (data?.workItems ?? []).filter(
        (wi) => wi.status === "unscheduled" || wi.assignedResourceIds.length === 0
      ).length,
    [data?.workItems]
  );

  const goPrev = () => setWeekStart((w) => addDaysYmd(w, -7));
  const goNext = () => setWeekStart((w) => addDaysYmd(w, 7));
  const goToday = () => setWeekStart(mondayOf(getTodayStr()));
  const toggleLoc = (loc: string) =>
    setCollapsed((c) => ({ ...c, [loc]: !c[loc] }));

  const gridCols = `repeat(${days.length}, minmax(56px, 1fr))`;

  // ----- States -----
  if (error) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-6 text-center">
        <p className="text-sm font-medium text-red-400">Couldn’t load the board.</p>
        <p className="mt-1 text-xs text-muted">{error.message}</p>
        <button
          onClick={() => refetch()}
          className="mt-3 rounded bg-surface-2 px-3 py-1 text-xs text-foreground hover:brightness-110"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-t-border bg-surface shadow-card">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-t-border p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            className="rounded p-1.5 hover:bg-surface-2"
            aria-label="Previous week"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="min-w-[180px] text-center text-sm font-semibold text-foreground">
            {formatDayLabel(days[0] ?? from).md} – {formatDayLabel(days[days.length - 1] ?? to).md}
          </span>
          <button
            onClick={goNext}
            className="rounded p-1.5 hover:bg-surface-2"
            aria-label="Next week"
          >
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
          {unscheduledCount > 0 && (
            <span
              className="rounded-full bg-zinc-600/30 px-2.5 py-1 text-xs text-zinc-300"
              title="Unscheduled work items (the queue handles placement in a later release)"
            >
              {unscheduledCount} unscheduled
            </span>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={includeWeekends}
              onChange={(e) => setIncludeWeekends(e.target.checked)}
              className="accent-blue-500"
            />
            Weekends
          </label>
          {isLoading && (
            <span className="text-xs text-muted">Refreshing…</span>
          )}
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && !data ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-8 w-48 animate-pulse rounded bg-surface-2" />
              <div className="h-8 flex-1 animate-pulse rounded bg-surface-2" />
            </div>
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted">
          No crews to display for this period.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            {/* Header row */}
            <div className="flex border-b border-t-border bg-surface/60">
              <div className="sticky left-0 z-20 w-48 shrink-0 border-r border-t-border bg-surface px-2 py-2 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
                Crew / Resource
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
                      <div
                        className={`text-[0.65rem] font-semibold ${
                          isToday ? "text-blue-300" : "text-muted"
                        }`}
                      >
                        {dow}
                      </div>
                      <div className={`text-[0.6rem] ${isToday ? "text-blue-300" : "text-muted"}`}>
                        {md}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Location groups */}
            {grouped.map(({ location, resources }) => {
              const isCollapsed = collapsed[location];
              return (
                <div key={`grp-${location}`}>
                  <button
                    onClick={() => toggleLoc(location)}
                    className="flex w-full items-center gap-2 border-b border-t-border bg-surface-2/40 px-2 py-1.5 text-left hover:bg-surface-2/60"
                  >
                    <svg
                      className={`h-3 w-3 shrink-0 text-muted transition-transform ${
                        isCollapsed ? "" : "rotate-90"
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      {location}
                    </span>
                    <span className="text-[0.65rem] text-muted">({resources.length})</span>
                  </button>
                  {!isCollapsed &&
                    resources.map((resource) => (
                      <BoardRow
                        key={`row-${resource.id}`}
                        resource={resource}
                        days={days}
                        items={itemsByResource.get(resource.name) ?? []}
                        capacityByDate={
                          capacityByResourceDate.get(resource.id) ?? new Map()
                        }
                        onSelectItem={onSelectItem}
                      />
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
