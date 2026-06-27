"use client";

import { Suspense, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import { addDaysYmd, getTodayStr } from "@/lib/scheduling-utils";
import type { WorkItem } from "@/lib/scheduler-v2/types";
import { DispatchBoard } from "./DispatchBoard";
import { FilterBar } from "./FilterBar";
import { SavedViews } from "./SavedViews";
import { AttentionStrip } from "./AttentionStrip";
import { UnscheduledQueue } from "./UnscheduledQueue";
import { useBoardData } from "./useBoardData";
import { applyBoardFilters, useBoardFilters } from "./useBoardFilters";

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

  const handleSelect = (item: WorkItem) => {
    setSelectedItemId((prev) => (prev === item.id ? undefined : item.id));
  };

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
          />
        </div>
      </div>
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
