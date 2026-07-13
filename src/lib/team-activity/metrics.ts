/**
 * Team activity metrics - pure functions over a normalized event stream.
 *
 * No I/O. Source adapters (scripts/team-activity/adapters.ts) produce
 * `ActivityEvent[]` + `TalkTimeRecord[]`; this module turns them into
 * per-person-per-day metrics and per-person rollups. Kept under src/lib so it
 * is unit-testable via Jest and reusable by a future dashboard page.
 *
 * All day/time bucketing is America/Denver local (handles DST via Intl), so a
 * late-night event lands in the correct local day rather than splitting on UTC
 * midnight.
 */

export type ActivitySource = "pbops" | "aircall" | "zuper" | "hubspot" | "google" | "pe";

export interface ActivityEvent {
  /** normalized lowercase photonbrothers.com address */
  email: string;
  timestamp: Date;
  source: ActivitySource;
  /** e.g. "deal:123" - enables interaction dedup; omit when N/A */
  objectKey?: string;
  /** e.g. "task_update", "call", "login" - for per-source breakdown */
  kind?: string;
  /** human-readable description for the drilldown, when the source has one */
  label?: string;
  /**
   * Deal attribution for the deals-touched metric — set ONLY by the hubspot
   * adapter (engagements + audit DEAL edits). One entry per attributed deal
   * with its active-at-touch-time verdict. Other adapters never populate this,
   * so Zuper/PE `DEAL:`-keyed events don't feed the deal counts (PE activity
   * is reported separately; decision 2026-07-11).
   */
  deals?: { id: string; active: boolean }[];
}

export interface TalkTimeRecord {
  email: string;
  /** Denver-local YYYY-MM-DD */
  day: string;
  talkSec: number;
  calls: number;
}

/** Canonical lowercase email -> set of Denver-local YYYY-MM-DD PTO days. */
export type PtoDaysByEmail = Map<string, Set<string>>;

export interface PersonDayMetric {
  email: string;
  day: string; // Denver-local YYYY-MM-DD
  weekday: boolean;
  pto: boolean;
  firstMinute: number; // minutes since Denver-local midnight
  lastMinute: number;
  spanHours: number;
  activeHours: number; // gap-capped
  interactions: number;
  eventCount: number;
  perSource: Record<ActivitySource, number>;
  talkMinutes: number;
  callCount: number;
  googleSpanHours: number; // span from google-source events only
  /** distinct deals with an active-at-touch-time hubspot touch this day */
  dealsTouched: number;
  /** distinct deals touched regardless of stage/age (Test Pipeline excluded upstream) */
  dealsTouchedAll: number;
  /** HubSpot tasks completed this day (bucketed by completion time, not due date) */
  tasksCompleted: number;
  /** HubSpot property edits this day (audit PROPERTY_VALUE/UPDATE rows, any object type) */
  propertyUpdates: number;
}

export type Verdict = "marathon" | "full-day" | "full-day / light-app" | "light";

export interface PersonSummary {
  email: string;
  activeDays: number;
  weekdayActiveDays: number;
  weekendActiveDays: number;
  avgActiveHours: number; // over active weekdays
  avgSpanHours: number;
  avgInteractions: number;
  avgEvents: number;
  avgGoogleSpanHours: number;
  avgDealsTouched: number;
  avgTasksCompleted: number;
  avgPropertyUpdates: number;
  totalTalkMinutes: number;
  totalCalls: number;
  avgStartMinute: number | null;
  avgEndMinute: number | null;
  /** Weekday PTO days in range (from calendar OOO), including fully-offline ones. */
  ptoDays: number;
  verdict: Verdict;
}

const TZ = "America/Denver";
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Denver-local calendar day, YYYY-MM-DD. */
export function denverDay(d: Date): string {
  return dayFmt.format(d);
}

/** Minutes since Denver-local midnight (0-1439). */
export function denverMinutes(d: Date): number {
  // en-GB gives "HH:MM"; guard the 24:00 edge some engines emit.
  const [h, m] = timeFmt.format(d).split(":").map(Number);
  return ((h % 24) * 60 + m);
}

