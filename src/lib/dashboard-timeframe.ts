/**
 * Shared timeframe helpers for the Pipeline Funnel + Monthly Activity dashboards.
 *
 * Both pages offer the same "calendar" timeframes (This Month, This Quarter,
 * This Year, Last Year, …). Keeping the math here — rather than copy-pasted per
 * page — prevents the two from drifting, which is what let "This Year" bleed an
 * extra month on one page but not the other.
 */

/** Months of lookback used to size the fetch window for a timeframe key. */
export function resolveMonths(key: string): number {
  const now = new Date();
  const thisMonth = now.getMonth(); // 0-based
  switch (key) {
    case "this-month":
      return 1;
    case "last-month":
      // Two months so the previous calendar month is fully inside the fetch;
      // the calendar clamp then narrows the display to that single month.
      return 2;
    case "this-quarter": {
      const qStart = Math.floor(thisMonth / 3) * 3; // 0, 3, 6, 9
      return thisMonth - qStart + 1;
    }
    case "this-year":
      return thisMonth + 1;
    case "last-year":
    case "ytd-vs-last":
      return thisMonth + 13; // current partial year + full prior year
    default:
      return parseInt(key) || 6;
  }
}

export interface MonthRange {
  /** inclusive "YYYY-MM" */
  start: string;
  /** inclusive "YYYY-MM" */
  end: string;
}

/**
 * Exact inclusive [start, end] month-key bounds for calendar timeframes.
 * Rolling timeframes ("3", "6", …) return null (no calendar clamp). Month keys
 * are "YYYY-MM", so plain string comparison is chronological.
 */
export function calendarMonthRange(key: string): MonthRange | null {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const mk = (yr: number, mo: number) => `${yr}-${String(mo + 1).padStart(2, "0")}`;
  switch (key) {
    case "this-month":
      return { start: mk(y, m), end: mk(y, m) };
    case "last-month": {
      const d = new Date(y, m - 1, 1);
      return { start: mk(d.getFullYear(), d.getMonth()), end: mk(d.getFullYear(), d.getMonth()) };
    }
    case "this-quarter": {
      const qStart = Math.floor(m / 3) * 3;
      return { start: mk(y, qStart), end: mk(y, m) };
    }
    case "this-year":
      return { start: mk(y, 0), end: mk(y, m) };
    case "last-year":
      return { start: mk(y - 1, 0), end: mk(y - 1, 11) };
    default:
      return null;
  }
}

/**
 * Convert a month range to inclusive calendar date bounds (first day of the
 * start month .. last day of the end month), as "YYYY-MM-DD".
 */
export function monthRangeToDates(range: MonthRange): { start: string; end: string } {
  const [ey, em] = range.end.split("-").map(Number);
  const lastDay = new Date(ey, em, 0).getDate(); // em is 1-based; day 0 of next month = last day
  return {
    start: `${range.start}-01`,
    end: `${range.end}-${String(lastDay).padStart(2, "0")}`,
  };
}
