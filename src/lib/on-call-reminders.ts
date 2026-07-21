import { daysBetween } from "@/lib/on-call-rotation";

// Pure helpers for the Monday on-call reminder emails (week-of + week-ahead).
// No I/O — the cron route feeds persisted OnCallAssignment rows in, so swaps
// and split weeks are handled by construction: each member is emailed only the
// days they actually hold.

export type ReminderVariant = "week-of" | "week-ahead";

export type ReminderAssignmentRow = {
  date: string; // YYYY-MM-DD
  crewMemberId: string;
  crewMember: { name: string; email: string | null };
};

export type MemberWeek = {
  crewMemberId: string;
  name: string;
  email: string | null;
  /** Sorted ascending. */
  dates: string[];
};

/** Group one week's assignment rows by crew member, ordered by first held day. */
export function groupWeekAssignments(rows: ReminderAssignmentRow[]): MemberWeek[] {
  const byMember = new Map<string, MemberWeek>();
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  for (const row of sorted) {
    const existing = byMember.get(row.crewMemberId);
    if (existing) {
      existing.dates.push(row.date);
    } else {
      byMember.set(row.crewMemberId, {
        crewMemberId: row.crewMemberId,
        name: row.crewMember.name,
        email: row.crewMember.email,
        dates: [row.date],
      });
    }
  }
  return [...byMember.values()];
}

/** "Mon, Nov 2" — matches the style used by on-call swap/PTO notifications. */
export function formatDayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Collapse sorted dates into human ranges. Contiguous runs render as
 * "Mon, Nov 2 – Sun, Nov 8"; gaps (e.g. a mid-week swap) split into
 * comma-joined segments: "Mon, Nov 2 – Wed, Nov 4, Sat, Nov 7".
 * A missing Sunday at the end (California) is just a shorter run.
 */
export function formatDateRanges(dates: string[]): string {
  if (dates.length === 0) return "";
  const runs: Array<{ start: string; end: string }> = [];
  let run = { start: dates[0], end: dates[0] };
  for (const date of dates.slice(1)) {
    if (daysBetween(run.end, date) === 1) {
      run.end = date;
    } else {
      runs.push(run);
      run = { start: date, end: date };
    }
  }
  runs.push(run);
  return runs
    .map((r) => (r.start === r.end ? formatDayShort(r.start) : `${formatDayShort(r.start)} – ${formatDayShort(r.end)}`))
    .join(", ");
}

export function reminderSubject(variant: ReminderVariant, poolName: string, rangeText: string): string {
  const when = variant === "week-of" ? "this week" : "next week";
  return `You're on call ${when} — ${poolName} (${rangeText})`;
}

/** "16:00" → "4:00 PM" for shift-window display. */
export function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "4:00 PM – 8:00 AM" — shift windows may cross midnight. */
export function formatShiftWindow(start: string, end: string): string {
  return `${formatTime12h(start)} – ${formatTime12h(end)}`;
}
