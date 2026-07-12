/**
 * Team activity report — repeatable cross-system employee activity.
 *
 * Usage:
 *   npx tsx scripts/team-activity-report.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *                                           [--out DIR] [--only pbops,aircall,...]
 *
 * Defaults: --from = 60 days ago, --to = now. Writes two CSVs to --out
 * (default ./tmp/reports) and prints a summary table. See
 * docs/superpowers/specs/2026-07-02-team-activity-report-design.md.
 */

import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaNeon } from "@prisma/adapter-neon";
import {
  computePersonDays,
  rollupByPerson,
  type ActivityEvent,
  type TalkTimeRecord,
  type ActivitySource,
} from "../src/lib/team-activity/metrics.ts";
import { DEFAULT_ROSTER } from "../src/lib/team-activity/roster.ts";
import {
  pbopsAdapter,
  aircallAdapter,
  zuperAdapter,
  hubspotAdapter,
  googleAdapter,
  peAdapter,
  type DateRange,
  type AdapterResult,
} from "../src/lib/team-activity/adapters.ts";

// --------------------------------------------------------------------------
// arg parsing
// --------------------------------------------------------------------------
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const DAY_MS = 86_400_000;
const to = arg("to") ? new Date(`${arg("to")}T23:59:59Z`) : new Date();
const from = arg("from") ? new Date(`${arg("from")}T00:00:00Z`) : new Date(to.getTime() - 60 * DAY_MS);
const outDir = arg("out") ?? "./tmp/reports";
const only = arg("only")?.split(",").map((s) => s.trim()) as ActivitySource[] | undefined;
const range: DateRange = { from, to };

const ALL: { key: ActivitySource; run: (p: PrismaClient) => Promise<AdapterResult> }[] = [
  { key: "pbops", run: (p) => pbopsAdapter(p, range, DEFAULT_ROSTER) },
  { key: "aircall", run: (p) => aircallAdapter(p, range, DEFAULT_ROSTER) },
  { key: "zuper", run: (p) => zuperAdapter(p, range, DEFAULT_ROSTER) },
  { key: "hubspot", run: () => hubspotAdapter(range, DEFAULT_ROSTER) },
  { key: "google", run: () => googleAdapter(range, DEFAULT_ROSTER) },
  { key: "pe", run: (p) => peAdapter(p, range, DEFAULT_ROSTER) },
];

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCsv(file: string, headers: string[], rows: (string | number)[][]) {
  const body = [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
  fs.writeFileSync(file, body);
}
function clock(min: number | null): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const nameOf = (email: string) => DEFAULT_ROSTER.find((m) => m.email.toLowerCase() === email)?.name ?? email;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

  const chosen = ALL.filter((a) => !only || only.includes(a.key));
  const ran: string[] = [];
  const skipped: string[] = [];
  const events: ActivityEvent[] = [];
  const talk: TalkTimeRecord[] = [];

  for (const a of chosen) {
    try {
      const r = await a.run(prisma);
      events.push(...r.events);
      if (r.talk) talk.push(...r.talk);
      if (r.skipped) skipped.push(`${a.key}: ${r.skipped}`);
      else ran.push(`${a.key} (${r.events.length} events${r.warning ? `; WARN ${r.warning}` : ""})`);
    } catch (e) {
      skipped.push(`${a.key}: ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await prisma.$disconnect();

  const personDays = computePersonDays(events, talk);
  const summaries = rollupByPerson(personDays);

  // --- CSVs ---
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;
  const dailyFile = path.join(outDir, `team-activity-daily-${stamp}.csv`);
  const summaryFile = path.join(outDir, `team-activity-summary-${stamp}.csv`);

  writeCsv(
    dailyFile,
    ["email", "name", "day", "weekday", "events", "interactions", "dealsTouched", "dealsTouchedAll", "tasksCompleted", "propertyUpdates", "spanHours", "activeHours", "talkMinutes", "calls", "googleSpanHours", "pbops", "aircall", "zuper", "hubspot", "google", "pe", "firstLocal", "lastLocal"],
    personDays.map((d) => [
      d.email, nameOf(d.email), d.day, d.weekday ? "Y" : "N", d.eventCount, d.interactions,
      d.dealsTouched, d.dealsTouchedAll, d.tasksCompleted, d.propertyUpdates,
      d.spanHours.toFixed(2), d.activeHours.toFixed(2), d.talkMinutes, d.callCount, d.googleSpanHours.toFixed(2),
      d.perSource.pbops, d.perSource.aircall, d.perSource.zuper, d.perSource.hubspot, d.perSource.google, d.perSource.pe,
      clock(d.firstMinute), clock(d.lastMinute),
    ]),
  );
  writeCsv(
    summaryFile,
    ["email", "name", "activeDays", "weekdayDays", "avgActiveHours", "avgSpanHours", "avgInteractions", "avgDealsTouched", "avgTasksCompleted", "avgPropertyUpdates", "avgEvents", "avgGoogleSpanHours", "totalTalkMinutes", "totalCalls", "avgStart", "avgEnd", "verdict"],
    summaries.map((s) => [
      s.email, nameOf(s.email), s.activeDays, s.weekdayActiveDays, s.avgActiveHours.toFixed(2), s.avgSpanHours.toFixed(2),
      s.avgInteractions.toFixed(1), s.avgDealsTouched.toFixed(1), s.avgTasksCompleted.toFixed(1), s.avgPropertyUpdates.toFixed(1), s.avgEvents.toFixed(1), s.avgGoogleSpanHours.toFixed(2), s.totalTalkMinutes, s.totalCalls,
      clock(s.avgStartMinute), clock(s.avgEndMinute), s.verdict,
    ]),
  );

  // --- console ---
  console.log(`\n=== Team Activity — ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} (America/Denver) ===`);
  console.log(`Sources ran:     ${ran.join(", ") || "none"}`);
  if (skipped.length) console.log(`Sources skipped: ${skipped.join(" | ")}`);
  console.log(`Total events: ${events.length} across ${summaries.length} people\n`);

  const pad = (s: string | number, n: number) => String(s).padStart(n);
  const padR = (s: string, n: number) => s.padEnd(n);
  console.log(`${padR("Name", 20)} ${pad("Days", 4)} ${pad("Act/d", 6)} ${pad("Span/d", 7)} ${pad("Intx/d", 7)} ${pad("Deals/d", 7)} ${pad("Tasks/d", 7)} ${pad("Props/d", 7)} ${pad("Talk", 5)} ${pad("GSpan", 6)} ${pad("Start", 6)} ${pad("End", 6)}  Verdict`);
  for (const s of summaries) {
    console.log(
      `${padR(nameOf(s.email).slice(0, 20), 20)} ${pad(s.weekdayActiveDays, 4)} ${pad(s.avgActiveHours.toFixed(1), 6)} ${pad(s.avgSpanHours.toFixed(1), 7)} ${pad(s.avgInteractions.toFixed(0), 7)} ${pad(s.avgDealsTouched.toFixed(1), s.avgTasksCompleted.toFixed(1), s.avgPropertyUpdates.toFixed(1), 7)} ${pad(s.totalTalkMinutes, 5)} ${pad(s.avgGoogleSpanHours.toFixed(1), 6)} ${pad(clock(s.avgStartMinute), 6)} ${pad(clock(s.avgEndMinute), 6)}  ${s.verdict}`,
    );
  }
  console.log(`\nCSVs written:\n  ${dailyFile}\n  ${summaryFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
