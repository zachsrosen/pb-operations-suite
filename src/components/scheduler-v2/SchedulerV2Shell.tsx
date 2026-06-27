"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import { addDaysYmd, getTodayStr } from "@/lib/scheduling-utils";
import type { Resource, WorkItem } from "@/lib/scheduler-v2/types";
import { DispatchBoard } from "./DispatchBoard";
import { FilterBar } from "./FilterBar";
import { SavedViews } from "./SavedViews";
import { AttentionStrip } from "./AttentionStrip";
import { UnscheduledQueue } from "./UnscheduledQueue";
import { useBoardData } from "./useBoardData";
import { applyBoardFilters, useBoardFilters } from "./useBoardFilters";
import { ScheduleDrawer, type ScheduleWriteResult } from "./ScheduleDrawer";
import { UndoSnackbar, type UndoTarget } from "./UndoSnackbar";

/** Feature flag: drag/drop write affordances. Default off in production. */
const DRAG_ENABLED = process.env.NEXT_PUBLIC_SCHEDULER_V2_DND === "true";

/** Monday of the week containing `dateStr`. */
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0=Sun
  const delta = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Inner shell: owns the board fetch + week window + filter state so the
 * FilterBar (built from unfiltered data), AttentionStrip, UnscheduledQueue, and
 * DispatchBoard all share one scoped `BoardData`.
 *
 * Wrapped in <Suspense> by the default export because `useBoardFilters` reads
 * `useSearchParams`, which Next.js requires to be inside a Suspense boundary.
 */
function SchedulerV2ShellInner() {
  const { filters } = useBoardFilters();
  const [weekStart, setWeekStart] = useState<string>(() =>
    mondayOf(getTodayStr())
  );
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>(
    undefined
  );

  const from = weekStart;
  const to = addDaysYmd(weekStart, 6);

  const { data, isLoading, error, refetch } = useBoardData({ from, to });

  // One filter set scopes BOTH the board and the queue.
  const filtered = useMemo(
    () => (data ? applyBoardFilters(data, filters) : undefined),
    [data, filters]
  );

  // ----- ScheduleDrawer + Undo orchestration -----
  const [drawer, setDrawer] = useState<{ item: WorkItem; resource: Resource; date: string } | null>(
    null,
  );
  const [undoTarget, setUndoTarget] = useState<UndoTarget | null>(null);
  // Lifted so both the queue (drag source) and board (drop target) share it.
  const [draggedItem, setDraggedItem] = useState<WorkItem | null>(null);
  // The drop in progress, captured so onWriteSuccess can compute the inverse.
  const [pendingDrop, setPendingDrop] = useState<{
    item: WorkItem;
    fromResource?: Resource;
    fromDate?: string;
  } | null>(null);

  const handleSelect = (item: WorkItem) => {
    setSelectedItemId((prev) => (prev === item.id ? undefined : item.id));
  };

  /**
   * Resolve the resource a work item is CURRENTLY assigned to (its previous slot
   * for undo purposes), by walking the board's assignments → resources.
   */
  const findCurrentPlacement = useCallback(
    (item: WorkItem): { resource?: Resource; date?: string } => {
      if (!data) return {};
      const assignment = data.assignments.find((a) => a.workItemId === item.id);
      if (!assignment) return { date: item.scheduledStart };
      const resource = data.resources.find((r) => r.name === assignment.resourceName);
      return { resource, date: assignment.date || item.scheduledStart };
    },
    [data],
  );

  const handleDropItem = useCallback(
    (item: WorkItem, resource: Resource, date: string) => {
      const prev = findCurrentPlacement(item);
      setPendingDrop({ item, fromResource: prev.resource, fromDate: prev.date });
      setDrawer({ item, resource, date });
    },
    [findCurrentPlacement],
  );

  const handleWriteSuccess = useCallback(
    (result: ScheduleWriteResult) => {
      refetch();
      // Offer undo back to the previous placement (drawer-confirmed, never auto-fired).
      if (pendingDrop) {
        setUndoTarget({
          item: pendingDrop.item,
          previousDate: pendingDrop.fromDate,
          previousResource: pendingDrop.fromResource,
          newDate: result.committed.date,
          newResourceName: result.committed.resource.name,
        });
        setPendingDrop(null);
      }
    },
    [refetch, pendingDrop],
  );

  /** Undo re-opens the drawer pre-filled with the previous slot (human confirms). */
  const handleUndo = useCallback((target: UndoTarget) => {
    if (!target.previousResource || !target.previousDate) return;
    setUndoTarget(null);
    setPendingDrop(null); // undo of an undo is out of scope; no chained snackbar
    setDrawer({
      item: target.item,
      resource: target.previousResource,
      date: target.previousDate,
    });
  }, []);

  return (
    <div className="space-y-3">
      {/* Top controls: saved views + filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-t-border bg-surface p-3 shadow-card">
        <SavedViews />
        <FilterBar data={data} />
      </div>

      {/* Attention strip (counts derived from filtered data) */}
      <div className="rounded-xl border border-t-border bg-surface px-3 py-2 shadow-card">
        <AttentionStrip data={filtered} />
      </div>

      {/* Left rail queue + board */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <UnscheduledQueue
          data={filtered}
          selectedItemId={selectedItemId}
          onSelectItem={handleSelect}
          draggable={DRAG_ENABLED}
          onDragStartItem={setDraggedItem}
        />
        <div className="min-w-0 flex-1">
          <DispatchBoard
            data={filtered}
            isLoading={isLoading}
            error={error}
            refetch={refetch}
            weekStart={weekStart}
            onWeekStartChange={setWeekStart}
            onSelectItem={handleSelect}
            dragEnabled={DRAG_ENABLED}
            onDropItem={handleDropItem}
            draggedItem={draggedItem}
            onDraggedItemChange={setDraggedItem}
          />
        </div>
      </div>

      {/* Write layer: drawer (explicit human confirm) + undo snackbar */}
      <ScheduleDrawer
        open={drawer !== null}
        workItem={drawer?.item ?? null}
        resource={drawer?.resource ?? null}
        date={drawer?.date ?? ""}
        onClose={() => setDrawer(null)}
        onWriteSuccess={handleWriteSuccess}
      />
      <UndoSnackbar
        target={undoTarget}
        onUndo={handleUndo}
        onDismiss={() => setUndoTarget(null)}
      />
    </div>
  );
}

export default function SchedulerV2Shell() {
  return (
    <DashboardShell title="Dispatch Board" accentColor="blue" fullWidth>
      <Suspense
        fallback={
          <div className="space-y-2 p-4">
            <div className="h-10 w-full animate-pulse rounded bg-surface-2" />
            <div className="h-64 w-full animate-pulse rounded bg-surface-2" />
          </div>
        }
      >
        <SchedulerV2ShellInner />
      </Suspense>
    </DashboardShell>
  );
}
