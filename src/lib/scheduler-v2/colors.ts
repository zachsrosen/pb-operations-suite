import type { WorkItemStatus, WorkType } from "./types";

/**
 * Color classes for each WorkItemStatus (plus "overdue" and "forecast" pseudo-states).
 * Mirrors the v1 event color intent from scheduler/page.tsx around lines 4800-4828.
 * Uses theme-token-safe Tailwind classes; text-white is kept on colored fills per convention.
 */
export const STATUS_COLORS: Record<WorkItemStatus | "overdue" | "forecast", string> = {
  // Active statuses — solid fills with white text
  unscheduled: "bg-zinc-600 text-white",
  tentative: "bg-amber-500/70 text-black border border-dashed border-amber-300",
  scheduled: "bg-cyan-500 text-white",
  en_route: "bg-cyan-500 text-white",
  working: "bg-blue-500 text-white",
  // Terminal statuses — dimmed
  done: "bg-zinc-600/30 text-zinc-300/70",
  failed: "bg-amber-900/70 text-amber-200 ring-1 ring-amber-500 opacity-70 line-through",
  cancelled: "bg-zinc-600/30 text-zinc-300/70",
  // Pseudo-states
  overdue: "bg-blue-500/60 text-white ring-2 ring-red-500",
  forecast: "bg-blue-500/40 text-blue-200 border border-dashed border-blue-400 opacity-60",
};

/**
 * Accent color classes per WorkType, used for borders/badges.
 */
export const WORKTYPE_ACCENT: Record<WorkType, string> = {
  install: "border-l-blue-500 text-blue-400",
  survey: "border-l-cyan-500 text-cyan-400",
  inspection: "border-l-violet-500 text-violet-400",
  service: "border-l-emerald-500 text-emerald-400",
  roofing: "border-l-amber-500 text-amber-400",
  dnr: "border-l-orange-500 text-orange-400",
};

/**
 * Capacity utilization thresholds (percentage of capacity used).
 * Matches the legend in CapacityHeatmap.tsx:
 *   green  ≤ 80%
 *   yellow 81–100%
 *   orange 101–120%
 *   red    > 120%
 */
export const CAPACITY_THRESHOLDS = {
  green: 80,
  yellow: 100,
  orange: 120,
} as const;

/**
 * Returns a Tailwind background+text token class for a given utilization percentage.
 * Mirrors utilizationColor() in CapacityHeatmap.tsx.
 */
export function capacityColor(util: number): string {
  if (util <= CAPACITY_THRESHOLDS.green) return "bg-emerald-500/20 text-emerald-400";
  if (util <= CAPACITY_THRESHOLDS.yellow) return "bg-yellow-500/20 text-yellow-400";
  if (util <= CAPACITY_THRESHOLDS.orange) return "bg-orange-500/20 text-orange-400";
  return "bg-red-500/20 text-red-400";
}
