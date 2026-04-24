import type { TaskClassification } from "./types";

/**
 * Service task title → Work | Paperwork | Unknown classification.
 * Populated from scripts/enumerate-service-task-titles.ts output (spec §8.2)
 * run against prod on 2026-04-24.
 *
 * Work tasks: count toward scoring (numerator + denominator).
 * Paperwork tasks: excluded entirely — no credit, no penalty.
 * Unknown: defaults to paperwork (safe default — don't score things we can't classify).
 *
 * Matching:
 *   - Exact match against WORK_TITLES first
 *   - Then prefix match against WORK_PREFIXES (handles regional suffixes like
 *     " - Colorado", " - California", " - D&R")
 *   - Else falls through to paperwork check
 *
 * Update this when the enumeration script surfaces a new title.
 */

/** Exact matches (lowercased). */
const WORK_TITLES = new Set([
  "loose ends",
  "service",
  "roof check - service",
  "pre-wire",
  "walk roof",
  "detach",
  "tesla powerwall 3 upgrades",
].map((s) => s.toLowerCase()));

/**
 * Prefix matches (lowercased). Handles regional variants — any title starting
 * with one of these is classified as work.
 */
const WORK_PREFIXES = [
  "pv install",          // "PV Install", "PV Install - Colorado", "PV Install - California"
  "electrical install",  // "Electrical Install", "Electrical Install - Colorado", etc.
  "site survey",         // "Site Survey", "Site Survey - Colorado", "Site Survey - California"
  "inspection",          // "Inspection - Colorado", "Inspection - California", "Inspection - D&R"
];

const PAPERWORK_TITLES = new Set([
  "jha form",
  "xcel pto",
  "participate energy photos",
  "inventory test", // observed in enumeration — test/garbage data
].map((s) => s.toLowerCase()));

export function classifyTaskTitle(title: string): TaskClassification {
  const s = (title ?? "").toLowerCase().trim();
  if (WORK_TITLES.has(s)) return "work";
  for (const prefix of WORK_PREFIXES) {
    if (s.startsWith(prefix)) return "work";
  }
  if (PAPERWORK_TITLES.has(s)) return "paperwork";
  return "unknown";
}

/** For compliance v2 scoring: work only. Unknown defaults to paperwork-equivalent (skipped). */
export function isScoredTaskTitle(title: string): boolean {
  return classifyTaskTitle(title) === "work";
}
