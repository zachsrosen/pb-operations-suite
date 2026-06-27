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
import {
  getDragPayload,
  hasHardConflict,
  type ConflictProbeState,
  type ProbeArgs,
} from "./dragdrop";

/**
 * Drag/drop wiring the board threads into each row. All optional so the row
 * still renders without DnD (tests / isolated use).
 */
export interface BoardRowDnd {
  /** The WorkItem currently being dragged (null when no drag in flight). */
  draggedItem: WorkItem | null;
  /** Latest conflict-probe result + which target it reflects. */
  probeState: ConflictProbeState;
  /** Fire a (debounced) conflict probe for a hovered cell. */
  probe: (args: ProbeArgs) => void;
  /** Clear probe state (drag left the board / ended). */
  clearProbe: () => void;
  /** Commit a drop onto this resource + date (opens the drawer / quick-confirm). */
  onDropItem: (item: WorkItem, resource: Resource, date: string) => void;
}

export interface BoardRowProps {
  resource: Resource;
  /** Ordered list of business-day YYYY-MM-DD columns rendered by the board. */
  days: string[];
  /** Work items assigned to this resource (already filtered by the board). */
  items: WorkItem[];
  /** Capacity cells for this resource keyed by date (board passes the slice). */
  capacityByDate: Map<string, CapacityCell>;
  onSelectItem?: (item: WorkItem) => void;
  /** Drag bars to reschedule them. */
  draggable?: boolean;
  onDragStartItem?: (item: WorkItem) => void;
  /** Drop-target wiring; when omitted the row is not a drop target. */
  dnd?: BoardRowDnd;
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
  draggable = false,
  onDragStartItem,
  dnd,
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
              draggable={draggable}
              onDragStartItem={onDragStartItem}
            />
          ))}
        </div>

        {/* Drop-target overlay — only interactive while a drag is in flight. */}
        {dnd && dnd.draggedItem && (
          <div
            className="pointer-events-none absolute inset-0 grid"
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(56px, 1fr))` }}
          >
            {days.map((day, i) => (
              <DropCell
                key={`drop-${resource.id}-${day}`}
                colIndex={i}
                day={day}
                resource={resource}
                dnd={dnd}
              />
            ))}
          </div>
        )}

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

/**
 * A single drop-target cell that lights up on drag-over, probes conflicts, shows
 * a live chip, and blocks the drop when a hard conflict exists.
 *
 * Hard conflicts (double_book / weekend_holiday / lead_time) → red chip + the
 * drop is rejected. Soft (over_capacity / travel) → amber "schedule anyway" chip
 * and the drop is allowed (the drawer is the explicit confirm step).
 */
function DropCell({
  colIndex,
  day,
  resource,
  dnd,
}: {
  colIndex: number;
  day: string;
  resource: Resource;
  dnd: BoardRowDnd;
}) {
  const { draggedItem, probe, probeState, onDropItem } = dnd;
  const targetKey = `${resource.id}|${day}`;
  const isActiveTarget = probeState.targetKey === targetKey;
  const result = isActiveTarget ? probeState.result : null;
  const hard = isActiveTarget && hasHardConflict(result);
  const soft = isActiveTarget && !hard && Boolean(result && result.soft.length > 0);

  const chipMsg = isActiveTarget && result
    ? (result.hard[0]?.message ?? result.soft[0]?.message ?? null)
    : null;

  function handleDragOver(e: React.DragEvent) {
    if (!draggedItem) return;
    e.preventDefault();
    // Reject the drop visually when a hard conflict is present.
    e.dataTransfer.dropEffect = hard ? "none" : "move";
    probe({
      targetKey,
      workItemId: draggedItem.id,
      dealId: draggedItem.dealId,
      resourceId: resource.zuperUserUid ?? resource.id,
      location: draggedItem.location,
      date: day,
      days: Math.max(1, draggedItem.durationDays || 1),
      workType: draggedItem.workType,
    });
  }

  function handleDrop(e: React.DragEvent) {
    if (!draggedItem) return;
    e.preventDefault();
    const droppedId = getDragPayload(e);
    if (droppedId && droppedId !== draggedItem.id) return; // mismatched payload
    if (hard) return; // hard conflict blocks the drop entirely
    onDropItem(draggedItem, resource, day);
  }

  return (
    <div
      className={`pointer-events-auto relative border-r border-t-border/30 last:border-r-0 transition-colors ${
        isActiveTarget
          ? hard
            ? "bg-red-500/15 ring-1 ring-inset ring-red-500/50"
            : soft
              ? "bg-amber-500/15 ring-1 ring-inset ring-amber-500/50"
              : "bg-blue-500/10 ring-1 ring-inset ring-blue-500/40"
          : "hover:bg-blue-500/5"
      }`}
      style={{ gridColumn: `${colIndex + 1} / ${colIndex + 2}` }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      aria-label={`Drop on ${resource.name} ${day}`}
    >
      {isActiveTarget && (hard || soft) && (
        <div
          className={`pointer-events-none absolute left-1/2 top-0 z-30 -translate-x-1/2 whitespace-nowrap rounded px-1.5 py-0.5 text-[0.6rem] font-semibold shadow-lg ${
            hard ? "bg-red-600 text-white" : "bg-amber-500 text-black"
          }`}
        >
          {hard ? (chipMsg ?? "Blocked") : "Schedule anyway"}
        </div>
      )}
    </div>
  );
}
