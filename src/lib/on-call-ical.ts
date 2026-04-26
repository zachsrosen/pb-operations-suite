// iCal (RFC 5545) generator for on-call rotation feeds. One event per assignment,
// spanning the pool's shift window. Times use the pool's IANA timezone via TZID.

function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// Convert YYYY-MM-DD and HH:mm into iCal local-time format: YYYYMMDDTHHmmss
function toICalLocal(date: string, time: string): string {
  const d = date.replace(/-/g, "");
  const [h, m] = time.split(":");
  return `${d}T${h}${m}00`;
}

// YYYYMMDDTHHmmssZ for DTSTAMP (always UTC)
function nowICalUTC(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// Add days to a YYYY-MM-DD string (for shift-end date when shift crosses midnight).
function addDaysISO(date: string, n: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Sun=0 ... Sat=6
function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isWeekendDay(dateStr: string): boolean {
  const dow = dayOfWeek(dateStr);
  return dow === 0 || dow === 6;
}

export type IcalOpts = {
  poolName: string;
  poolTz: string;
  /** Weekday (Mon-Fri) shift window, HH:mm. */
  shiftStart: string;
  shiftEnd: string;
  /** Weekend (Sat/Sun) shift window, HH:mm. */
  weekendShiftStart: string;
  weekendShiftEnd: string;
  assignments: Array<{ id: string; date: string; crewMemberName: string }>;
};

export function generateIcal(opts: IcalOpts): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//PB Tech Ops Suite//On-Call Rotations//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push(`X-WR-CALNAME:${escapeICalText(`On-Call — ${opts.poolName}`)}`);
  lines.push(`X-WR-TIMEZONE:${opts.poolTz}`);

  const dtstamp = nowICalUTC();

  for (const a of opts.assignments) {
    const weekend = isWeekendDay(a.date);
    const sStart = weekend ? opts.weekendShiftStart : opts.shiftStart;
    const sEnd = weekend ? opts.weekendShiftEnd : opts.shiftEnd;
    // Shift crosses midnight when end < start (legacy 17:00 → 07:00 case).
    // The May 2026 trial windows (18:00→22:00 and 08:00→12:00) don't, but
    // keep the guard so admin-edited windows that wrap still work.
    const crossesMidnight = sEnd < sStart;

    const startDate = a.date;
    const endDate = crossesMidnight ? addDaysISO(a.date, 1) : a.date;
    const dtstart = toICalLocal(startDate, sStart);
    const dtend = toICalLocal(endDate, sEnd);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:oncall-${a.id}@pb-ops`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=${opts.poolTz}:${dtstart}`);
    lines.push(`DTEND;TZID=${opts.poolTz}:${dtend}`);
    lines.push(`SUMMARY:${escapeICalText(`On-Call: ${a.crewMemberName}`)}`);
    lines.push(`DESCRIPTION:${escapeICalText(`${opts.poolName} rotation · ${a.crewMemberName} on-call`)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