/** True for Mon-Fri in Denver-local time. */
export function isWeekday(day: string): boolean {
  // Parse as noon UTC to avoid tz roll; the day string is already local.
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/**
 * Deals-touched stage rule (see 2026-07-10 deals-touched spec §Definitions).
 * Stage `metadata.isClosed` is useless in PB's portal (every post-sale stage is
 * closed), so terminal-ness is matched by label.
 */
export const TERMINAL_STAGE_LABELS = new Set([
  "cancelled",
  "on-hold",
  "onhold",
  "project complete",
  "complete",
  "completed",
  "closed lost",
  "closed won",
]);

/**
 * Returns:
 *  - `true`  — deal counts as ACTIVE at touch time (non-terminal stage, or the
 *              touch is < bufferDays after the deal entered its terminal stage)
 *  - `false` — deal is terminal past the buffer (counts only in the all-count)
 *  - `null`  — deal is excluded from BOTH counts (Test Pipeline)
 */
export function isTouchOnActiveDeal(
  stageLabel: string,
  pipelineLabel: string,
  enteredTerminalAt: Date | null,
  touchAt: Date,
  bufferDays = 3,
): boolean | null {
  if (pipelineLabel.trim().toLowerCase() === "test pipeline") return null;
  if (!TERMINAL_STAGE_LABELS.has(stageLabel.trim().toLowerCase())) return true;
  if (!enteredTerminalAt) return false;
  return touchAt.getTime() < enteredTerminalAt.getTime() + bufferDays * 86_400_000;
}

/**
 * Sum of consecutive-event gaps, each gap capped at `capMinutes`. A single event
 * yields 0. This is the "active hours" heuristic: continuous clicking counts in
 * full, long idle stretches are capped so they don't inflate to wall-clock.
 */
export function activeHours(timestamps: Date[], capMinutes = 60): number {
  if (timestamps.length < 2) return 0;
  const ms = timestamps.map((t) => t.getTime()).sort((a, b) => a - b);
  const capMs = capMinutes * 60_000;
  let sum = 0;
  for (let i = 1; i < ms.length; i++) sum += Math.min(ms[i] - ms[i - 1], capMs);
  return sum / 3_600_000;
}

/**
 * Count distinct interactions. Events sharing an `objectKey` within
 * `windowMinutes` collapse to one (e.g. a deal edit that fires PROPERTY_VALUE +
 * CRM_OBJECT rows at the same instant, or repeated touches of one record).
 * Events without an `objectKey` are never deduped - each counts once.
 */
export function interactionCount(events: ActivityEvent[], windowMinutes = 10): number {
  const windowMs = windowMinutes * 60_000;
  const withKey = events
    .filter((e) => e.objectKey)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const noKey = events.filter((e) => !e.objectKey).length;
  const lastSeen = new Map<string, number>();
  let count = 0;
  for (const e of withKey) {
    const t = e.timestamp.getTime();
    const prev = lastSeen.get(e.objectKey!);
    if (prev === undefined || t - prev > windowMs) count++;
    lastSeen.set(e.objectKey!, t);
  }
  return count + noKey;
}

/**
 * Convert out-of-office calendar spans into Denver PTO days. A day counts as
 * PTO only when OOO covers >= `minHours` of it, so a short afternoon-off block
 * doesn't erase a worked morning. Hours are attributed by stepping through the
 * span in 30-min slices, which keeps day boundaries DST-correct via denverDay.
 */
export function ptoDaysFromOooEvents(
  spans: { start: Date; end: Date }[],
  minHours = 6,
): Set<string> {
  const STEP_MS = 30 * 60_000;
  const hoursByDay = new Map<string, number>();
  for (const { start, end } of spans) {
    for (let t = start.getTime(); t < end.getTime(); t += STEP_MS) {
      const sliceMs = Math.min(STEP_MS, end.getTime() - t);
      const day = denverDay(new Date(t));
      hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + sliceMs / 3_600_000);
    }
  }
  return new Set([...hoursByDay].filter(([, h]) => h >= minHours).map(([d]) => d));
}

const emptyPerSource = (): Record<ActivitySource, number> => ({
  pbops: 0,
  aircall: 0,
  zuper: 0,
  hubspot: 0,
  google: 0,
  pe: 0,
});

