/**
 * Shared label map + class strings for approval-signal UI (queue pill, header
 * chip, detail callout). Tailwind only sees complete literal class strings —
 * same rule as accents.ts — so every variant is spelled out in full. The pill
 * is always green regardless of team accent: it means "looks approved", not
 * "belongs to team X".
 */
import type { SignalType } from "@/lib/approval-scan/classify";

export const SIGNAL_LABELS: Record<SignalType, string> = {
  permit_issued: "Looks issued",
  ic_approved: "Looks approved",
  pto_granted: "Looks granted",
  xcel_photos_approved: "Photos approved?",
  inspection_passed: "Inspection passed?",
};

/** Fallback for a signalType this build doesn't know (deploy skew). */
export function signalLabel(signalType: SignalType): string {
  return SIGNAL_LABELS[signalType] ?? "Looks approved";
}

/** Queue-row pill — sits in the Stale-badge slot, styled like it but green. */
export const SIGNAL_PILL_CLASS =
  "shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400";

/** Header chip, toggled state (filter active). */
export const SIGNAL_CHIP_ACTIVE_CLASS =
  "rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold text-white transition-colors";

/** Header chip, resting state. */
export const SIGNAL_CHIP_CLASS =
  "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400";
