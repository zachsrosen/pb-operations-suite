/**
 * Capacity computation for scheduler-v2.
 *
 * Produces one CapacityCell per location × date covering every calendar day
 * within the supplied dateRange (inclusive on both ends, including weekends —
 * the board layer decides which days to show).
 *
 * ## Capacity blend rule (phase 1)
 *
 * capacityDays for a location/day is determined as follows:
 *
 *   1. If one or more `Resource`s with `assignable:true` have that location as
 *      their `primaryLocation`, capacityDays = SUM(resource.capacityPerDay) for
 *      those resources. This lets multi-crew locations (e.g. Westminster with 2
 *      crews) report capacity > the single-job default.
 *
 *   2. If no assignable resource matches, fall back to
 *      DEFAULT_LOCATION_CAPACITY[location] ?? 1. This guarantees we never
 *      report 0 for a known location that simply has no crew data yet.
 *
 * Rationale: Resource.capacityPerDay comes from CrewMember.maxDailyJobs (set by
 * admin), which is the ground truth for how many concurrent jobs a crew can run.
 * The DEFAULT_LOCATION_CAPACITY is the historical conservative baseline from
 * schedule-optimizer.ts; it acts as a safe floor when crew data is absent.
 *
 * loadDays per location/day = count of Assignments whose location matches AND
 * whose date falls in range. Each Assignment represents one install-day (the
 * crew-schedule API already expands multi-day jobs into per-day rows before
 * returning them).
 */

import type { Assignment, CapacityCell, Resource } from "./types";
import { DEFAULT_LOCATION_CAPACITY } from "./constants";

/**
 * Enumerates every calendar date between start and end (YYYY-MM-DD, inclusive).
 */
function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);

  const cur = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);

  while (cur <= last) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }

  return dates;
}

/**
 * Pre-compute the capacity contribution per location from the Resource list.
 * Only assignable resources with a matching primaryLocation are counted.
 *
 * Returns a map of location → total capacityPerDay (or undefined if no
 * assignable resource maps to that location).
 */
function buildResourceCapacityByLocation(
  resources: Resource[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of resources) {
    if (!r.assignable) continue;
    const loc = r.primaryLocation;
    map.set(loc, (map.get(loc) ?? 0) + r.capacityPerDay);
  }
  return map;
}

/**
 * Compute CapacityCell[] for every location × date in the range.
 *
 * @param assignments   All assignments for the period (from /api/crew-schedule).
 *                      Each entry represents one install-day at a location.
 * @param resources     Resource list for the board (from the construction adapter
 *                      or /board endpoint). Used for the capacity blend rule.
 * @param locations     Canonical list of locations to include in the output.
 * @param dateRange     Inclusive start+end (YYYY-MM-DD). All calendar days are
 *                      enumerated — weekend filtering is the board's concern.
 */
export function computeCapacityCells(
  assignments: Assignment[],
  resources: Resource[],
  locations: string[],
  dateRange: { start: string; end: string }
): CapacityCell[] {
  const dates = enumerateDates(dateRange.start, dateRange.end);
  const resourceCapacity = buildResourceCapacityByLocation(resources);

  // Build a fast lookup: "location|date" → loadDays count
  const loadMap = new Map<string, number>();
  for (const a of assignments) {
    const loc = a.location ?? "";
    if (!loc) continue;
    const key = `${loc}|${a.date}`;
    loadMap.set(key, (loadMap.get(key) ?? 0) + 1);
  }

  const cells: CapacityCell[] = [];

  for (const location of locations) {
    // Resolve capacity for this location (blend rule — see module comment)
    const capacityDays =
      resourceCapacity.has(location)
        ? (resourceCapacity.get(location) as number)
        : (DEFAULT_LOCATION_CAPACITY[location] ?? 1);

    for (const date of dates) {
      const loadDays = loadMap.get(`${location}|${date}`) ?? 0;
      cells.push({ location, date, loadDays, capacityDays });
    }
  }

  return cells;
}
