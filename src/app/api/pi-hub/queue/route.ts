import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  allowedTeamsForRoles,
  isPiHubAllowedRole,
  isPiHubEnabled,
} from "@/lib/pi-hub/access";
import { parseTeam } from "@/lib/pi-hub/types";
import { fetchQueue } from "@/lib/pi-hub/queue";
import { appCache } from "@/lib/cache";
import type { QueueItem } from "@/lib/pi-hub/types";

/**
 * A queue build costs 5-9s warm and can exceed the 60s function limit cold:
 * one HubSpot status-history call per deal (87-164 per team) at concurrency 6
 * against HubSpot's ~4/s limit, where 429 backoff compounds. The first real
 * user hit a cold instance and saw nothing but skeletons while retries burned.
 *
 * Cache the built queue per team: the first request per instance pays, every
 * other request (and every OTHER USER) is instant. Stale-while-refresh: a
 * stale-window hit serves immediately AND refreshes in the background, so the
 * data stays at most ~2min behind without anyone waiting on a rebuild.
 */
const QUEUE_TTL_MS = 2 * 60 * 1000;
const QUEUE_STALE_TTL_MS = 15 * 60 * 1000;

interface CachedQueue {
  queue: QueueItem[];
  lastUpdated: string;
}

async function buildAndCache(team: string): Promise<CachedQueue> {
  const built: CachedQueue = {
    queue: await fetchQueue(team as Parameters<typeof fetchQueue>[0]),
    lastUpdated: new Date().toISOString(),
  };
  appCache.set(`pi-hub:queue:${team}`, built, {
    ttl: QUEUE_TTL_MS,
    staleTtl: QUEUE_STALE_TTL_MS,
  });
  return built;
}

export async function GET(req: NextRequest) {
  if (!isPiHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isPiHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const team = parseTeam(req.nextUrl.searchParams.get("team"));
  if (!team) {
    return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  }
  if (!allowedTeamsForRoles(auth.roles).includes(team)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cached = appCache.get<CachedQueue>(`pi-hub:queue:${team}`);
  if (cached.hit && cached.data) {
    if (cached.stale) {
      // Serve instantly, refresh behind the response. If the platform kills
      // the orphaned promise, the next expired-window request rebuilds — the
      // failure mode is "data a few minutes older", never a hang.
      void refreshInBackground(team);
    }
    return NextResponse.json(cached.data);
  }

  return NextResponse.json(await buildQueueCoalesced(team));
}

/** Coalesce concurrent cold builds so N users on an empty cache pay once. */
const inflightBuilds = new Map<string, Promise<CachedQueue>>();

function buildQueueCoalesced(team: string): Promise<CachedQueue> {
  let inflight = inflightBuilds.get(team);
  if (!inflight) {
    inflight = buildAndCache(team).finally(() => inflightBuilds.delete(team));
    inflightBuilds.set(team, inflight);
  }
  return inflight;
}

function refreshInBackground(team: string): void {
  if (inflightBuilds.has(team)) return;
  buildQueueCoalesced(team).catch((err) => {
    console.error(`[pi-hub] background queue refresh failed for ${team}:`, err);
  });
}
