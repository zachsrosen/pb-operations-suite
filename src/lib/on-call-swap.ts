import { addDays, daysBetween, mondayOf } from "./on-call-rotation";

// Pure swap-window math shared by the swap propose/approve routes and UI.
// All dates are "YYYY-MM-DD" strings in the pool's local timezone.

/** Days of lead time under which a swap counts as short-notice. */
export const SHORT_NOTICE_DAYS = 14;

/**
 * All assignment dates a swap date stands for. Weekly pools exchange whole
 * Mon-Sun week blocks (the stored swap date is one day inside the block);
 * daily pools exchange the single day. Callers filter the result against
 * actual assignment rows, so days with no coverage (e.g. Sundays in
 * coversSundays=false pools) drop out naturally.
 */
export function expandSwapDates(rotationUnit: string, date: string): string[] {
  if (rotationUnit !== "weekly") return [date];
  const monday = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** True when the date is inside the SHORT_NOTICE_DAYS manager-review window. */
export function isShortNotice(date: string, today: string): boolean {
  return daysBetween(today, date) < SHORT_NOTICE_DAYS;
}

/** Today as "YYYY-MM-DD" in the given IANA timezone. */
export function todayInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export type SwapCandidateBlock = {
  poolId: string;
  crewMemberId: string;
  crewMemberName: string;
  startDate: string;
  endDate: string;
};

/**
 * Collapse per-day assignment rows (sorted by date) into contiguous
 * same-member blocks — one entry per shift week, with its full date range.
 * Rows for excludeCrewMemberId (the requester's own shifts) are dropped.
 * A gap in dates (e.g. Sundays in coversSundays=false pools) or a change
 * of member starts a new block.
 */
export function groupIntoBlocks(
  assignments: Array<{ poolId: string; date: string; crewMemberId: string; crewMemberName: string }>,
  excludeCrewMemberId?: string,
): SwapCandidateBlock[] {
  const blocks: SwapCandidateBlock[] = [];
  let prevDate: string | null = null;
  for (const a of assignments) {
    if (excludeCrewMemberId && a.crewMemberId === excludeCrewMemberId) {
      prevDate = null;
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last && last.crewMemberId === a.crewMemberId && prevDate !== null && addDays(prevDate, 1) === a.date) {
      last.endDate = a.date;
      prevDate = a.date;
      continue;
    }
    blocks.push({
      poolId: a.poolId,
      crewMemberId: a.crewMemberId,
      crewMemberName: a.crewMemberName,
      startDate: a.date,
      endDate: a.date,
    });
    prevDate = a.date;
  }
  return blocks;
}
