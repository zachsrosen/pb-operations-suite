import type { TaskClassification } from "./types";

/**
 * Service task title → Work | Paperwork | Unknown classification.
 * Populated from scripts/enumerate-service-task-titles.ts output (spec §8.2).
 *
 * Work tasks: count toward scoring (numerator + denominator).
 * Paperwork tasks: excluded entirely — no credit, no penalty.
 * Unknown: defaults to paperwork (safe default — don't score things we can't classify).
 *
 * Update this table whenever the enumeration script surfaces a new title.
 */

const WORK_TITLES = new Set([
  "pv install - colorado",
  "pv install - california",
  "electrical install - colorado",
  "electrical install - california",
  "loose ends",
].map((s) => s.toLowerCase()));

const PAPERWORK_TITLES = new Set([
  "jha form",
  "xcel pto",
  "participate energy photos",
].map((s) => s.toLowerCase()));

export function classifyTaskTitle(title: string): TaskClassification {
  const s = (title ?? "").toLowerCase().trim();
  if (WORK_TITLES.has(s)) return "work";
  if (PAPERWORK_TITLES.has(s)) return "paperwork";
  return "unknown";
}

/** For compliance v2 scoring: work only. Unknown defaults to paperwork-equivalent (skipped). */
export function isScoredTaskTitle(title: string): boolean {
  return classifyTaskTitle(title) === "work";
}
