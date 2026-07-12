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
import { isTeamActivityEnabled, getReportsAdminEmail } from "@/lib/team-activity/flag";
import {
  pbopsAdapter,
  aircallAdapter,
  zuperAdapter,
  hubspotAdapter,
  googleAdapter,
  peAdapter,
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
  if (!(await isTeamActivityEnabled())) {
    return NextResponse.json({ error: "Team Activity dashboard is disabled" }, { status: 503 });
  }

  const url = new URL(request.url);
  const to = url.searchParams.get("to") ? new Date(`${url.searchParams.get("to")}T23:59:59Z`) : new Date();
  const from = url.searchParams.get("from")
    ? new Date(`${url.searchParams.get("from")}T00:00:00Z`)
    : new Date(to.getTime() - 14 * DAY_MS);
  if (isNaN(+from) || isNaN(+to) || from > to) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  const only = url.searchParams.get("only")?.split(",").map((s) => s.trim()) as ActivitySource[] | undefined;
  const range: DateRange = { from, to };
  const reportsAdmin = await getReportsAdminEmail();

  // Ad-hoc lookup: `?emails=a@x.com,b@x.com` builds a one-off roster (names
  // resolved from the User directory) instead of the default team. Adapters
  // resolve everything else by email/directory, so no pre-known IDs are needed.
  const emailsParam = url.searchParams
    .get("emails")
    ?.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  let roster = DEFAULT_ROSTER;
  if (emailsParam?.length) {
    const users = await prisma.user.findMany({
      where: { email: { in: emailsParam, mode: "insensitive" } },
      select: { email: true, name: true },
    });
    const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name]));
    roster = emailsParam.map((email) => ({ email, name: nameByEmail.get(email) ?? email }));
  }

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
    else ran.push({ source: r.key, events: res.events.length, ...(res.warning ? { warning: res.warning } : {}) });
  }

  const personDays = computePersonDays(events, talk);
  const summaries = rollupByPerson(personDays);
  const nameOf = (email: string) =>
    roster.find((m) => m.email.toLowerCase() === email)?.name ?? email;

  return NextResponse.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    sources: { ran, skipped },
    totalEvents: events.length,
    summaries: summaries.map((s) => ({ ...s, name: nameOf(s.email) })),
    personDays: personDays.map((d) => ({ ...d, name: nameOf(d.email) })),
    lastUpdated: new Date().toISOString(),
  });
}
