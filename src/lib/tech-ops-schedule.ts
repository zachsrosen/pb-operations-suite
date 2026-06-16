/**
 * Shared upcoming-schedule reader for the Tech Ops bot.
 *
 * Single source of truth for "what's scheduled" — used by both the
 * get_schedule_overview chat tool and the proactive room digests. Pulls from
 * ScheduleRecord (the canonical schedule table) and resolves each job's
 * authoritative location from the deal's own pb_location via a HubSpot batch
 * read (NOT BookedSlot, which is sparsely populated and silently drops jobs).
 */

import { prisma } from "@/lib/db";

export interface ScheduledJob {
  date: string;
  type: string;
  project: string;
  projectId: string;
  location: string | null;
  crew: string | null;
  status: string;
}

export interface UpcomingSchedule {
  from: string;
  to: string;
  days: number;
  jobs: ScheduledJob[];
}

/**
 * The team's upcoming scheduled work for the next N days (capped at 30).
 * Pass `locations` (canonical names) to scope to specific shops; null/empty
 * returns all locations.
 */
export async function getUpcomingScheduledJobs(opts: {
  days?: number;
  locations?: string[] | null;
}): Promise<UpcomingSchedule> {
  const days = Math.min(Math.max(opts.days ?? 7, 1), 30);
  const today = new Date();
  const fromStr = today.toISOString().slice(0, 10);
  const end = new Date(today);
  end.setDate(end.getDate() + days);
  const toStr = end.toISOString().slice(0, 10);

  if (!prisma) return { from: fromStr, to: toStr, days, jobs: [] };

  const records = await prisma.scheduleRecord.findMany({
    where: {
      scheduledDate: { gte: fromStr, lte: toStr },
      status: { in: ["scheduled", "rescheduled"] },
    },
    orderBy: [{ scheduledDate: "asc" }],
    take: 300,
    select: {
      scheduledDate: true,
      scheduleType: true,
      projectId: true,
      projectName: true,
      assignedUser: true,
      status: true,
    },
  });

  // Resolve each scheduled deal's pb_location via batch read (chunks of 100).
  const dealIds = [...new Set(records.map((r) => r.projectId).filter(Boolean))];
  const locByDeal = new Map<string, string>();
  if (dealIds.length > 0) {
    const { batchReadDealsWithRetry } = await import("@/lib/hubspot");
    for (let i = 0; i < dealIds.length; i += 100) {
      try {
        const res = await batchReadDealsWithRetry(dealIds.slice(i, i + 100), ["pb_location"]);
        for (const d of res.results ?? []) {
          const loc = d.properties?.pb_location;
          if (d.id && loc) locByDeal.set(d.id, loc);
        }
      } catch {
        // Non-fatal: unresolved deals just carry no location.
      }
    }
  }

  const wanted =
    opts.locations && opts.locations.length > 0 ? new Set(opts.locations) : null;
  const normalizeLocation = wanted
    ? (await import("@/lib/locations")).normalizeLocation
    : null;

  const jobs: ScheduledJob[] = [];
  for (const r of records) {
    const rawLoc = locByDeal.get(r.projectId) ?? null;
    if (wanted) {
      const canon = normalizeLocation!(rawLoc ?? "");
      if (!canon || !wanted.has(canon)) continue;
    }
    jobs.push({
      date: r.scheduledDate,
      type: r.scheduleType,
      project: r.projectName,
      projectId: r.projectId,
      location: rawLoc,
      crew: r.assignedUser ?? null,
      status: r.status,
    });
  }

  return { from: fromStr, to: toStr, days, jobs };
}
