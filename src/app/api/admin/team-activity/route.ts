import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import {
  computePersonDays,
  rollupByPerson,
  type ActivityEvent,
  type ActivitySource,
  type TalkTimeRecord,
} from "@/lib/team-activity/metrics";
import { DEFAULT_ROSTER } from "@/lib/team-activity/roster";
import {
  pbopsAdapter,
  aircallAdapter,
  zuperAdapter,
  hubspotAdapter,
  googleAdapter,
  type AdapterResult,
  type DateRange,
} from "@/lib/team-activity/adapters";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

/**
 * GET /api/admin/team-activity?from=YYYY-MM-DD&to=YYYY-MM-DD&only=pbops,aircall
 *
 * ADMIN only (also gated by TEAM_ACTIVITY_DASHBOARD_ENABLED). Runs the
 * same source adapters as the CLI and returns per-person summaries + per-day
 * detail. External sources (hubspot/google) degrade gracefully into `skipped`.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (process.env.TEAM_ACTIVITY_DASHBOARD_ENABLED !== "true") {
    return NextResponse.json({ error: "Team Activity dashboard is disabled" }, { status: 503 });
  }

  const url = new URL(request.url);
  const to = url.searchParams.get("to") ? new Date(`${url.searchParams.get("to")}T23:59:59Z`) : new Date();
  const from = url.searchParams.get("from")
    ? new Date(`${url.searchParams.get("from")}T00:00:00Z`)
    : new Date(to.getTime() - 30 * DAY_MS);
  if (isNaN(+from) || isNaN(+to) || from > to) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  const only = url.searchParams.get("only")?.split(",").map((s) => s.trim()) as ActivitySource[] | undefined;
  const range: DateRange = { from, to };

  const adapters: { key: ActivitySource; run: () => Promise<AdapterResult> }[] = [
    { key: "pbops", run: () => pbopsAdapter(prisma, range, DEFAULT_ROSTER) },
    { key: "aircall", run: () => aircallAdapter(prisma, range, DEFAULT_ROSTER) },
    { key: "zuper", run: () => zuperAdapter(prisma, range, DEFAULT_ROSTER) },
    { key: "hubspot", run: () => hubspotAdapter(range, DEFAULT_ROSTER) },
    { key: "google", run: () => googleAdapter(range, DEFAULT_ROSTER) },
  ];

  const chosen = adapters.filter((a) => !only || only.includes(a.key));
  const events: ActivityEvent[] = [];
  const talk: TalkTimeRecord[] = [];
  const ran: { source: string; events: number }[] = [];
  const skipped: { source: string; reason: string }[] = [];

  const results = await Promise.all(
    chosen.map(async (a) => {
      try {
        return { key: a.key, result: await a.run() };
      } catch (e) {
        return { key: a.key, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  for (const r of results) {
    if ("error" in r && r.error) {
      skipped.push({ source: r.key, reason: `ERROR ${r.error}` });
      continue;
    }
    const res = r.result!;
    events.push(...res.events);
    if (res.talk) talk.push(...res.talk);
    if (res.skipped) skipped.push({ source: r.key, reason: res.skipped });
    else ran.push({ source: r.key, events: res.events.length });
  }

  const personDays = computePersonDays(events, talk);
  const summaries = rollupByPerson(personDays);
  const nameOf = (email: string) =>
    DEFAULT_ROSTER.find((m) => m.email.toLowerCase() === email)?.name ?? email;

  return NextResponse.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    sources: { ran, skipped },
    totalEvents: events.length,
    summaries: summaries.map((s) => ({ ...s, name: nameOf(s.email) })),
    personDays: personDays.map((d) => ({ ...d, name: nameOf(d.email) })),
    lastUpdated: new Date().toISOString(),
  });
}
