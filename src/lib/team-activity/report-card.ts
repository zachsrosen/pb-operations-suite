/**
 * Report card - pre-interpreted plain-text summary of a team-activity period,
 * written for leadership (paste into email/chat as-is). Pure and
 * deterministic: takes the dashboard API responses for the current and prior
 * periods and returns text. No markdown tables, no emails, no em dashes.
 *
 * Spec: docs/superpowers/specs/2026-07-11-team-activity-report-card-design.md
 */

import { isWeekday, type PersonDayMetric, type PersonSummary } from "./metrics";

export interface ReportPeriod {
  range: { from: string; to: string }; // ISO strings, day precision in the YYYY-MM-DD prefix
  summaries: (PersonSummary & { name: string })[];
  personDays: (PersonDayMetric & { name: string })[];
  roster: { email: string; name: string; ptoWeekdays: number }[];
  sources: {
    ran: { source: string; events: number; warning?: string }[];
    skipped: { source: string; reason: string }[];
  };
}

const SOURCE_PLAIN_LABEL: Record<string, string> = {
  pbops: "the PB Ops app",
  zuper: "Zuper field jobs",
  google: "Google Docs/Meet",
  aircall: "phone calls",
  hubspot: "HubSpot",
  pe: "PE submissions",
};

const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "2026-06-29T..." -> "Jun 29". Day-precision; parse at UTC noon to avoid tz roll. */
function fmtDay(iso: string): string {
  return monthDay.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
}

/** 1-decimal number with trailing .0 stripped: 20 -> "20", 20.55 -> "20.6". */
function fmt1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return String(r);
}

/** Inclusive weekday count across the range's YYYY-MM-DD days. */
function weekdaysInRange(range: ReportPeriod["range"]): number {
  const first = range.from.slice(0, 10);
  const lastEx = new Date(new Date(`${range.to.slice(0, 10)}T12:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
  let count = 0;
  for (let t = new Date(`${first}T12:00:00Z`).getTime(); ; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (day >= lastEx) break;
    if (isWeekday(day)) count++;
  }
  return count;
}

function deltaPhrase(cur: number, previous: ReportPeriod | null, email: string): string {
  if (!previous) return "";
  const prevSummary = previous.summaries.find((s) => s.email === email);
  let prev: number;
  if (prevSummary) {
    prev = prevSummary.avgDealsTouched;
  } else if (previous.roster.some((r) => r.email === email)) {
    prev = 0;
  } else {
    return " (new this period)";
  }
  if (Math.abs(cur - prev) <= 0.1 * Math.max(prev, 1)) return " (steady)";
  return cur > prev ? ` (up from ${fmt1(prev)})` : ` (down from ${fmt1(prev)})`;
}

function ptoNote(ptoWeekdays: number, weekdays: number): string {
  if (ptoWeekdays <= 0) return "no PTO";
  if (weekdays > 0 && ptoWeekdays / weekdays >= 0.5) return `${ptoWeekdays} of ${weekdays} weekdays on PTO`;
  return ptoWeekdays === 1 ? "1 PTO day" : `${ptoWeekdays} PTO days`;
}

export function buildReportCard(current: ReportPeriod, previous: ReportPeriod | null): string {
  const lines: string[] = [];
  const header =
    `Team Activity Report Card: ${fmtDay(current.range.from)} - ${fmtDay(current.range.to)}` +
    (previous ? ` (vs ${fmtDay(previous.range.from)} - ${fmtDay(previous.range.to)})` : "");
  lines.push(header, "");

  if (!current.summaries.length && !current.roster.length) {
    lines.push("No tracked activity in this range.");
    return lines.join("\n");
  }

  const weekdays = weekdaysInRange(current.range);
  const ptoByEmail = new Map(current.roster.map((r) => [r.email, r.ptoWeekdays]));

  // Ranked people: by deals/day descending.
  const ranked = [...current.summaries].sort((a, b) => b.avgDealsTouched - a.avgDealsTouched);
  for (const s of ranked) {
    const pto = ptoByEmail.get(s.email) ?? s.ptoDays;
    lines.push(
      `${s.name}: ${fmt1(s.avgDealsTouched)} deals/day${deltaPhrase(s.avgDealsTouched, previous, s.email)}, ` +
        `${fmt1(s.avgActiveHours)}h active/day, ${ptoNote(pto, weekdays)}`,
    );
  }

  // Roster members with no tracked activity at all.
  const seen = new Set(current.summaries.map((s) => s.email));
  for (const r of current.roster) {
    if (seen.has(r.email)) continue;
    lines.push(r.ptoWeekdays >= weekdays && weekdays > 0 ? `${r.name}: on PTO the full period` : `${r.name}: no tracked activity this period`);
  }

  // ---- Notes ---------------------------------------------------------------
  const notes: string[] = [];
  notes.push(
    "Deals/day counts distinct deals a person worked that day (HubSpot activity or edits, or PE document submissions) while the deal was in flight.",
  );

  // Channel callouts: only meaningful when both deal-attributing sources ran.
  const ranKeys = new Set(current.sources.ran.map((r) => r.source));
  if (ranKeys.has("hubspot") && ranKeys.has("pe")) {
    const byPerson = new Map<string, { name: string; total: number; dealSources: number; per: Map<string, number> }>();
    for (const d of current.personDays) {
      const p = byPerson.get(d.email) ?? { name: d.name, total: 0, dealSources: 0, per: new Map<string, number>() };
      p.total += d.eventCount;
      p.dealSources += (d.perSource.hubspot ?? 0) + (d.perSource.pe ?? 0);
      for (const [k, v] of Object.entries(d.perSource)) p.per.set(k, (p.per.get(k) ?? 0) + v);
      byPerson.set(d.email, p);
    }
    for (const p of byPerson.values()) {
      if (p.total < 50 || p.dealSources / p.total >= 0.25) continue;
      const top = [...p.per.entries()].filter(([k]) => k !== "hubspot" && k !== "pe").sort((a, b) => b[1] - a[1])[0];
      if (!top || top[1] <= 0) continue;
      notes.push(`${p.name}'s tracked work is mostly ${SOURCE_PLAIN_LABEL[top[0]] ?? top[0]}; deals/day understates them.`);
    }
  }

  const anyPto =
    current.roster.some((r) => r.ptoWeekdays > 0) || current.summaries.some((s) => s.ptoDays > 0);
  if (anyPto) notes.push("Averages exclude PTO days (from the HR PTO calendar).");

  if (!previous) notes.push("Prior-period comparison unavailable for this run.");

  for (const s of current.sources.skipped) notes.push(`${s.source} did not run this period; numbers may be partial.`);
  for (const r of current.sources.ran) {
    if (r.warning) notes.push(`${r.source} ran with partial data this period (${r.warning}).`);
  }
  if (previous) {
    for (const s of previous.sources.skipped) notes.push(`${s.source} did not run in the prior period; comparisons may be partial.`);
    for (const r of previous.sources.ran) {
      if (r.warning) notes.push(`${r.source} ran with partial data in the prior period.`);
    }
  }

  lines.push("", "Notes:");
  for (const n of notes) lines.push(`- ${n}`);
  return lines.join("\n");
}
