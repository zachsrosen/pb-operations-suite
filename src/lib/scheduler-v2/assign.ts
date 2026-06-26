/**
 * scheduler-v2 — director-team user resolution.
 *
 * Resolves the live Zuper users for each construction director team
 * (CONSTRUCTION_DIRECTORS) and returns them keyed by location, in the shape the
 * construction adapter's `toResources()` expects (TeamUser[]).
 *
 * This reuses the SAME Zuper client call the teams/users route uses
 * (`zuper.getTeamDetail(teamUid)`), so the roster matches what the existing
 * construction scheduler sees. We intentionally call the client directly rather
 * than HTTP-fetching /api/zuper/teams/[teamUid]/users.
 *
 * Caching: results are cached in `appCache` with a ~30 min TTL — director teams
 * change rarely and team lookups are a few Zuper API calls each.
 *
 * Fail-soft: if a team fetch fails (or Zuper is not configured), that location
 * resolves to an empty array and we log a warning. We never throw, so a Zuper
 * hiccup degrades the board roster instead of failing the whole /board request.
 */

import { zuper } from "@/lib/zuper";
import { appCache } from "@/lib/cache";
import { CONSTRUCTION_DIRECTORS } from "./constants";
import type { TeamUser } from "./adapters/construction";

/** Public alias so callers don't need to import the adapter's input type directly. */
export type ZuperUser = TeamUser;

const CACHE_KEY = "scheduler-v2:director-team-users";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — director teams change rarely

/**
 * Resolve the live Zuper users for every CONSTRUCTION_DIRECTORS entry, keyed by
 * location. Each location maps to the TeamUser[] for that director's teamUid.
 *
 * Multiple locations may share a teamUid (e.g. Centennial + DTC, SLO + Camarillo);
 * each gets its own copy of the resolved user list so the adapter can build a row
 * per location.
 */
export async function getTeamUsersByLocation(): Promise<Record<string, ZuperUser[]>> {
  const { data } = await appCache.getOrFetch<Record<string, ZuperUser[]>>(
    CACHE_KEY,
    resolveTeamUsersByLocation,
    false,
    { ttl: CACHE_TTL_MS, staleTtl: CACHE_TTL_MS * 2 },
  );
  return data;
}

/**
 * Uncached resolver. Exported for testing; prefer getTeamUsersByLocation() in
 * application code so results are cached.
 */
export async function resolveTeamUsersByLocation(): Promise<Record<string, ZuperUser[]>> {
  const result: Record<string, ZuperUser[]> = {};

  // Fail-soft: if Zuper isn't configured, every location resolves to empty.
  if (!zuper.isConfigured()) {
    for (const location of Object.keys(CONSTRUCTION_DIRECTORS)) {
      result[location] = [];
    }
    return result;
  }

  // Resolve each unique teamUid once, then fan back out to every location that
  // points at it (Centennial/DTC and SLO/Camarillo share teams).
  const teamUidToLocations = new Map<string, string[]>();
  for (const [location, director] of Object.entries(CONSTRUCTION_DIRECTORS)) {
    const teamUid = director.teamUid;
    const existing = teamUidToLocations.get(teamUid);
    if (existing) existing.push(location);
    else teamUidToLocations.set(teamUid, [location]);
  }

  await Promise.all(
    [...teamUidToLocations.entries()].map(async ([teamUid, locations]) => {
      const users = await fetchTeamUsersSafe(teamUid);
      for (const location of locations) {
        // Clone per location so downstream mutation can't bleed across locations.
        result[location] = users.map((u) => ({ ...u }));
      }
    }),
  );

  return result;
}

/**
 * Fetch one team's users via the Zuper client. Returns [] (never throws) on any
 * error or empty/malformed response. Logs a warning so failures are visible.
 */
async function fetchTeamUsersSafe(teamUid: string): Promise<ZuperUser[]> {
  try {
    const detail = await zuper.getTeamDetail(teamUid);
    if (detail.type === "error" || !detail.data) {
      console.warn(
        `[scheduler-v2/assign] team ${teamUid} fetch failed: ${detail.error || "no data"}`,
      );
      return [];
    }

    const users = Array.isArray(detail.data.users) ? detail.data.users : [];
    return users
      .map((u) => {
        const name = `${u.first_name || ""} ${u.last_name || ""}`.trim();
        return { name, userUid: u.user_uid, teamUid };
      })
      .filter((u) => Boolean(u.userUid) && Boolean(u.name));
  } catch (error) {
    console.warn(`[scheduler-v2/assign] team ${teamUid} fetch threw:`, error);
    return [];
  }
}
