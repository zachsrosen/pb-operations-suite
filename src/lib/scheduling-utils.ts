/** Convert a Date to YYYY-MM-DD string in local time */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Get today's date as YYYY-MM-DD string */
export function getTodayStr(): string {
  return toDateStr(new Date());
}

/** Check if a YYYY-MM-DD date string is before today */
export function isPastDate(dateStr: string): boolean {
  return dateStr < getTodayStr();
}

export function isWeekendDateYmd(dateStr: string): boolean {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.getDay() === 0 || d.getDay() === 6;
}

export function addDaysYmd(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addBusinessDaysYmd(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  // First, move to a weekday if starting on a weekend.
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  let remaining = Math.ceil(days);
  if (remaining <= 0) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      remaining--;
    }
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function countBusinessDaysInclusive(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 1;
  if (endDate < startDate) return 1;
  let cursor = startDate;
  let count = 0;
  while (cursor <= endDate) {
    if (!isWeekendDateYmd(cursor)) count += 1;
    cursor = addDaysYmd(cursor, 1);
  }
  return Math.max(count, 1);
}

export function getBusinessDatesInSpan(startDate: string, totalDays: number): string[] {
  const days = Math.max(1, Math.ceil(totalDays));
  const dates: string[] = [];
  let cursor = startDate;
  while (dates.length < days) {
    if (!isWeekendDateYmd(cursor)) dates.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return dates;
}

function parseZuperTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsedDateOnly = new Date(`${trimmed}T00:00:00.000Z`);
    return Number.isFinite(parsedDateOnly.getTime()) ? parsedDateOnly : null;
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const normalized = `${trimmed.replace(" ", "T")}Z`;
    const parsedNoTz = new Date(normalized);
    return Number.isFinite(parsedNoTz.getTime()) ? parsedNoTz : null;
  }
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isoToLocalPartsInTimezone(
  iso: string,
  timezone: string
): { ymd: string } | null {
  const parsed = parseZuperTimestamp(iso);
  if (!parsed) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return null;
  return {
    ymd: `${year}-${month}-${day}`,
  };
}

function fallbackYmdFromTimestamp(value?: string | null): string | undefined {
  if (!value) return undefined;
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0];
}

export function normalizeZuperBoundaryDates(params: {
  startIso?: string | null;
  endIso?: string | null;
  timezone: string;
}): { startDate?: string; endDate?: string } {
  const startLocal = params.startIso
    ? isoToLocalPartsInTimezone(params.startIso, params.timezone)
    : null;
  const endLocal = params.endIso
    ? isoToLocalPartsInTimezone(params.endIso, params.timezone)
    : null;

  const startDate = params.startIso
    ? (startLocal?.ymd || fallbackYmdFromTimestamp(params.startIso))
    : undefined;
  let endDate = params.endIso
    ? (endLocal?.ymd || fallbackYmdFromTimestamp(params.endIso))
    : undefined;

  if (startDate && endDate && endDate < startDate) {
    endDate = startDate;
  }

  return { startDate, endDate };
}

export function getConstructionSpanDaysFromZuper(params: {
  startIso?: string | null;
  endIso?: string | null;
  scheduledDays?: number | null;
  timezone: string;
}): number | undefined {
  if (params.startIso && params.endIso) {
    const boundaries = normalizeZuperBoundaryDates({
      startIso: params.startIso,
      endIso: params.endIso,
      timezone: params.timezone,
    });
    if (boundaries.startDate && boundaries.endDate) {
      return countBusinessDaysInclusive(boundaries.startDate, boundaries.endDate);
    }
  }

  const scheduledDays = Number(params.scheduledDays);
  if (Number.isFinite(scheduledDays) && scheduledDays > 0) {
    return Math.max(1, Math.ceil(scheduledDays));
  }

  return undefined;
}
