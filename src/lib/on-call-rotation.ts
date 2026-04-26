import { isFederalHoliday } from "./on-call-holidays";

// Pure rotation math. No I/O, no Date/timezone conversions beyond string-level day math.
// All dates are "YYYY-MM-DD" strings in the pool's local timezone.

export type RotationMember = {
  crewMemberId: string;
  orderIndex: number;
  isActive: boolean;
};

export type GeneratedAssignment = {
  date: string;
  crewMemberId: string;
};

export type WorkloadStat = {
  days: number;
  weekends: number;
  holidays: number;
};

function parseDateStr(dateStr: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) throw new Error(`Invalid date string: ${dateStr}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function toEpochDays(dateStr: string): number {
  const [y, m, d] = parseDateStr(dateStr);
  const utcMs = Date.UTC(y, m - 1, d);
  return Math.floor(utcMs / 86400000);
}

function fromEpochDays(days: number): string {
  const ms = days * 86400000;
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const da = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function daysBetween(from: string, to: string): number {
  return toEpochDays(to) - toEpochDays(from);
}

export function addDays(date: string, n: number): string {
  return fromEpochDays(toEpochDays(date) + n);
}

export function dayOfWeek(dateStr: string): number {
  const [y, m, d] = parseDateStr(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(dateStr: string): boolean {
  const dow = dayOfWeek(dateStr);
  return dow === 0 || dow === 6;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

// Sunday of the week containing dateStr. PB on-call weeks run Sun → Sat.
// Kept exported under both names for back-compat with prior callers; mondayOf
// is now an alias that points to the Sunday-of helper since we shifted the
// weekly anchor on 2026-04-22.
export function sundayOf(dateStr: string): string {
  const dow = dayOfWeek(dateStr); // 0=Sun, 1=Mon, ..., 6=Sat
  return addDays(dateStr, -dow);
}
export const mondayOf = sundayOf;

export type RotationUnit = "daily" | "weekly";

export type GenerateOpts = {
  startDate: string;
  fromDate: string;
  toDate: string;
  members: RotationMember[];
  rotationUnit?: RotationUnit; // defaults to "daily" for backwards-compat with existing callers
};

/**
 * Strict round-robin rotation.
 * - Daily: day N's assignment = activeMembers[(anchorOffset + N) % length].
 * - Weekly: the rotation index advances once per week (Monday boundary).
 *   All 7 days in a week share the same assignee. Anchors on the Monday
 *   of startDate so e.g. a pool starting mid-week still produces clean
 *   Mon→Sun groupings.
 * Inactive members are skipped entirely. Throws when no members are active.
 */
export function generateAssignments(opts: GenerateOpts): GeneratedAssignment[] {
  const active = opts.members
    .filter((m) => m.isActive)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  if (active.length === 0) {
    throw new Error("Cannot generate rotation: no active members in pool");
  }

  const totalDays = daysBetween(opts.fromDate, opts.toDate) + 1;
  if (totalDays <= 0) return [];

  const unit = opts.rotationUnit ?? "daily";

  const out: GeneratedAssignment[] = [];
  if (unit === "daily") {
    const anchorOffset = daysBetween(opts.startDate, opts.fromDate);
    for (let i = 0; i < totalDays; i++) {
      const memberIdx = mod(anchorOffset + i, active.length);
      out.push({
        date: addDays(opts.fromDate, i),
        crewMemberId: active[memberIdx].crewMemberId,
      });
    }
  } else {
    // Weekly: align to Monday of startDate.
    const anchorMonday = mondayOf(opts.startDate);
    for (let i = 0; i < totalDays; i++) {
      const date = addDays(opts.fromDate, i);
      const daysFromAnchor = daysBetween(anchorMonday, date);
      const weekOffset = Math.floor(daysFromAnchor / 7);
      const memberIdx = mod(weekOffset, active.length);
      out.push({ date, crewMemberId: active[memberIdx].crewMemberId });
    }
  }
  return out;
}

export type WorkloadOpts = {
  month: string;
  assignments: GeneratedAssignment[];
};

export function computeWorkload(opts: WorkloadOpts): Record<string, WorkloadStat> {
  const monthPrefix = opts.month + "-";
  const result: Record<string, WorkloadStat> = {};

  for (const a of opts.assignments) {
    if (!a.date.startsWith(monthPrefix)) continue;
    const current = result[a.crewMemberId] ?? { days: 0, weekends: 0, holidays: 0 };
    current.days += 1;
    if (isWeekend(a.date)) current.weekends += 1;
    if (isFederalHoliday(a.date)) current.holidays += 1;
    result[a.crewMemberId] = current;
  }
  return result;
}

export type ReplacementRankOpts = {
  targetDate: string;
  currentAssignments: GeneratedAssignment[];
  members: RotationMember[];
  ptoMemberIds: Set<string>;
  month: string;
};

export type ReplacementRank = {
  crewMemberId: string;
  rank: number;
  reason: "recommended" | "eligible" | "adjacent-conflict" | "pto";
  stats: WorkloadStat;
};

/**
 * Ranks pool members for a target date by least-loaded first. Flags adjacent-day
 * conflicts and PTO overlaps as unavailable. Current assignee on target date is excluded.
 * ptoMemberIds is the set of crewMemberIds on PTO that covers targetDate.
 */
export function rankReplacements(opts: ReplacementRankOpts): ReplacementRank[] {
  const current = opts.currentAssignments.find((a) => a.date === opts.targetDate);
  const currentCrewId = current?.crewMemberId;

  const workload = computeWorkload({
    month: opts.month,
    assignments: opts.currentAssignments,
  });

  const prevDay = addDays(opts.targetDate, -1);
  const nextDay = addDays(opts.targetDate, 1);
  const adjacent = new Set<string>();
  for (const a of opts.currentAssignments) {
    if (a.date === prevDay || a.date === nextDay) adjacent.add(a.crewMemberId);
  }

  const active = opts.members.filter((m) => m.isActive);

  const ranked: ReplacementRank[] = active
    .filter((m) => m.crewMemberId !== currentCrewId)
    .map((m) => {
      const stats = workload[m.crewMemberId] ?? { days: 0, weekends: 0, holidays: 0 };

      let reason: ReplacementRank["reason"];
      if (opts.ptoMemberIds.has(m.crewMemberId)) reason = "pto";
      else if (adjacent.has(m.crewMemberId)) reason = "adjacent-conflict";
      else reason = "eligible";

      const rank = stats.days * 100 + stats.weekends * 10 + stats.holidays;
      return { crewMemberId: m.crewMemberId, rank, reason, stats };
    });

  ranked.sort((a, b) => {
    const aAvail = a.reason === "eligible" ? 0 : 1;
    const bAvail = b.reason === "eligible" ? 0 : 1;
    if (aAvail !== bAvail) return aAvail - bAvail;
    return a.rank - b.rank;
  });

  if (ranked.length > 0 && ranked[0].reason === "eligible") {
    ranked[0].reason = "recommended";
  }
  return ranked;
}
