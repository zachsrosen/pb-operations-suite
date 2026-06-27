"use client";

import { useMemo, useState } from "react";
import { getTodayStr } from "@/lib/scheduling-utils";
import { getCustomerName } from "@/lib/scheduler-v2/normalize";
import { WORKTYPE_ACCENT } from "@/lib/scheduler-v2/colors";
import type { BoardData, WorkItem } from "@/lib/scheduler-v2/types";
import { isUnscheduled } from "./AttentionStrip";
import { setDragPayload } from "./dragdrop";

/* ------------------------------------------------------------------ */
/*  Age derivation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Age in days for an unscheduled work item.
 *
 * `WorkItem` carries no creation timestamp, so there is no true "days waiting"
 * value. We approximate:
 *   - If `scheduledStart` exists (e.g. an overdue item still sitting in the
 *     pool), age = days since that date.
 *   - Otherwise age is unknown → returns null; callers fall back to value sort.
 */
function ageDaysOf(item: WorkItem, today: string): number | null {
  if (!item.scheduledStart) return null;
  const [ty, tm, td] = today.split("-").map(Number);
  const [sy, sm, sd] = item.scheduledStart.split("-").map(Number);
  const t = Date.UTC(ty, tm - 1, td);
  const s = Date.UTC(sy, sm - 1, sd);
  return Math.round((t - s) / 86_400_000);
}

/** Age-color thresholds mirrored from `service-unscheduled` page. */
function ageBadgeColor(ageDays: number | null): string {
  if (ageDays === null) return "text-foreground/70 bg-surface-2/50";
  if (ageDays >= 14) return "text-red-400 bg-red-400/10";
  if (ageDays >= 7) return "text-orange-400 bg-orange-400/10";
  if (ageDays >= 3) return "text-amber-400 bg-amber-400/10";
  return "text-foreground/70 bg-surface-2/50";
}

