/**
 * Per-tab accent class strings. Tailwind can only see class names that appear
 * as complete literals in the source — never string-built at runtime — so
 * every accent variant is spelled out in full here rather than interpolated
 * from a color fragment.
 */
import type { Tab } from "@/lib/design-hub/types";

export type Accent = "purple" | "cyan";

export interface AccentClasses {
  /** MultiSelectFilter `accentColor` prop key. */
  filter: string;
  /** Search input focus ring. */
  focusRing: string;
  /** Active tab border + text. */
  tabActive: string;
  /** Active tab count badge. */
  tabActiveBadge: string;
  /** Selected queue-row background. */
  rowSelected: string;
  /** Primary external-link button (detail header). */
  primaryButton: string;
  /** Tab-switch loading banner (text + tint). */
  switchingBanner: string;
}

export const ACCENTS: Record<Accent, AccentClasses> = {
  purple: {
    filter: "purple",
    focusRing: "focus:ring-purple-500",
    tabActive: "border-purple-500 text-purple-600 dark:text-purple-400",
    tabActiveBadge: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    rowSelected: "bg-purple-500/10",
    primaryButton: "bg-purple-500 text-white hover:bg-purple-600",
    switchingBanner: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  },
  cyan: {
    filter: "cyan",
    focusRing: "focus:ring-cyan-500",
    tabActive: "border-cyan-500 text-cyan-600 dark:text-cyan-400",
    tabActiveBadge: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    rowSelected: "bg-cyan-500/10",
    primaryButton: "bg-cyan-500 text-white hover:bg-cyan-600",
    switchingBanner: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  },
};

/** Tab → accent key. Mirrors TAB_CONFIGS[tab].accent without importing the
 *  config module (server-only deps) into client bundles. */
export const ACCENT_FOR_TAB: Record<Tab, Accent> = {
  design: "purple",
  da: "cyan",
};
