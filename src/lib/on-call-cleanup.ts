// Pure planning logic for the 2026-06 on-call Monday-shift cleanup. Kept free of
// I/O so it can be exercised in tests against a reconstructed schedule and reused
// by scripts/cleanup-on-call-monday-shift.ts (single source of truth — the test
// validates the code the script actually runs).

import { generateAssignments, dayOfWeek, addDays, type RotationMember } from "./on-call-rotation";

export type ExistingRow = { date: string; crewMemberId: string };

export type CleanupPlan = {
  /** Phase-preserving Monday the rotation should be re-anchored to. */
  newStartDate: string;
  /** Desired Sunday-coverage flag for the pool. */
  coversSundays: boolean;
  /** Generated rows whose assignee changes (under Mon-Sun these are only Sundays). */
  updates: Array<{ date: string; from: string; to: string }>;
  /** Generated rows that disappear (dropped Sundays). */
  deletes: Array<{ date: string; crewMemberId: string }>;
  /** Count of existing rows left exactly as-is. */
  unchanged: number;
};

/**
 * Phase-preserving Monday anchor: the Monday immediately after the Sunday that
 * the pool's old Sun-Sat rotation was anchored on. Aligning the new Mon-Sun
 * rotation to this Monday keeps every existing Mon-Sat owner unchanged.
 */
export function phasePreservingMonday(startDate: string): string {
  const sundayAnchor = addDays(startDate, -dayOfWeek(startDate)); // Sunday of startDate's week
  return addDays(sundayAnchor, 1); // the following Monday
}

/**
 * Compute what the cleanup would do to a pool's existing *generated* future
 * rows: re-anchor to a phase-preserving Monday, regenerate under the desired
 * coversSundays flag, and diff against what's currently on the schedule.
 *
 * `existing` must be the generated rows from "today" forward, sorted by date.
 */
export function planPoolCleanup(opts: {
  startDate: string;
  rotationUnit: "daily" | "weekly";
  members: RotationMember[];
  coversSundays: boolean;
  existing: ExistingRow[];
}): CleanupPlan {
  const newStartDate = phasePreservingMonday(opts.startDate);
  const updates: CleanupPlan["updates"] = [];
  const deletes: CleanupPlan["deletes"] = [];
  let unchanged = 0;

  if (opts.existing.length === 0) {
    return { newStartDate, coversSundays: opts.coversSundays, updates, deletes, unchanged };
  }

  const fromDate = opts.existing[0].date;
  const toDate = opts.existing[opts.existing.length - 1].date;
  const generated = generateAssignments({
    startDate: newStartDate,
    fromDate,
    toDate,
    members: opts.members,
    rotationUnit: opts.rotationUnit,
    coversSundays: opts.coversSundays,
  });
  const wantByDate = new Map(generated.map((g) => [g.date, g.crewMemberId]));

  for (const row of opts.existing) {
    const want = wantByDate.get(row.date);
    if (want === undefined) {
      deletes.push({ date: row.date, crewMemberId: row.crewMemberId });
    } else if (want !== row.crewMemberId) {
      updates.push({ date: row.date, from: row.crewMemberId, to: want });
    } else {
      unchanged++;
    }
  }

  return { newStartDate, coversSundays: opts.coversSundays, updates, deletes, unchanged };
}
