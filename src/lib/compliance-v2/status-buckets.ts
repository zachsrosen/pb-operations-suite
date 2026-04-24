import type { TaskBucket } from "./types";

/**
 * Expanded parent-job status bucket sets. Based on enumeration from spec §8.1
 * over 4,314 jobs in 90 days.
 *
 * All comparisons are case-insensitive via toLowerCase() at classification time.
 */

const COMPLETED_FULL = new Set([
  "completed",
  "completed - av",
  "construction complete",
  "passed",
  "partial pass",
].map((s) => s.toLowerCase()));

const COMPLETED_FOLLOW_UP = new Set([
  "return visit required",
  "loose ends remaining",
  "needs revisit",
].map((s) => s.toLowerCase()));

const COMPLETED_FAILED = new Set([
  "failed",
].map((s) => s.toLowerCase()));

const STUCK = new Set([
  "started",
  "started - av",
  "on our way",
  "on my way",
  "on my way - av",
  "in progress",
].map((s) => s.toLowerCase()));

const NEVER_STARTED = new Set([
  "new",
  "scheduled",
  "scheduled - av",
  "unassigned",
  "ready to schedule",
  "ready to build",
  "ready for inspection",
].map((s) => s.toLowerCase()));

const EXCLUDED = new Set([
  "on hold",
  "scheduling on-hold",
  "ready to forecast",
].map((s) => s.toLowerCase()));

export const JOB_BUCKET = {
  COMPLETED_FULL,
  COMPLETED_FOLLOW_UP,
  COMPLETED_FAILED,
  STUCK,
  NEVER_STARTED,
  EXCLUDED,
} as const;

/** Classify a parent job status string into a bucket. Unknown → excluded. */
export function classifyJobStatus(status: string): TaskBucket {
  const s = (status ?? "").toLowerCase().trim();
  if (COMPLETED_FULL.has(s)) return "completed-full";
  if (COMPLETED_FOLLOW_UP.has(s)) return "completed-follow-up";
  if (COMPLETED_FAILED.has(s)) return "completed-failed";
  if (STUCK.has(s)) return "stuck";
  if (NEVER_STARTED.has(s)) return "never-started";
  return "excluded";
}

/**
 * Task-level status buckets. Populated from spec §8.3 enumeration output.
 * Default values here — adjust after running scripts/enumerate-service-task-statuses.ts
 * and reviewing its output.
 */
const TASK_COMPLETED = new Set([
  "completed",
].map((s) => s.toLowerCase()));

const TASK_STUCK = new Set([
  "started",
  "in_progress",
  "in progress",
].map((s) => s.toLowerCase()));

const TASK_NEVER_STARTED = new Set([
  "new",
  "scheduled",
].map((s) => s.toLowerCase()));

const TASK_EXCLUDED = new Set([
  "cancelled",
  "skipped",
].map((s) => s.toLowerCase()));

export const TASK_BUCKET = {
  COMPLETED: TASK_COMPLETED,
  STUCK: TASK_STUCK,
  NEVER_STARTED: TASK_NEVER_STARTED,
  EXCLUDED: TASK_EXCLUDED,
} as const;

export function classifyTaskStatus(status: string): TaskBucket {
  const s = (status ?? "").toLowerCase().trim();
  if (TASK_COMPLETED.has(s)) return "completed-full";
  if (TASK_STUCK.has(s)) return "stuck";
  if (TASK_NEVER_STARTED.has(s)) return "never-started";
  return "excluded";
}
