/**
 * Earliest install availability per PB location.
 *
 * "Open capacity" mirrors the construction scheduler's model: a location can
 * host DEFAULT_LOCATION_CAPACITY[location] concurrent installs per business
 * day. Occupancy is counted from ZuperJobCache construction jobs (synced from
 * Zuper every ~15 min) — one deal occupies one capacity unit per business day
 * of its span even when its PV/ESS work is split into separate Zuper tasks.
 *
 * Reads only local tables; no live Zuper calls.
 */

import { prisma } from "@/lib/db";
import { DEFAULT_LOCATION_CAPACITY, nextBusinessDayAfter } from "@/lib/schedule-optimizer";

/** How far ahead to look before giving up (business-day walk bound). */
const LOOKAHEAD_DAYS = 90;

/** Cache-side job categories that occupy install capacity. */
const CONSTRUCTION_CATEGORY_PREFIX = "Construction";

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isWeekendYmd(ymd: string): boolean {
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toYmd(d);
}

export interface EarliestAvailabilityOptions {
  /** YYYY-MM-DD override for "today" (tests); defaults to the current date. */
  today?: string;
}

/**
 * Compute the earliest open install date for each requested location.
 * Returns a map keyed by the input location strings; value is a YYYY-MM-DD
 * date or null when the lookup failed or no open day exists in the window.
 */
export async function earliestInstallAvailability(
  locations: string[],
  options: EarliestAvailabilityOptions = {}
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const wanted = [...new Set(locations.filter(Boolean))];
  if (wanted.length === 0) return result;
  for (const loc of wanted) result.set(loc, null);

  const today = options.today ?? toYmd(new Date());
  const windowEnd = addDaysYmd(today, LOOKAHEAD_DAYS + 14);

  try {
    // Construction jobs whose span can touch the window. scheduledEnd >= today
    // keeps in-flight multi-day jobs; scheduledStart <= windowEnd bounds it.
    const jobs: Array<{
      hubspotDealId: string | null;
      scheduledStart: Date | null;
      scheduledEnd: Date | null;
    }> = await prisma.zuperJobCache.findMany({
      where: {
        jobCategory: { startsWith: CONSTRUCTION_CATEGORY_PREFIX },
        scheduledEnd: { gte: new Date(`${today}T00:00:00Z`) },
        scheduledStart: { lte: new Date(`${windowEnd}T23:59:59Z`) },
      },
      select: {
        hubspotDealId: true,
        scheduledStart: true,
        scheduledEnd: true,
      },
    });

    // Resolve each job's location via the Deal mirror (pbLocation).
    const dealIds = [
      ...new Set(jobs.map((j) => j.hubspotDealId).filter((v): v is string => !!v)),
    ];
    const deals: Array<{ hubspotDealId: string; pbLocation: string | null }> =
      dealIds.length
        ? await prisma.deal.findMany({
            where: { hubspotDealId: { in: dealIds } },
            select: { hubspotDealId: true, pbLocation: true },
          })
        : [];
    const locationByDeal = new Map<string, string | null>(
      deals.map((d) => [d.hubspotDealId, d.pbLocation])
    );

    // location → date → set of deal ids occupying that day. A deal's split
    // PV/ESS tasks (same hubspotDealId) collapse into one occupancy unit.
    const occupancy = new Map<string, Map<string, Set<string>>>();
    for (const job of jobs) {
      if (!job.hubspotDealId || !job.scheduledStart) continue;
      const location = locationByDeal.get(job.hubspotDealId);
      if (!location || !result.has(location)) continue;

      const start = toYmd(job.scheduledStart);
      const end = job.scheduledEnd ? toYmd(job.scheduledEnd) : start;
      const byDate =
        occupancy.get(location) ?? new Map<string, Set<string>>();
      occupancy.set(location, byDate);

      // Walk the job span (bounded defensively), counting business days.
      let cursor = start;
      for (let i = 0; i < 30 && cursor <= end; i++) {
        if (!isWeekendYmd(cursor)) {
          const set = byDate.get(cursor) ?? new Set<string>();
          set.add(job.hubspotDealId);
          byDate.set(cursor, set);
        }
        cursor = addDaysYmd(cursor, 1);
      }
    }

    // Walk business days from the next business day; first day under capacity.
    for (const loc of wanted) {
      const capacity = DEFAULT_LOCATION_CAPACITY[loc] ?? 1;
      const byDate = occupancy.get(loc);
      let cursor = isWeekendYmd(today) ? nextBusinessDayAfter(today) : today;
      // Start from tomorrow's business day when today is a weekday — matching
      // the scheduler's "next business day" convention for new bookings.
      if (cursor === today) cursor = nextBusinessDayAfter(today);
      for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
        const used = byDate?.get(cursor)?.size ?? 0;
        if (used < capacity) {
          result.set(loc, cursor);
          break;
        }
        cursor = nextBusinessDayAfter(cursor);
      }
    }
  } catch (error) {
    console.error("[install-availability] lookup failed:", error);
    // result already holds nulls for every requested location
  }

  return result;
}
