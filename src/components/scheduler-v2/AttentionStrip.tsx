"use client";

import { useMemo } from "react";
import type { BoardData, WorkItem } from "@/lib/scheduler-v2/types";
import { useBoardFilters } from "./useBoardFilters";

/** A work item is "unscheduled" if it has no assignment / unscheduled status. */
export function isUnscheduled(item: WorkItem): boolean {
  return item.status === "unscheduled" || item.assignedResourceIds.length === 0;
}

/**
 * "Unfeasible" is not yet carried on `WorkItem` (conflict detection lands in a
 * later chunk via `/conflicts`). We expose an accessor so the strip renders the
 * count the moment a feasibility flag exists, and shows nothing until then.
 */
function isUnfeasible(item: WorkItem): boolean {
  const maybe = item as WorkItem & { isUnfeasible?: boolean };
  return maybe.isUnfeasible === true;
}

export interface AttentionStripProps {
  /** Already-filtered board data (same scope as the board + queue). */
  data: BoardData | undefined;
}

/**
 * One-line strip of actionable counts (overdue / unscheduled / unfeasible).
 * Each count is a button that applies the matching filter so the user can jump
 * straight to that subset. Counts are derived from the *filtered* data.
 */
export function AttentionStrip({ data }: AttentionStripProps) {
  const { setFilters } = useBoardFilters();

  const counts = useMemo(() => {
    const items = data?.workItems ?? [];
    let overdue = 0;
    let unscheduled = 0;
    let unfeasible = 0;
    for (const wi of items) {
      if (wi.isOverdue) overdue++;
      if (isUnscheduled(wi)) unscheduled++;
      if (isUnfeasible(wi)) unfeasible++;
    }
    return { overdue, unscheduled, unfeasible };
  }, [data?.workItems]);

  const chips: {
    key: string;
    count: number;
    label: string;
    tone: string;
    onClick: () => void;
    show: boolean;
  }[] = [
    {
      key: "overdue",
      count: counts.overdue,
      label: "overdue",
      tone: "bg-red-500/15 text-red-400 ring-1 ring-red-500/30 hover:bg-red-500/25",
      // Overdue has no dedicated filter slug; searching/highlighting is the
      // board's job. We scope to construction-stage items (where overdue is
      // most actionable) so the strip still narrows the view meaningfully.
      onClick: () => setFilters({ stages: ["construction"] }),
      show: true,
    },
    {
      key: "unscheduled",
      count: counts.unscheduled,
      label: "unscheduled",
      tone: "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30 hover:bg-zinc-500/25",
      onClick: () => setFilters({ stages: ["unscheduled"] }),
      show: true,
    },
    {
      key: "unfeasible",
      count: counts.unfeasible,
      label: "unfeasible",
      tone: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30 hover:bg-amber-500/25",
      onClick: () => setFilters({}),
      // Only render when feasibility data exists (avoids a permanent "0").
      show: counts.unfeasible > 0,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold uppercase tracking-wide text-muted">
        Needs attention
      </span>
      {chips
        .filter((c) => c.show)
        .map((c) => (
          <button
            key={c.key}
            onClick={c.onClick}
            disabled={c.count === 0}
            className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
              c.count === 0
                ? "cursor-default bg-surface-2/60 text-muted ring-1 ring-t-border"
                : c.tone
            }`}
          >
            {c.count} {c.label}
          </button>
        ))}
    </div>
  );
}
