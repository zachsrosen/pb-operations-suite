/**
 * Cross-instance shared cache with single-flight refresh.
 *
 * Problem this solves: `appCache` (lib/cache.ts) is an in-memory Map that lives
 * per serverless instance. During a traffic surge, every cold Vercel lambda
 * independently runs its own full HubSpot fetch at the same time — a thundering
 * herd that exhausts HubSpot's per-app rate limit and 500s the dashboards.
 *
 * This layer sits between the in-memory cache (L1) and HubSpot. It keeps the
 * last-good payload in a store shared by all instances (Postgres) and uses a
 * lease-based lock so that, across the whole fleet, only ONE instance refreshes
 * a given key at a time. Cold instances read the shared snapshot instead of
 * each hitting HubSpot, and on a failed refresh we serve the last-good snapshot
 * rather than throwing a 500.
 *
 * The orchestration here is storage-agnostic (depends only on SharedCacheStore)
 * so it is unit-testable with a fake store. The Prisma-backed implementation
 * lives in shared-cache-store.ts.
 */

export interface SharedCacheRecord {
  /** The cached payload. */
  value: unknown;
  /** Epoch ms when the payload was written. */
  updatedAt: number;
}

export interface SharedCacheStore {
  /** Read the current record for a key, or null if none exists. */
  read(key: string): Promise<SharedCacheRecord | null>;
  /** Write a fresh payload, stamped at `now` (epoch ms). */
  write(key: string, value: unknown, now: number): Promise<void>;
  /**
   * Atomically acquire the refresh lock for a key. Returns true only if the
   * lock was free or its lease (leaseMs) had expired. Must be atomic across
   * instances (e.g. a conditional UPDATE) to actually prevent stampedes.
   */
  acquireLock(key: string, now: number, leaseMs: number): Promise<boolean>;
  /** Release the refresh lock for a key. */
  releaseLock(key: string): Promise<void>;
}

export interface SharedCacheOptions {
  /** Fresh window (ms): within this age a record is served as-is. */
  ttlMs: number;
  /** Serve-stale window (ms): past ttl but within this, serve stale + refresh. */
  staleTtlMs: number;
  /** Lock lease (ms): a held lock older than this is considered abandoned. */
  lockLeaseMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Bypass the cache and force a synchronous refresh. */
  forceRefresh?: boolean;
}

export type SharedCacheSource = "fresh" | "stale" | "fetched";

export interface SharedCacheResult<T> {
  data: T;
  source: SharedCacheSource;
}

// In-flight background refreshes, keyed by cache key. Provides in-process
// coalescing (one background refresh per key per instance) and a hook for
// tests to await pending refreshes.
const backgroundRefreshes = new Map<string, Promise<void>>();

/** Test helper: await all in-flight background refreshes to settle. */
export async function flushBackgroundRefreshes(): Promise<void> {
  await Promise.allSettled([...backgroundRefreshes.values()]);
}

/** Fetch under a held lock, persist, and always release the lock. */
async function fetchUnderLock<T>(
  key: string,
  fetcher: () => Promise<T>,
  store: SharedCacheStore,
  now: number,
): Promise<T> {
  try {
    const data = await fetcher();
    await store.write(key, data, now);
    return data;
  } finally {
    await store.releaseLock(key);
  }
}

function startBackgroundRefresh<T>(
  key: string,
  fetcher: () => Promise<T>,
  store: SharedCacheStore,
  now: number,
  leaseMs: number,
): void {
  if (backgroundRefreshes.has(key)) return;
  const promise = (async () => {
    const acquired = await store.acquireLock(key, now, leaseMs);
    if (!acquired) return; // another instance is already refreshing
    try {
      await fetchUnderLock(key, fetcher, store, now);
    } catch (err) {
      console.error(`[shared-cache] background refresh failed for "${key}":`, err);
    }
  })().finally(() => {
    backgroundRefreshes.delete(key);
  });
  backgroundRefreshes.set(key, promise);
}

/**
 * Get a value through the shared cache, refreshing via `fetcher` at most once
 * per key across the fleet.
 */
export async function getOrFetchShared<T>(
  key: string,
  fetcher: () => Promise<T>,
  store: SharedCacheStore,
  options: SharedCacheOptions,
): Promise<SharedCacheResult<T>> {
  const now = options.now ? options.now() : Date.now();
  const { ttlMs, staleTtlMs, lockLeaseMs, forceRefresh } = options;

  const record = forceRefresh ? null : await store.read(key);

  if (record) {
    const age = now - record.updatedAt;

    if (age < ttlMs) {
      return { data: record.value as T, source: "fresh" };
    }

    if (age < staleTtlMs) {
      // Stale but usable: serve immediately, refresh in the background.
      startBackgroundRefresh(key, fetcher, store, now, lockLeaseMs);
      return { data: record.value as T, source: "stale" };
    }

    // Expired: refresh synchronously, but don't stampede. If another instance
    // already holds the lock, serve the last-good payload instead of piling on.
    const acquired = await store.acquireLock(key, now, lockLeaseMs);
    if (!acquired) {
      return { data: record.value as T, source: "stale" };
    }
    try {
      const data = await fetchUnderLock(key, fetcher, store, now);
      return { data, source: "fetched" };
    } catch {
      // Refresh failed — serve last-good rather than 500.
      return { data: record.value as T, source: "stale" };
    }
  }

  // No record at all (cold key). Try to be the one that fetches.
  const acquired = await store.acquireLock(key, now, lockLeaseMs);
  if (!acquired) {
    // Another instance is fetching the cold key. Briefly wait for it to land
    // rather than launching a duplicate fetch.
    const polled = await pollForRecord(store, key, lockLeaseMs);
    if (polled) {
      return { data: polled.value as T, source: "stale" };
    }
    // Last resort: fetch ourselves (without the lock) so we never hang.
    const data = await fetcher();
    await store.write(key, data, now).catch(() => {});
    return { data, source: "fetched" };
  }
  // We hold the lock — fetch and propagate errors (no prior value to fall back to).
  const data = await fetchUnderLock(key, fetcher, store, now);
  return { data, source: "fetched" };
}

/** Poll the store for a record to appear, up to ~maxWaitMs. */
async function pollForRecord(
  store: SharedCacheStore,
  key: string,
  maxWaitMs: number,
): Promise<SharedCacheRecord | null> {
  const stepMs = 200;
  const deadline = Date.now() + Math.min(maxWaitMs, 3_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, stepMs));
    const record = await store.read(key);
    if (record) return record;
  }
  return null;
}
