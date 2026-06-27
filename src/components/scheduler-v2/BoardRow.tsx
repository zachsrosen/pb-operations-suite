"use client";

import { useMemo } from "react";
import { getBusinessDatesInSpan } from "@/lib/scheduling-utils";
import type {
  CapacityCell,
  Resource,
  WorkItem,
} from "@/lib/scheduler-v2/types";
import { CapacityBar } from "./CapacityBar";
import { JobBar } from "./JobBar";

export interface BoardRowProps {
  resource: Resource;
  /** Ordered list of business-day YYYY-MM-DD columns rendered by the board. */
  days: string[];
  /** Work items assigned to this resource (already filtered by the board). */
  items: WorkItem[];
  /** Capacity cells for this resource keyed by date (board passes the slice). */
  capacityByDate: Map<string, CapacityCell>;
  onSelectItem?: (item: WorkItem) => void;
}

interface PlacedItem {
  item: WorkItem;
  startCol: number; // 1-based inclusive grid column
  endCol: number; // exclusive grid line
}

/**
 * Resolve a work item's visible column span within `days`.
 * Uses scheduledStart + durationDays (business days). Clamps to the window.
 * Returns null if the item does not overlap the visible window at all.
 */
function placeItem(item: WorkItem, days: string[]): PlacedItem | null {
  const start = item.scheduledStart;
  if (!start) return null;

  const span = getBusinessDatesInSpan(start, Math.max(1, item.durationDays || 1));
  const end = item.scheduledEnd && item.scheduledEnd >= start
    ? item.scheduledEnd
    : span[span.length - 1] || start;

  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  if (!firstDay || !lastDay) return null;
  if (end < firstDay || start > lastDay) return null; // no overlap

  // Find first column >= start, last column <= end.
  let startIdx = days.indexOf(start);
  if (startIdx === -1) startIdx = days.findIndex((d) => d >= start);
  if (startIdx === -1) startIdx = 0;

  let endIdx = days.indexOf(end);
  if (endIdx === -1) {
    // last day that is <= end
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i] <= end) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1 || endIdx < startIdx) endIdx = startIdx;

  return { item, startCol: startIdx + 1, endCol: endIdx + 2 };
}

export function BoardRow({
  resource,
  days,
  items,
  capacityByDate,
  onSelectItem,
}: BoardRowProps) {
  // Place items, then assign each a lane (row) so overlapping spans stack
  // instead of colliding. Greedy interval layout by start column.
  const { lanes, laneCount } = useMemo(() => {
    const ps = items
      .map((it) => placeItem(it, days))
      .filter((p): p is PlacedItem => p !== null)
      .sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol);

    const laneEnds: number[] = []; // exclusive end line currently occupying each lane
    const withLane = ps.map((p) => {
      let lane = laneEnds.findIndex((end) => end <= p.startCol);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(p.endCol);
      } else {
        laneEnds[lane] = p.endCol;
      }
      return { ...p, lane };
    });
    return { lanes: withLane, laneCount: Math.max(1, laneEnds.length) };
  }, [items, days]);

  const muted = !resource.assignable;

  return (
    <div className="flex border-b border-t-border last:border-b-0 hover:bg-surface/40">
      {/* Sticky left identity cell */}
      <div
        className={`sticky left-0 z-20 w-48 shrink-0 border-r border-t-border bg-surface px-2 py-1.5 ${
          muted ? "opacity-50" : ""
        }`}
        title={muted ? "not on current crew" : undefined}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: resource.color }}
            aria-hidden
          />
          <span className="truncate text-sm font-medium text-foreground">
            {resource.name}
          </span>
        </div>
        {resource.role && (
          <div className="truncate pl-4 text-[0.65rem] text-muted">{resource.role}</div>
        )}
      </div>

      {/* Day cells + job bars + capacity track */}
      <div className="relative min-w-0 flex-1">
        {/* job bar grid: one explicit row per lane so overlapping spans stack */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${days.length}, minmax(56px, 1fr))`,
            gridTemplateRows: `repeat(${laneCount}, minmax(28px, auto))`,
          }}
        >
          {/* background day cells spanning all lanes */}
          {days.map((day, i) => (
            <div
              key={`cell-${resource.id}-${day}`}
              className="border-r border-t-border/50 last:border-r-0"
              style={{ gridColumn: `${i + 1} / ${i + 2}`, gridRow: "1 / -1" }}
            />
          ))}
          {lanes.map((p) => (
            <JobBar
              key={`bar-${p.item.id}`}
              item={p.item}
              gridColumnStart={p.startCol}
              gridColumnEnd={p.endCol}
              gridRow={p.lane + 1}
              onClick={onSelectItem}
            />
          ))}
        </div>

        {/* capacity track under the row, one bar per day */}
        <div
          className="grid border-t border-t-border/40"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(56px, 1fr))` }}
        >
          {days.map((day) => {
            const cell = capacityByDate.get(day);
            return (
              <div
                key={`cap-${resource.id}-${day}`}
                className="flex items-center px-0.5 py-[3px]"
              >
                {cell ? (
                  <CapacityBar cell={cell} />
                ) : (
                  <div className="h-[3px] w-full rounded-full bg-surface-2/40" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
