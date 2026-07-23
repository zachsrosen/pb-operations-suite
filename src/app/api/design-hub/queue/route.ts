import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  isDesignHubAllowedRole,
  isDesignHubEnabled,
} from "@/lib/design-hub/access";
import { parseTab } from "@/lib/design-hub/types";
import { TAB_CONFIGS } from "@/lib/design-hub/config";
import { fetchQueue } from "@/lib/design-hub/queue";
import {
  attachAssignments,
  fetchOpenAssignments,
} from "@/lib/design-hub/assignments";
import { getEnumLabelMap } from "@/lib/hubspot-enum-labels";
import { appCache } from "@/lib/cache";
import type { QueueItem, Tab } from "@/lib/design-hub/types";

/**
 * A queue build costs one HubSpot status-history call per deal, which can
 * exceed the function limit on a cold instance. Cache the built queue per tab:
 * the first request per instance pays, every other request (and every OTHER
 * USER) is instant. Stale-while-refresh means a stale-window hit serves
 * immediately AND refreshes behind the response. Mirrors pi-hub exactly.
 */
const QUEUE_TTL_MS = 2 * 60 * 1000;
const QUEUE_STALE_TTL_MS = 15 * 60 * 1000;

interface CachedQueue {
  queue: QueueItem[];
  lastUpdated: string;
}

/** In-flight builds per tab, so a cold instance doesn't stampede HubSpot. */
const inFlight = new Map<Tab, Promise<CachedQueue>>();

async function buildAndCache(tab: Tab): Promise<CachedQueue> {
  const built: CachedQueue = {
    queue: await fetchQueue(tab),
    lastUpdated: new Date().toISOString(),
  };
  appCache.set(`design-hub:queue:${tab}`, built, {
    ttl: QUEUE_TTL_MS,
    staleTtl: QUEUE_STALE_TTL_MS,
  });
  return built;
}

function buildQueueCoalesced(tab: Tab): Promise<CachedQueue> {
  const existing = inFlight.get(tab);
  if (existing) return existing;
  const promise = buildAndCache(tab).finally(() => inFlight.delete(tab));
  inFlight.set(tab, promise);
  return promise;
}

function refreshInBackground(tab: Tab): void {
  // Failure here is invisible by design: the response already went out with
  // cached data, and the next expired-window request rebuilds. Swallowing
  // keeps an unhandled rejection from killing the process.
  void buildQueueCoalesced(tab).catch(() => {});
}

/**
 * Assignment join, applied to the response payload AFTER cache retrieval —
 * never inside the cached build. The queue cache serves stale data for up to
 * 15 minutes; a badge baked into the cached payload would survive a clear for
 * that whole window.
 */
async function withAssignments(
  tab: Tab,
  data: CachedQueue,
): Promise<CachedQueue> {
  const [assignments, statusLabels] = await Promise.all([
    fetchOpenAssignments(tab),
    getEnumLabelMap(TAB_CONFIGS[tab].statusProperty),
  ]);
  if (assignments.size === 0) return data;
  return {
    ...data,
    queue: attachAssignments(data.queue, assignments, statusLabels),
  };
}

export async function GET(req: NextRequest) {
  if (!isDesignHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isDesignHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tab = parseTab(req.nextUrl.searchParams.get("tab"));
  if (!tab) {
    return NextResponse.json({ error: "Invalid tab" }, { status: 400 });
  }

  const cached = appCache.get<CachedQueue>(`design-hub:queue:${tab}`);
  if (cached.hit && cached.data) {
    if (cached.stale) {
      // Serve instantly, refresh behind the response. If the platform kills
      // the orphaned promise, the next expired-window request rebuilds — the
      // failure mode is "data a few minutes older", never a hang.
      refreshInBackground(tab);
    }
    return NextResponse.json(await withAssignments(tab, cached.data));
  }

  return NextResponse.json(
    await withAssignments(tab, await buildQueueCoalesced(tab)),
  );
}
