import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { batchReadDealsWithRetry, batchReadTasksWithRetry } from "@/lib/hubspot";
import { denverDay, type ActivityEvent, type ActivitySource } from "@/lib/team-activity/metrics";
import { isTeamActivityEnabled, getReportsAdminEmail } from "@/lib/team-activity/flag";
import {
  pbopsAdapter,
  aircallAdapter,
  zuperAdapter,
  hubspotAdapter,
  googleAdapter,
  peAdapter,
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
    { key: "pe", run: () => peAdapter(prisma, range, roster) },
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
      raw.filter((e) => e.objectKey?.startsWith("DEAL:")).map((e) => e.objectKey!.slice("DEAL:".length)),
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

  // Resolve HubSpot TASK ids -> task subject (tasks dominate the audit stream).
  const taskNames = new Map<string, string>();
  const taskIds = [
    ...new Set(
      raw
        .filter((e) => e.source === "hubspot" && e.objectKey?.startsWith("TASK:"))
        .map((e) => e.objectKey!.slice("TASK:".length)),
    ),
  ];
  if (taskIds.length) {
    try {
      for (let i = 0; i < taskIds.length; i += 100) {
        const res = await batchReadTasksWithRetry(taskIds.slice(i, i + 100));
        for (const r of res.results) {
          const subject = (r.properties as Record<string, string | null>)?.hs_task_subject;
          if (subject) taskNames.set(r.id, subject);
        }
      }
    } catch {
      // best-effort
    }
  }

  // Resolve Aircall call ids -> "to/from <number> · Nm talk".
  const callLabels = new Map<string, string>();
  const callIds = [
    ...new Set(
      raw.filter((e) => e.source === "aircall" && e.objectKey?.startsWith("call:")).map((e) => e.objectKey!.slice("call:".length)),
    ),
  ];
  if (callIds.length) {
    const calls = await prisma.aircallCallCache.findMany({
      where: { id: { in: callIds } },
      select: { id: true, customerNumber: true, talkTimeSec: true, direction: true },
    });
    for (const c of calls) {
      const who = c.customerNumber ?? "unknown";
      const mins = Math.round((c.talkTimeSec ?? 0) / 60);
      callLabels.set(c.id, `${c.direction === "inbound" ? "from" : "to"} ${who}${mins ? ` · ${mins}m talk` : ""}`);
    }
  }

  // Resolve Zuper job UIDs -> "Category: title (status)".
  const jobLabels = new Map<string, string>();
  const jobUids = [
    ...new Set(
      raw.filter((e) => e.source === "zuper" && e.objectKey?.startsWith("job:")).map((e) => e.objectKey!.slice("job:".length)),
    ),
  ];
  if (jobUids.length) {
    const jobs = await prisma.zuperJobCache.findMany({
      where: { jobUid: { in: jobUids } },
      select: { jobUid: true, jobTitle: true, jobCategory: true, jobStatus: true },
    });
    for (const j of jobs) {
      jobLabels.set(j.jobUid, `${j.jobCategory}: ${j.jobTitle}${j.jobStatus ? ` (${j.jobStatus})` : ""}`);
    }
  }

  const labelFor = (e: ActivityEvent): string | null => {
    if (!e.objectKey) return null;
    if (e.objectKey.startsWith("DEAL:")) {
      const name = dealNames.get(e.objectKey.slice("DEAL:".length));
      return name ? `Deal: ${name}` : e.objectKey;
    }
    if (e.objectKey.startsWith("TASK:")) {
      const subject = taskNames.get(e.objectKey.slice("TASK:".length));
      return subject ? `Task: ${subject}` : e.objectKey;
    }
    if (e.objectKey.startsWith("job:")) {
      return jobLabels.get(e.objectKey.slice("job:".length)) ?? e.objectKey;
    }
    if (e.objectKey.startsWith("call:")) {
      return callLabels.get(e.objectKey.slice("call:".length)) ?? null;
    }
    if (e.objectKey.startsWith("pe:")) {
      return e.objectKey.slice("pe:".length);
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
