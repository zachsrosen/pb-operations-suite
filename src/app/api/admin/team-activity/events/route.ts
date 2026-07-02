import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { batchReadDealsWithRetry } from "@/lib/hubspot";
import { denverDay, type ActivityEvent, type ActivitySource } from "@/lib/team-activity/metrics";
import { isTeamActivityEnabled, getReportsAdminEmail } from "@/lib/team-activity/flag";
import {
  pbopsAdapter,
  aircallAdapter,
  zuperAdapter,
  hubspotAdapter,
  googleAdapter,
  type DateRange,
} from "@/lib/team-activity/adapters";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

/**
 * GET /api/admin/team-activity/events?email=X&day=YYYY-MM-DD&only=pbops,hubspot
 *
 * Drilldown: the raw individual events for one person on one Denver-local day,
 * sorted by time. ADMIN + flag gated. Fetches a ±1-day UTC window and filters to
 * the exact Denver day so late-night events land correctly.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.roles.includes("ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await isTeamActivityEnabled())) {
    return NextResponse.json({ error: "Team Activity dashboard is disabled" }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const email = params.get("email")?.trim().toLowerCase();
  const day = params.get("day")?.trim();
  if (!email || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "email and day (YYYY-MM-DD) required" }, { status: 400 });
  }
  const only = params.get("only")?.split(",").map((s) => s.trim()) as ActivitySource[] | undefined;

  // Wide UTC window around the Denver day; filter precisely below.
  const mid = new Date(`${day}T12:00:00Z`).getTime();
  const range: DateRange = { from: new Date(mid - DAY_MS), to: new Date(mid + DAY_MS) };
  const roster = [{ email, name: email }];
  const reportsAdmin = await getReportsAdminEmail();

  const adapters: { key: ActivitySource; run: () => Promise<{ events: ActivityEvent[] }> }[] = [
    { key: "pbops", run: () => pbopsAdapter(prisma, range, roster) },
    { key: "aircall", run: () => aircallAdapter(prisma, range, roster) },
    { key: "zuper", run: () => zuperAdapter(prisma, range, roster) },
    { key: "hubspot", run: () => hubspotAdapter(range, roster) },
    { key: "google", run: () => googleAdapter(range, roster, reportsAdmin) },
  ];
  const chosen = adapters.filter((a) => !only || only.includes(a.key));

  const settled = await Promise.all(
    chosen.map((a) => a.run().then((r) => r.events).catch(() => [] as ActivityEvent[])),
  );
  const raw = settled
    .flat()
    .filter((e) => denverDay(e.timestamp) === day)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Resolve HubSpot DEAL ids -> deal names (deals dominate the audit stream).
  const dealNames = new Map<string, string>();
  const dealIds = [
    ...new Set(
      raw
        .filter((e) => e.source === "hubspot" && e.objectKey?.startsWith("DEAL:"))
        .map((e) => e.objectKey!.slice("DEAL:".length)),
    ),
  ];
  if (dealIds.length) {
    try {
      for (let i = 0; i < dealIds.length; i += 100) {
        const res = await batchReadDealsWithRetry(dealIds.slice(i, i + 100), ["dealname"]);
        for (const r of res.results) {
          const name = (r.properties as Record<string, string | null>)?.dealname;
          if (name) dealNames.set(r.id, name);
        }
      }
    } catch {
      // resolution is best-effort; fall back to raw ids
    }
  }

  const labelFor = (e: ActivityEvent): string | null => {
    if (!e.objectKey) return null;
    if (e.objectKey.startsWith("DEAL:")) {
      const name = dealNames.get(e.objectKey.slice("DEAL:".length));
      return name ? `Deal: ${name}` : e.objectKey;
    }
    return e.objectKey;
  };

  const events = raw.map((e) => ({
    ts: e.timestamp.toISOString(),
    source: e.source,
    kind: e.kind ?? null,
    objectKey: e.objectKey ?? null,
    label: labelFor(e),
  }));

  return NextResponse.json({ email, day, count: events.length, events });
}
