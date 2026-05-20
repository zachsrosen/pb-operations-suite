// US federal holidays. Used by workload stats and the ★ marker in the month view.
// Dates are YYYY-MM-DD. When the calendar year rolls over (or a new holiday is
// declared), add the next year's entries here.

export const FEDERAL_HOLIDAYS: Array<{ date: string; name: string }> = [
  // 2026
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-19", name: "Martin Luther King Jr. Day" },
  { date: "2026-02-16", name: "Presidents Day" },
  { date: "2026-05-25", name: "Memorial Day" },
  { date: "2026-06-19", name: "Juneteenth" },
  { date: "2026-07-03", name: "Independence Day (observed)" }, // Jul 4 is Sat
  { date: "2026-09-07", name: "Labor Day" },
  { date: "2026-10-12", name: "Columbus Day" },
  { date: "2026-11-11", name: "Veterans Day" },
  { date: "2026-11-26", name: "Thanksgiving Day" },
  { date: "2026-12-25", name: "Christmas Day" },

  // 2027
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-01-18", name: "Martin Luther King Jr. Day" },
  { date: "2027-02-15", name: "Presidents Day" },
  { date: "2027-05-31", name: "Memorial Day" },
  { date: "2027-06-18", name: "Juneteenth (observed)" }, // Jun 19 is Sat
  { date: "2027-07-05", name: "Independence Day (observed)" }, // Jul 4 is Sun
  { date: "2027-09-06", name: "Labor Day" },
  { date: "2027-10-11", name: "Columbus Day" },
  { date: "2027-11-11", name: "Veterans Day" },
  { date: "2027-11-25", name: "Thanksgiving Day" },
  { date: "2027-12-24", name: "Christmas Day (observed)" }, // Dec 25 is Sat
];

const HOLIDAY_SET = new Set(FEDERAL_HOLIDAYS.map((h) => h.date));
const HOLIDAY_NAMES = new Map(FEDERAL_HOLIDAYS.map((h) => [h.date, h.name]));

export function isFederalHoliday(dateStr: string): boolean {
  return HOLIDAY_SET.has(dateStr);
}

export function holidayName(dateStr: string): string | null {
  return HOLIDAY_NAMES.get(dateStr) ?? null;
}

export function holidaysInYear(year: number): Array<{ date: string; name: string }> {
  const prefix = `${year}-`;
  return FEDERAL_HOLIDAYS.filter((h) => h.date.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// PB company paid holidays — the actual days Photon Brothers is closed.
// This is a SUBSET of federal holidays plus company-specific days (day after
// Thanksgiving, Christmas Eve). Used by the scheduler to block scheduling.
// ---------------------------------------------------------------------------

export const PB_PAID_HOLIDAYS: Array<{ date: string; name: string }> = [
  // 2026
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-05-25", name: "Memorial Day" },
  { date: "2026-07-03", name: "Independence Day (observed)" },
  { date: "2026-09-07", name: "Labor Day" },
  { date: "2026-11-26", name: "Thanksgiving Day" },
  { date: "2026-11-27", name: "Day after Thanksgiving" },
  { date: "2026-12-24", name: "Christmas Eve" },
  { date: "2026-12-25", name: "Christmas Day" },

  // 2027 — update when HR publishes the calendar
];

const PB_HOLIDAY_SET = new Set(PB_PAID_HOLIDAYS.map((h) => h.date));
const PB_HOLIDAY_NAMES = new Map(PB_PAID_HOLIDAYS.map((h) => [h.date, h.name]));

/** Returns true if dateStr (YYYY-MM-DD) is a PB paid holiday. */
export function isPbHoliday(dateStr: string): boolean {
  return PB_HOLIDAY_SET.has(dateStr);
}

/** Returns the PB holiday name for dateStr, or null. */
export function pbHolidayName(dateStr: string): string | null {
  return PB_HOLIDAY_NAMES.get(dateStr) ?? null;
}

/** All PB paid holidays in a given year. */
export function pbHolidaysInYear(year: number): Array<{ date: string; name: string }> {
  const prefix = `${year}-`;
  return PB_PAID_HOLIDAYS.filter((h) => h.date.startsWith(prefix));
}
