/**
 * Real "time in status" for the Permit / IC hub queues.
 *
 * `daysInStatus` used to be derived from `hs_lastmodifieddate`, which HubSpot
 * bumps on ANY property write — and a calc-property loop re-stamps every deal
 * daily, so every row computed to 0 days (verified live: 12/12 sampled rows
 * were 0, all stamped within the same minute). The only reliable source for
 * when a deal entered its CURRENT status is that status property's own history.
 *
 * HubSpot's batch-read endpoint returns an empty history block, so this has to
 * be a per-deal GET (an N+1). It is mitigated by:
 *   - Caching on (property, dealId, status). The moment a deal entered its
 *     current status does not change while it stays in that status, so a cache
 *     hit is effectively immutable, and a status change changes the key. That
 *     makes a long TTL safe and warm loads free.
 *   - Bounded concurrency + 429 backoff so a ~100-deal queue does not burst
 *     the rate limit.
 *
 * Deals whose entry time cannot be resolved are simply absent from the
 * returned map — callers should render "unknown" rather than a fake 0.
 */

import { appCache } from "@/lib/cache";

/** Parallel per-deal history GETs. Kept low to stay under the HubSpot burst limit. */
const CONCURRENCY = 6;

/**
 * 6h. Safe to keep long because the cache key includes the status: a stale
 * entry could only be wrong if a deal left and re-entered the same status
 * within the window.
 */
const TTL_MS = 6 * 60 * 60 * 1000;

const MAX_RETRIES = 3;

function cacheKey(property: string, dealId: string, status: string): string {
  return `status-entered:${property}:${dealId}:${status}`;
}

/**
 * Returns dealId → epoch ms when the deal entered its current status.
 * Deals that can't be resolved are omitted from the map.
 */
export async function fetchStatusEnteredAt(
  deals: Array<{ id: string; status: string }>,
  propertyName: string,
): Promise<Map<string, number>> {
  const resolved = new Map<string, number>();
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return resolved;

  const pending: Array<{ id: string; status: string }> = [];
  for (const deal of deals) {
    if (!deal.status) continue;
    const cached = appCache.get<number>(cacheKey(propertyName, deal.id, deal.status));
    if (cached.hit && typeof cached.data === "number") {
      resolved.set(deal.id, cached.data);
    } else {
      pending.push(deal);
    }
  }

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const deal = pending[cursor++];
      const enteredAt = await fetchOne(deal.id, deal.status, propertyName, token);
      if (enteredAt !== null) {
        resolved.set(deal.id, enteredAt);
        appCache.set(cacheKey(propertyName, deal.id, deal.status), enteredAt, {
          ttl: TTL_MS,
          staleTtl: TTL_MS,
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker),
  );
  return resolved;
}

async function fetchOne(
  dealId: string,
  status: string,
  propertyName: string,
  token: string,
): Promise<number | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const url = new URL(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`);
      url.searchParams.set("propertiesWithHistory", propertyName);
      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (resp.status === 429 && attempt < MAX_RETRIES - 1) {
        // Always wait > 1s to clear HubSpot's SECONDLY window; jitter so
        // concurrent workers don't all retry in lockstep.
        await sleep(1100 * Math.pow(2, attempt) + Math.random() * 300);
        continue;
      }
      if (!resp.ok) return null;

      const body = (await resp.json()) as {
        propertiesWithHistory?: Record<
          string,
          Array<{ value?: string; timestamp?: string }>
        >;
      };
      return entryTimestamp(body.propertiesWithHistory?.[propertyName] ?? [], status);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * History entries are value-change events. Sort newest-first and walk back
 * through the most recent contiguous run of the current status — the earliest
 * entry in that run is when the deal entered it. (Walking the run matters
 * because a re-write of the same value adds another entry.)
 */
function entryTimestamp(
  entries: Array<{ value?: string; timestamp?: string }>,
  status: string,
): number | null {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) =>
    (a.timestamp ?? "") > (b.timestamp ?? "") ? -1 : 1,
  );

  let enteredAt: string | null = null;
  for (const entry of sorted) {
    if ((entry.value ?? "") !== status) break;
    if (entry.timestamp) enteredAt = entry.timestamp;
  }
  if (!enteredAt) return null;

  const ms = new Date(enteredAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
