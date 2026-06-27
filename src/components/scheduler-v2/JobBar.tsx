"use client";

import { STATUS_COLORS, WORKTYPE_ACCENT } from "@/lib/scheduler-v2/colors";
import type { WorkItem } from "@/lib/scheduler-v2/types";
import { setDragPayload } from "./dragdrop";

/**
 * Deterministic accent hue (Tailwind ring color class) derived from a deal id.
 * Used so split sub-jobs (same parentDealId) get a shared visible hue ring,
 * letting a dispatcher see that two bars belong to the same project.
 */
const HUE_RINGS = [
  "ring-rose-400",
  "ring-sky-400",
  "ring-lime-400",
  "ring-fuchsia-400",
  "ring-teal-400",
  "ring-indigo-400",
  "ring-orange-400",
] as const;

function hueForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return HUE_RINGS[Math.abs(hash) % HUE_RINGS.length];
}

export interface JobBarProps {
  item: WorkItem;
  /** 1-based inclusive grid-column span within the parent grid. */
  gridColumnStart: number;
  gridColumnEnd: number; // exclusive (CSS grid-column end line)
  /** 1-based grid row (lane) within the parent grid. */
  gridRow?: number;
  onClick?: (item: WorkItem) => void;
  /** When true the bar can be dragged to another crew/day to reschedule. */
  draggable?: boolean;
  /** Notifies the parent that a drag started (so it can mark the source). */
  onDragStartItem?: (item: WorkItem) => void;
}

export function JobBar({
  item,
  gridColumnStart,
  gridColumnEnd,
  gridRow,
  onClick,
  draggable = false,
  onDragStartItem,
}: JobBarProps) {
  // Status fill: overdue/forecast pseudo-states take precedence over base status.
  const statusKey = item.isForecast
    ? "forecast"
    : item.isOverdue
      ? "overdue"
      : item.status;
  const statusCls = STATUS_COLORS[statusKey] ?? STATUS_COLORS.scheduled;
  const accentText = WORKTYPE_ACCENT[item.workType]?.split(" ").find((c) => c.startsWith("text-")) ?? "";

  // Split sub-jobs share a parent hue ring. Only render the ring when this item
  // is part of a split set (it has a parentDealId distinct from its own dealId).
  const isSplitChild = Boolean(item.parentDealId && item.parentDealId !== item.dealId);
  const hueRing = isSplitChild ? `ring-1 ${hueForKey(item.parentDealId as string)}` : "";

  // "No Zuper job" → dashed outline variant.
  const noJobCls = !item.hasZuperJob ? "border border-dashed border-amber-400/80" : "";

  const chip = item.subSystem ?? item.workType;
  const title = [
    item.customer,
    item.projectNumber ? `(${item.projectNumber})` : "",
    `· ${item.workType}${item.subSystem ? `/${item.subSystem}` : ""}`,
    item.scheduledStart ? `· ${item.scheduledStart}` : "",
    !item.hasZuperJob ? "· no Zuper job" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      onClick={() => onClick?.(item)}
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              setDragPayload(e, item.id);
              onDragStartItem?.(item);
            }
          : undefined
      }
      title={title}
      className={`relative z-10 my-1 mx-0.5 flex min-w-0 items-center gap-1 overflow-hidden rounded px-1.5 py-0.5 text-left text-[0.68rem] leading-tight ${statusCls} ${noJobCls} ${hueRing} hover:brightness-110 ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{
        gridColumn: `${gridColumnStart} / ${gridColumnEnd}`,
        ...(gridRow ? { gridRow } : {}),
      }}
    >
      <span className="truncate font-medium">{item.customer}</span>
      {item.projectNumber && (
        <span className="shrink-0 opacity-80">{item.projectNumber}</span>
      )}
      <span
        className={`ml-auto shrink-0 rounded bg-black/25 px-1 text-[0.6rem] uppercase tracking-wide ${accentText}`}
      >
        {chip}
      </span>
    </button>
  );
}
