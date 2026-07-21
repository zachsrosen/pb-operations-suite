import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  allowedTeamsForRoles,
  isPiHubAllowedRole,
  isPiHubEnabled,
} from "@/lib/pi-hub/access";
import { parseTeam } from "@/lib/pi-hub/types";
import { fetchQueue } from "@/lib/pi-hub/queue";
import {
  attachSignals,
  fetchOpenSignals,
  isApprovalSignalsEnabled,
} from "@/lib/pi-hub/signals";
import { appCache } from "@/lib/cache";
import { batchReadDealsWithRetry } from "@/lib/hubspot";
import { TEAM_CONFIGS } from "@/lib/pi-hub/config";
import type { QueueItem, Team } from "@/lib/pi-hub/types";

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
    return NextResponse.json(await withSignals(team, cached.data));
  }

  return NextResponse.json(await withSignals(team, await buildQueueCoalesced(team)));
}

/**
 * Approval-signal join, applied to the response payload AFTER cache retrieval
 * — never inside the cached build. The queue cache serves stale data for up to
 * 15 minutes; a badge baked into the cached payload would survive a dismiss or
 * status write for that whole window. Joining per-request keeps the badge as
 * fresh as the ApprovalSignal table (the dismiss mutation invalidates the
 * client query, so the refetch lands here and sees the new state immediately).
 * Flag off ⇒ payload passes through untouched, no signal query at all.
 */
async function withSignals(team: Team, data: CachedQueue): Promise<CachedQueue> {
  if (!isApprovalSignalsEnabled()) return data;
  const signals = await fetchOpenSignals(team);
  const queue = attachSignals(data.queue, signals);

  // Signal-only rows: inspection_passed flags deals with NO pto_status, which
  // the queue's HasProperty filter excludes — without this append the badge
  // would exist in the table but never render anywhere. Fetched per-request
  // (2-3 deals, batch read) so a dismiss drops the row on the next refetch.
  const present = new Set(queue.map((q) => q.dealId));
  const orphanIds = [...signals.keys()].filter((id) => !present.has(id));
  if (orphanIds.length > 0) {
    const orphanRows = await fetchSignalOnlyRows(team, orphanIds, signals);
    queue.push(...orphanRows);
  }
  return { ...data, queue };
}

/** Minimal QueueItem rows for deals carrying an open signal but absent from
 *  the cached queue (no team status yet). Shown in the "ready" group — the
 *  signal's whole point is that these deals are ready to be picked up. */
async function fetchSignalOnlyRows(
  team: Team,
  dealIds: string[],
  signals: Awaited<ReturnType<typeof fetchOpenSignals>>,
): Promise<QueueItem[]> {
  try {
    const response = await batchReadDealsWithRetry(dealIds, [
      "dealname",
      "address_line_1",
      "city",
      "pb_location",
      "amount",
    ]);
    const results = (response?.results ?? []) as Array<{
      id: string;
      properties?: Record<string, string | null>;
    }>;
    return results.map((d) => {
      const p = d.properties ?? {};
      return {
        dealId: d.id,
        name: p.dealname ?? "Untitled",
        address: [p.address_line_1, p.city].filter(Boolean).join(", ") || null,
        pbLocation: p.pb_location ?? null,
        status: "",
        statusLabel: `No ${TEAM_CONFIGS[team].label} status yet`,
        dealStage: null,
        group: "ready" as const,
        daysInStatus: null,
        isStale: false,
        lead: null,
        leadOwnerId: null,
        pm: null,
        amount: p.amount ? Number(p.amount) : null,
        signal: signals.get(d.id) ?? null,
      };
    });
  } catch (err) {
    // The appended rows are a convenience — never fail the queue over them.
    console.error("[pi-hub] signal-only row fetch failed:", err);
    return [];
  }
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
