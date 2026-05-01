/**
 * Canonical Line-of-Business color palette.
 *
 * Use these tokens whenever a UI surfaces LOB categories side-by-side with
 * other dashboards (master calendar, executive calendar, revenue calendar,
 * service dashboards, etc.) so each LOB reads consistently across the suite.
 *
 * Source of truth: scheduler "master calendar" overlay event colors.
 *
 * If you need a *new* color for a milestone, stage, or aggregate (e.g.
 * "Total Revenue"), pick a token NOT in this set so the legend stays
 * unambiguous.
 */

/** LOBs that show up in scheduling/calendar surfaces. */
export type LobKey =
  | "construction"
  | "service"
  | "dnr"        // Detach & Reset (parent)
  | "detach"     // D&R sub-category — pull panels before roof work
  | "reset"      // D&R sub-category — re-install panels after roof work
  | "roofing"
  | "survey"
  | "inspection";

export interface LobColor {
  /** Tailwind background utility for solid fills (e.g. event chips). */
  solidBg: string;
  /** Tailwind text utility for accent text (totals, labels). */
  text: string;
  /** Tailwind dot utility for legend bullets. */
  dot: string;
  /** Tailwind background utility for translucent badge backgrounds. */
  badgeBg: string;
  /** Tailwind text utility for translucent badge text. */
  badgeText: string;
  /** Tailwind border utility for left-accent borders. */
  borderLeft: string;
}

export const LOB_COLORS: Record<LobKey, LobColor> = {
  construction: {
    solidBg: "bg-blue-500",
    text: "text-blue-400",
    dot: "bg-blue-500",
    badgeBg: "bg-blue-500/20",
    badgeText: "text-blue-400",
    borderLeft: "border-l-blue-500",
  },
  service: {
    solidBg: "bg-purple-500",
    text: "text-purple-400",
    dot: "bg-purple-500",
    badgeBg: "bg-purple-500/20",
    badgeText: "text-purple-400",
    borderLeft: "border-l-purple-500",
  },
  dnr: {
    solidBg: "bg-amber-500",
    text: "text-amber-400",
    dot: "bg-amber-500",
    badgeBg: "bg-amber-500/20",
    badgeText: "text-amber-400",
    borderLeft: "border-l-amber-500",
  },
  detach: {
    // D&R primary: same family as dnr parent, darker shade for distinction.
    solidBg: "bg-amber-600",
    text: "text-amber-500",
    dot: "bg-amber-600",
    badgeBg: "bg-amber-600/20",
    badgeText: "text-amber-500",
    borderLeft: "border-l-amber-600",
  },
  reset: {
    // D&R secondary: orange — distinct from amber but in the same warm family.
    solidBg: "bg-orange-500",
    text: "text-orange-400",
    dot: "bg-orange-500",
    badgeBg: "bg-orange-500/20",
    badgeText: "text-orange-400",
    borderLeft: "border-l-orange-500",
  },
  roofing: {
    solidBg: "bg-rose-500",
    text: "text-rose-400",
    dot: "bg-rose-500",
    badgeBg: "bg-rose-500/20",
    badgeText: "text-rose-400",
    borderLeft: "border-l-rose-500",
  },
  survey: {
    solidBg: "bg-cyan-500",
    text: "text-cyan-400",
    dot: "bg-cyan-500",
    badgeBg: "bg-cyan-500/20",
    badgeText: "text-cyan-400",
    borderLeft: "border-l-cyan-500",
  },
  inspection: {
    solidBg: "bg-violet-500",
    text: "text-violet-400",
    dot: "bg-violet-500",
    badgeBg: "bg-violet-500/20",
    badgeText: "text-violet-400",
    borderLeft: "border-l-violet-500",
  },
};

/**
 * Aggregate / total tokens. Pick from these when you need a color that is
 * NOT one of the LOB colors — keeps "Total Revenue" / "Total Jobs" /
 * "Forecasted" distinct from any single LOB.
 */
export const AGGREGATE_COLORS = {
  totalRevenue: "text-green-400",
  totalJobs: "text-muted",
  forecasted: "text-amber-300",
} as const;
