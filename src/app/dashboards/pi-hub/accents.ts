/**
 * Per-team accent class strings for the P&I hub. Tailwind can only see class
 * names that appear as complete literals in the source — never string-built at
 * runtime — so every accent variant is spelled out in full here rather than
 * interpolated from a color fragment.
 */
import type { Team } from "@/lib/pi-hub/types";

export type Accent = "blue" | "green" | "yellow";

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
}

export const ACCENTS: Record<Accent, AccentClasses> = {
  blue: {
    filter: "blue",
    focusRing: "focus:ring-blue-500",
    tabActive: "border-blue-500 text-blue-600 dark:text-blue-400",
    tabActiveBadge: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    rowSelected: "bg-blue-500/10",
    primaryButton: "bg-blue-500 text-white hover:bg-blue-600",
  },
  green: {
    filter: "green",
    focusRing: "focus:ring-green-500",
    tabActive: "border-green-500 text-green-600 dark:text-green-400",
    tabActiveBadge: "bg-green-500/10 text-green-600 dark:text-green-400",
    rowSelected: "bg-green-500/10",
    primaryButton: "bg-green-500 text-white hover:bg-green-600",
  },
  yellow: {
    filter: "yellow",
    focusRing: "focus:ring-yellow-500",
    tabActive: "border-yellow-500 text-yellow-600 dark:text-yellow-400",
    tabActiveBadge: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    rowSelected: "bg-yellow-500/10",
    primaryButton: "bg-yellow-500 text-white hover:bg-yellow-600",
  },
};

/** Team → accent key. Mirrors TEAM_CONFIGS[team].accent without importing the
 *  config module into client bundles. */
export const ACCENT_FOR_TEAM: Record<Team, Accent> = {
  permit: "blue",
  ic: "green",
  pto: "yellow",
};