function formatValue(value?: number): string {
  if (value == null) return "—";
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `$${value.toLocaleString()}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

type SortMode = "age" | "value";

export interface UnscheduledQueueProps {
  /** Already-filtered board data (same scope as the board + attention strip). */
  data: BoardData | undefined;
  selectedItemId?: string;
  onSelectItem?: (item: WorkItem) => void;
  /** Enables dragging cards onto crew rows to schedule them. */
  draggable?: boolean;
  /** Fired when a card drag starts (board uses it to show the live conflict chip). */
  onDragStartItem?: (item: WorkItem) => void;
}

/**
 * Left-rail queue of unscheduled work items (not placed on the board), grouped
 * Unassigned / Overdue and sortable by age or value. Cards are click-to-select
 * only — drag/drop arrives in the next chunk.
 */
export function UnscheduledQueue({
  data,
  selectedItemId,
  onSelectItem,
  draggable = false,
  onDragStartItem,
}: UnscheduledQueueProps) {
  const [sortMode, setSortMode] = useState<SortMode>("age");
  const today = getTodayStr();

  const { unassigned, overdue } = useMemo(() => {
    const pool = (data?.workItems ?? []).filter(isUnscheduled);

    const sortFn = (a: WorkItem, b: WorkItem) => {
      if (sortMode === "value") {
        return (b.value ?? 0) - (a.value ?? 0);
      }
      // age desc; items with a known age rank above value-only items, then by
      // value as the tiebreaker (mirrors the "fall back to value" requirement).
      const aa = ageDaysOf(a, today);
      const ba = ageDaysOf(b, today);
      if (aa !== null && ba !== null) return ba - aa;
      if (aa !== null) return -1;
      if (ba !== null) return 1;
      return (b.value ?? 0) - (a.value ?? 0);
    };

    const overdueItems = pool.filter((wi) => wi.isOverdue).sort(sortFn);
    const overdueIds = new Set(overdueItems.map((wi) => wi.id));
    const unassignedItems = pool
      .filter((wi) => !overdueIds.has(wi.id))
      .sort(sortFn);

    return { unassigned: unassignedItems, overdue: overdueItems };
  }, [data?.workItems, sortMode, today]);

  const total = unassigned.length + overdue.length;

  return (
    <aside className="flex w-full flex-col rounded-xl border border-t-border bg-surface shadow-card lg:w-72 lg:shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-t-border p-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Unscheduled</h2>
          <p className="text-[0.65rem] text-muted">{total} awaiting a slot</p>
        </div>
        <div className="flex overflow-hidden rounded-md border border-t-border text-[0.65rem]">
          {(["age", "value"] as SortMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              className={`px-2 py-1 capitalize transition-colors ${
                sortMode === mode
                  ? "bg-blue-500/20 text-blue-300"
                  : "bg-surface-2 text-muted hover:text-foreground"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[70vh] overflow-y-auto p-2">
        {total === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted">
            Nothing unscheduled in the current filter.
          </p>
        ) : (
          <>
            {overdue.length > 0 && (
              <QueueGroup
                title="Overdue"
                count={overdue.length}
                tone="text-red-400"
                items={overdue}
                today={today}
                selectedItemId={selectedItemId}
                onSelectItem={onSelectItem}
                draggable={draggable}
                onDragStartItem={onDragStartItem}
              />
            )}
            {unassigned.length > 0 && (
              <QueueGroup
                title="Unassigned"
                count={unassigned.length}
                tone="text-muted"
                items={unassigned}
                today={today}
                selectedItemId={selectedItemId}
                onSelectItem={onSelectItem}
                draggable={draggable}
                onDragStartItem={onDragStartItem}
              />
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function QueueGroup({
  title,
  count,
  tone,
  items,
  today,
  selectedItemId,
  onSelectItem,
  draggable,
  onDragStartItem,
}: {
  title: string;
  count: number;
  tone: string;
  items: WorkItem[];
  today: string;
  selectedItemId?: string;
  onSelectItem?: (item: WorkItem) => void;
  draggable?: boolean;
  onDragStartItem?: (item: WorkItem) => void;
}) {
  return (
    <div className="mb-3">
      <div className="px-1 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-wide">
        <span className={tone}>{title}</span>
        <span className="ml-1 text-muted">({count})</span>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <QueueCard
            key={item.id}
            item={item}
            today={today}
            selected={item.id === selectedItemId}
            onSelectItem={onSelectItem}
            draggable={draggable}
            onDragStartItem={onDragStartItem}
          />
        ))}
      </div>
    </div>
  );
}

function QueueCard({
  item,
  today,
  selected,
  onSelectItem,
  draggable,
  onDragStartItem,
}: {
  item: WorkItem;
  today: string;
  selected: boolean;
  onSelectItem?: (item: WorkItem) => void;
  draggable?: boolean;
  onDragStartItem?: (item: WorkItem) => void;
}) {
  const ageDays = ageDaysOf(item, today);
  const accent = WORKTYPE_ACCENT[item.workType] ?? "border-l-zinc-500 text-zinc-400";
  const customer = getCustomerName(item.customer);

  return (
    <button
      type="button"
      onClick={() => onSelectItem?.(item)}
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              setDragPayload(e, item.id);
              onDragStartItem?.(item);
            }
          : undefined
      }
      className={`w-full rounded-lg border-l-2 border border-t-border bg-surface-2/40 p-2 text-left transition-colors hover:bg-surface-2 ${
        accent.split(" ").find((c) => c.startsWith("border-l-")) ?? ""
      } ${selected ? "ring-2 ring-blue-500/60" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground">
          {customer}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-medium ${ageBadgeColor(
            ageDays
          )}`}
          title={ageDays === null ? "No age data" : `${ageDays} days`}
        >
          {ageDays === null ? "—" : `${ageDays}d`}
        </span>
      </div>

      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.65rem] text-muted">
        {item.projectNumber && (
          <span className="font-mono">{item.projectNumber}</span>
        )}
        <span>{item.location}</span>
        <span className="font-medium text-foreground/70">
          {formatValue(item.value)}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-1.5">
        <span
          className={`text-[0.6rem] font-medium capitalize ${
            accent.split(" ").find((c) => c.startsWith("text-")) ?? "text-muted"
          }`}
        >
          {item.workType}
        </span>
        {item.hasZuperJob === false && (
          <span
            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-amber-400 ring-1 ring-amber-500/30"
            title="No Zuper job exists yet — assigning will create one"
          >
            no Zuper job
          </span>
        )}
      </div>
    </button>
  );
}
