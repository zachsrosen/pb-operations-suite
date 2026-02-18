function parseYmdToUtcDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid date format: "${dateStr}"`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDateToYmd(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

export function isWeekendDate(dateStr: string): boolean {
  const date = parseYmdToUtcDate(dateStr);
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Returns the inclusive end date for a schedule span measured in business days.
 * Examples:
 * - start=2026-02-20 (Fri), totalDays=1  -> 2026-02-20
 * - start=2026-02-20 (Fri), totalDays=2  -> 2026-02-23 (Mon)
 * - start=2026-02-20 (Fri), totalDays=3  -> 2026-02-24 (Tue)
 */
export function getBusinessEndDateInclusive(startDate: string, totalDays: number): string {
  const cursor = parseYmdToUtcDate(startDate);
  let remainingBusinessDays = Math.max(Math.ceil(totalDays), 1) - 1;

  while (remainingBusinessDays > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      remainingBusinessDays -= 1;
    }
  }

  return formatUtcDateToYmd(cursor);
}
