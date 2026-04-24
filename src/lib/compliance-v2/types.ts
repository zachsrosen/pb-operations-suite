/**
 * Types specific to the v2 per-service-task compliance scoring engine.
 *
 * Mirrors EmployeeCompliance from office-performance-types.ts but replaces
 * integer totalJobs with fractional tasksFractional (1/N-weighted credits).
 */

/** Status bucket assigned to a service task. */
export type TaskBucket =
  | "completed-full"
  | "completed-follow-up"
  | "completed-failed"
  | "stuck"
  | "never-started"
  | "excluded";

/** Classification of a service task by title. */
export type TaskClassification = "work" | "paperwork" | "unknown";

/** One row in a tech's per-task audit — used for the score-breakdown tooltip. */
export interface TaskCreditEntry {
  jobUid: string;
  jobTitle: string;
  taskUid: string;
  taskTitle: string;
  bucket: TaskBucket;
  weight: number;             // 1/N
  timestamp: string | null;   // ISO — the "earliest of" resolved value
  scheduledEnd: string | null;
  onTime: boolean | null;     // null when bucket is not a completion
  stuck: boolean;
  neverStarted: boolean;
  failed: boolean;
  followUp: boolean;
}

/** Per-employee stats produced by computeLocationComplianceV2. */
export interface EmployeeComplianceV2 {
  userUid: string;
  name: string;

  tasksFractional: number;      // Σ 1/N credits
  distinctParentJobs: number;   // count of distinct parent job UIDs touched

  onTimeCount: number;          // fractional (Σ onTime contributions)
  lateCount: number;            // fractional
  measurableCount: number;      // onTime + late
  onTimePercent: number;        // -1 if measurableCount == 0

  stuckCount: number;           // fractional
  neverStartedCount: number;    // fractional

  failedCount: number;          // fractional — for pass rate
  passRate: number;             // -1 if no Failed or non-Failed completions applicable

  hasFollowUp: boolean;         // any Completed - Follow-up in the window

  complianceScore: number;      // 0-100
  grade: string;                // A-F, or "—" when lowVolume
  lowVolume: boolean;           // tasksFractional < MIN_TASKS_THRESHOLD

  /** Per-task audit list for tooltip. */
  entries: TaskCreditEntry[];
}

export interface LocationComplianceV2Result {
  byEmployee: EmployeeComplianceV2[];
  emptyCreditSetJobs: number;   // diagnostic for spec §7.2
}

/** Minimum task credits before showing a grade letter (spec §6). */
export const MIN_TASKS_THRESHOLD = 5;