/** Group events + talk-time into per-(person, day) metrics. */
export function computePersonDays(
  events: ActivityEvent[],
  talk: TalkTimeRecord[] = [],
  pto?: PtoDaysByEmail,
): PersonDayMetric[] {
  const groups = new Map<string, ActivityEvent[]>();
  for (const e of events) {
    const key = `${e.email} ${denverDay(e.timestamp)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }
  const talkByKey = new Map<string, TalkTimeRecord>();
  for (const t of talk) talkByKey.set(`${t.email} ${t.day}`, t);

  // Days that have only talk-time (a call day with no other events) still count.
  for (const t of talk) {
    const key = `${t.email} ${t.day}`;
    if (!groups.has(key)) groups.set(key, []);
  }

  const out: PersonDayMetric[] = [];
  for (const [key, evs] of groups) {
    const [email, day] = key.split(" ");
    // Task engagements are due-date-timed (hs_timestamp = due date, not when
    // anyone acted), so keep them out of the time-shape metrics — a
    // workflow-created 6am task must not stretch span/active-hours or flip a
    // verdict. They still count for events/interactions/deals.
    const timeShaped = evs.filter((e) => e.kind !== "engagement/tasks");
    const times = timeShaped.map((e) => e.timestamp);
    const t = talkByKey.get(key);
    const perSource = emptyPerSource();
    for (const e of evs) perSource[e.source]++;
    let tasksCompleted = 0;
    let propertyUpdates = 0;
    for (const e of evs) {
      if (e.source !== "hubspot") continue;
      if (e.kind === "task_completed") tasksCompleted++;
      // Each property edit emits a CRM_OBJECT/UPDATE twin row too — count only
      // the PROPERTY_VALUE row to avoid doubling.
      else if (e.kind === "PROPERTY_VALUE/UPDATE") propertyUpdates++;
    }
    const activeDeals = new Set<string>();
    const allDeals = new Set<string>();
    for (const e of evs) {
      if (e.source !== "hubspot" || !e.deals) continue;
      for (const d of e.deals) {
        allDeals.add(d.id);
        if (d.active) activeDeals.add(d.id);
      }
    }
    const minutes = times.map(denverMinutes);
    const googleTimes = evs.filter((e) => e.source === "google").map((e) => denverMinutes(e.timestamp));

    const firstMinute = minutes.length ? Math.min(...minutes) : 0;
    const lastMinute = minutes.length ? Math.max(...minutes) : 0;

    out.push({
      email,
      day,
      weekday: isWeekday(day),
      pto: pto?.get(email)?.has(day) ?? false,
      firstMinute,
      lastMinute,
      spanHours: minutes.length ? (lastMinute - firstMinute) / 60 : 0,
      activeHours: activeHours(times),
      interactions: interactionCount(evs),
      eventCount: evs.length,
      perSource,
      talkMinutes: t ? Math.round(t.talkSec / 60) : 0,
      callCount: t ? t.calls : 0,
      googleSpanHours: googleTimes.length ? (Math.max(...googleTimes) - Math.min(...googleTimes)) / 60 : 0,
      dealsTouched: activeDeals.size,
      dealsTouchedAll: allDeals.size,
      tasksCompleted,
      propertyUpdates,
    });
  }
  return out.sort((a, b) => (a.email === b.email ? a.day.localeCompare(b.day) : a.email.localeCompare(b.email)));
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}

export function verdictFor(s: {
  avgSpanHours: number;
  avgActiveHours: number;
  avgGoogleSpanHours: number;
}): Verdict {
  if (s.avgSpanHours >= 12) return "marathon";
  if (s.avgActiveHours >= 6 || s.avgGoogleSpanHours >= 7) return "full-day";
  if (s.avgGoogleSpanHours >= 7 && s.avgActiveHours < 4) return "full-day / light-app";
  return "light";
}

/**
 * Roll up per-day metrics into one summary per person. Weekday averages are
 * taken over non-PTO weekdays only, so a stray touch on a PTO day (glancing at
 * email from the beach) doesn't drag the averages down. `ptoDays` counts
 * weekday PTO days from the calendar, including fully-offline ones that never
 * produce a PersonDayMetric.
 */
export function rollupByPerson(personDays: PersonDayMetric[], pto?: PtoDaysByEmail): PersonSummary[] {
  const byEmail = new Map<string, PersonDayMetric[]>();
  for (const d of personDays) {
    (byEmail.get(d.email) ?? byEmail.set(d.email, []).get(d.email)!).push(d);
  }
  const out: PersonSummary[] = [];
  for (const [email, days] of byEmail) {
    const weekdays = days.filter((d) => d.weekday && !d.pto);
    const ptoDays = [...(pto?.get(email) ?? [])].filter(isWeekday).length;
    const avgSpanHours = avg(weekdays.map((d) => d.spanHours));
    const avgActiveHours = avg(weekdays.map((d) => d.activeHours));
    const avgGoogleSpanHours = avg(weekdays.map((d) => d.googleSpanHours));
    out.push({
      email,
      activeDays: days.length,
      weekdayActiveDays: weekdays.length,
      weekendActiveDays: days.filter((d) => !d.weekday).length,
      avgActiveHours,
      avgSpanHours,
      avgInteractions: avg(weekdays.map((d) => d.interactions)),
      avgEvents: avg(weekdays.map((d) => d.eventCount)),
      avgGoogleSpanHours,
      avgDealsTouched: avg(weekdays.map((d) => d.dealsTouched)),
      avgTasksCompleted: avg(weekdays.map((d) => d.tasksCompleted)),
      avgPropertyUpdates: avg(weekdays.map((d) => d.propertyUpdates)),
      totalTalkMinutes: days.reduce((s, d) => s + d.talkMinutes, 0),
      totalCalls: days.reduce((s, d) => s + d.callCount, 0),
      avgStartMinute: weekdays.length ? avg(weekdays.map((d) => d.firstMinute)) : null,
      avgEndMinute: weekdays.length ? avg(weekdays.map((d) => d.lastMinute)) : null,
      ptoDays,
      verdict: verdictFor({ avgSpanHours, avgActiveHours, avgGoogleSpanHours }),
    });
  }
  return out.sort((a, b) => b.avgActiveHours - a.avgActiveHours);
}
