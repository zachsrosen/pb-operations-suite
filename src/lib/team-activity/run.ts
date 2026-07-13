/**
 * Shared team-activity orchestration: fan out the source adapters + PTO over a
 * date range for a resolved roster, and reduce to per-person-day + summary
 * metrics. Extracted from the dashboard route so the route and the weekly
 * digest cron run identical logic. Callers add `range`/`lastUpdated`/naming as
 * they need; this returns everything the API response and `ReportPeriod` want.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import {
  computePersonDays,
  isWeekday,
  rollupByPerson,
  type ActivityEvent,
  type ActivitySource,
  type PersonDayMetric,
  type PersonSummary,
  type TalkTimeRecord,
} from "@/lib/team-activity/metrics";
import type { RosterMember } from "@/lib/team-activity/roster";
import {
  pbopsAdapter,
  aircallAdapter,
  zuperAdapter,
  hubspotAdapter,
  googleAdapter,
  googlePtoAdapter,
  peAdapter,
  type AdapterResult,
  type DateRange,
} from "@/lib/team-activity/adapters";

export interface RunTeamActivityResult {
  ran: { source: string; events: number; warning?: string }[];
  skipped: { source: string; reason: string }[];
  totalEvents: number;
  personDays: (PersonDayMetric & { name: string })[];
  summaries: (PersonSummary & { name: string })[];
  roster: { email: string; name: string; ptoWeekdays: number }[];
}

/**
 * @param opts.only  restrict to these event sources (PTO ALWAYS runs regardless,
 *                   so PTO-day exclusion never silently breaks).
 * @param opts.reportsAdmin  super-admin to impersonate for the Google Reports API.
 */
export async function runTeamActivity(
  prisma: PrismaClient,
  range: DateRange,
  roster: RosterMember[],
  opts: { only?: ActivitySource[]; reportsAdmin?: string } = {},
): Promise<RunTeamActivityResult> {
  const { only, reportsAdmin } = opts;

  const adapters: { key: ActivitySource; run: () => Promise<AdapterResult> }[] = [
    { key: "pbops", run: () => pbopsAdapter(prisma, range, roster) },
    { key: "aircall", run: () => aircallAdapter(prisma, range, roster) },
    { key: "zuper", run: () => zuperAdapter(prisma, range, roster) },
    { key: "hubspot", run: () => hubspotAdapter(range, roster) },
    { key: "google", run: () => googleAdapter(range, roster, reportsAdmin) },
    { key: "pe", run: () => peAdapter(prisma, range, roster) },
  ];

  const chosen = adapters.filter((a) => !only || only.includes(a.key));
  const events: ActivityEvent[] = [];
  const talk: TalkTimeRecord[] = [];
  const ran: { source: string; events: number; warning?: string }[] = [];
  const skipped: { source: string; reason: string }[] = [];

  // PTO (calendar OOO days) is not an event source and is never gated by `only`
  // — it feeds the metrics so PTO days drop out of the averages.
  const ptoPromise = googlePtoAdapter(range, roster).catch((e) => ({
    pto: new Map<string, Set<string>>(),
    skipped: `ERROR ${e instanceof Error ? e.message : String(e)}`,
  }));

  const results = await Promise.all(
    chosen.map(async (a) => {
      try {
        return { key: a.key, result: await a.run() };
      } catch (e) {
        return { key: a.key, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  const ptoResult = await ptoPromise;
  if (ptoResult.skipped) skipped.push({ source: "pto", reason: ptoResult.skipped });

  for (const r of results) {
    if ("error" in r && r.error) {
      skipped.push({ source: r.key, reason: `ERROR ${r.error}` });
      continue;
    }
    const res = r.result!;
    events.push(...res.events);
    if (res.talk) talk.push(...res.talk);
    if (res.skipped) skipped.push({ source: r.key, reason: res.skipped });
    else ran.push({ source: r.key, events: res.events.length, ...(res.warning ? { warning: res.warning } : {}) });
  }

  const personDays = computePersonDays(events, talk, ptoResult.pto);
  const summaries = rollupByPerson(personDays, ptoResult.pto);
  const nameOf = (email: string) => roster.find((m) => m.email.toLowerCase() === email)?.name ?? email;

  return {
    ran,
    skipped,
    totalEvents: events.length,
    personDays: personDays.map((d) => ({ ...d, name: nameOf(d.email) })),
    summaries: summaries.map((s) => ({ ...s, name: nameOf(s.email) })),
    roster: roster.map((m) => ({
      email: m.email.toLowerCase(),
      name: m.name,
      ptoWeekdays: [...(ptoResult.pto.get(m.email.toLowerCase()) ?? [])].filter(isWeekday).length,
    })),
  };
}
