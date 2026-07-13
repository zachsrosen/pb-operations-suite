/**
 * Week math for the weekly team-activity digest. Pure + DST-safe.
 *
 * The digest fires Monday morning and reports the week that JUST ended
 * (prior Mon 00:00 -> prior Sun 23:59:59.999, America/Denver), against the
 * week before it for deltas. All boundaries are Denver-local wall clock
 * converted to UTC per-date, so a spring/fall DST edge lands correctly.
 */

const DAY_MS = 86_400_000;

/** America/Denver UTC offset in minutes at `date` (-360 MDT, -420 MST). */
function denverOffsetMinutes(date: Date): number {
  const asUTC = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const asDenver = new Date(date.toLocaleString("en-US", { timeZone: "America/Denver" }));
  return Math.round((asDenver.getTime() - asUTC.getTime()) / 60_000);
}

interface Ymd { y: number; m: number; d: number }

/** Denver-local calendar date of an instant. */
function denverYmd(date: Date): Ymd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Denver-local weekday of an instant, 0 = Monday .. 6 = Sunday. */
function denverWeekdayMon0(date: Date): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short" }).format(date);
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd);
}

/** Shift a calendar date by `n` days (via UTC noon to avoid any roll). */
function addDays(ymd: Ymd, n: number): Ymd {
  const t = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12) + n * DAY_MS;
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** UTC instant for Denver-local midnight (00:00:00.000) of a calendar date. */
function denverMidnightUtc(ymd: Ymd): Date {
  const wallAsUtc = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0, 0);
  const offset = denverOffsetMinutes(new Date(wallAsUtc)); // offset at that date (00:00 never hits the 2am transition)
  return new Date(wallAsUtc - offset * 60_000);
}

export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Given the firing instant `now` (Mon or Tue morning), return the just-ended
 * week and the week before it, as UTC ranges over Denver-local day boundaries.
 */
export function denverWeekBounds(now: Date): { current: DateRange; previous: DateRange } {
  const today = denverYmd(now);
  const thisWeekMonday = addDays(today, -denverWeekdayMon0(now)); // Monday of the week containing `now`
  const currentMonday = addDays(thisWeekMonday, -7); // Monday of the just-ended week
  const previousMonday = addDays(currentMonday, -7);

  const currentFrom = denverMidnightUtc(currentMonday);
  const thisWeekMondayUtc = denverMidnightUtc(thisWeekMonday);
  const previousFrom = denverMidnightUtc(previousMonday);

  return {
    current: { from: currentFrom, to: new Date(thisWeekMondayUtc.getTime() - 1) },
    previous: { from: previousFrom, to: new Date(currentFrom.getTime() - 1) },
  };
}

/**
 * Monday-anchored ISO-week key (e.g. "2026-W29"). UTC-based, matching the
 * goals-digest idempotency scheme. Any day Mon-Sun of a week yields the same key.
 */
export function isoWeekKey(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(d.getTime() - day * DAY_MS);
  const yearStart = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((monday.getTime() - yearStart.getTime()) / DAY_MS + yearStart.getUTCDay() + 1) / 7);
  return `${monday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
