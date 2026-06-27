"use client";

import { capacityColor } from "@/lib/scheduler-v2/colors";
import type { CapacityCell } from "@/lib/scheduler-v2/types";

/**
 * Thin (2-3px) utilization bar for a single CapacityCell.
 * Width is unimportant (it fills the day cell); the color encodes load/capacity.
 */
export function CapacityBar({ cell }: { cell: CapacityCell }) {
  const capacity = cell.capacityDays > 0 ? cell.capacityDays : 0;
  const util = capacity > 0 ? (cell.loadDays / capacity) * 100 : cell.loadDays > 0 ? 999 : 0;
  // capacityColor returns "bg-* text-*"; we only want the bg portion for the bar fill.
  const cls = capacityColor(util)
    .split(" ")
    .filter((c) => c.startsWith("bg-"))
    .join(" ");

  const loadLabel = Number.isInteger(cell.loadDays) ? cell.loadDays : cell.loadDays.toFixed(1);
  const capLabel = Number.isInteger(capacity) ? capacity : capacity.toFixed(1);

  return (
    <div
      className={`h-[3px] w-full rounded-full ${cls || "bg-surface-2"}`}
      title={`${loadLabel}/${capLabel} crew-days`}
      aria-label={`${loadLabel} of ${capLabel} crew-days`}
    />
  );
}
