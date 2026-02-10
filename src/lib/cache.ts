/**
 * Shared Cache Module with Request Coalescing & Stale-While-Revalidate
 *
 * Features:
 * - In-memory cache with configurable TTL
 * - Request coalescing: concurrent requests for the same key share one fetch
 * - Stale-while-revalidate: serves stale data instantly while refreshing in background
 * - Cache event listeners for real-time update notifications
 */

type CacheEntry<T> = {
  data: T;
  timestamp: number;
  stale: boolean;
};

type CacheListener = (key: string, timestamp: number) => void;

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
const STALE_TTL = 10 * 60 * 1000; // 10 minutes - serve stale data up to this long

class CacheStore {
  private cache = new Map<string, CacheEntry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  private listeners: CacheListener[] = [];
  private ttl: number;
  private staleTtl: number;

  constructor(ttl = DEFAULT_TTL, staleTtl = STALE_TTL) {
    this.ttl = ttl;
    this.staleTtl = staleTtl;
  }

  /**
   * Get cached data. Returns { data, stale, hit } where:
   * - hit: true if data was found in cache
   * - stale: true if data is past TTL but within stale window
   */
  get<T>(key: string): { data: T | null; stale: boolean; hit: boolean; age: number } {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      return { data: null, stale: false, hit: false, age: 0 };
    }

    const age = Date.now() - entry.timestamp;
    const isFresh = age < this.ttl;
    const isStale = !isFresh && age < this.staleTtl;

    if (!isFresh && !isStale) {
      // Expired beyond stale window
      this.cache.delete(key);
      return { data: null, stale: false, hit: false, age };
    }

    return { data: entry.data, stale: !isFresh, hit: true, age };
  }

  /**
   * Set cache data
   */
  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      stale: false,
    });
    this.notifyListeners(key, Date.now());
  }

  /**
   * Fetch with coalescing + stale-while-revalidate.
   *
   * If cached data is fresh, returns it immediately.
   * If cached data is stale, returns it immediately AND triggers background refresh.
   * If no cache, waits for fetch and caches result.
   * Concurrent calls for the same key share the same in-flight request.
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    forceRefresh = false
  ): Promise<{ data: T; cached: boolean; stale: boolean; lastUpdated: string }> {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = this.get<T>(key);

      if (cached.hit && !cached.stale) {
        // Fresh cache hit
        return {
          data: cached.data!,
          cached: true,
          stale: false,
          lastUpdated: new Date(Date.now() - cached.age).toISOString(),
        };
      }

      if (cached.hit && cached.stale) {
        // Stale cache hit - return immediately, refresh in background
        this.backgroundRefresh(key, fetcher);
        return {
          data: cached.data!,
          cached: true,
          stale: true,
          lastUpdated: new Date(Date.now() - cached.age).toISOString(),
        };
      }
    }

    // No cache or force refresh - fetch with coalescing
    const data = await this.coalescedFetch<T>(key, fetcher);
    return {
      data,
      cached: false,
      stale: false,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Coalesced fetch - if a request for this key is already in flight,
   * piggyback on it instead of making a duplicate request.
   */
  private async coalescedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    // Check if there's already an in-flight request for this key
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    // Start new fetch
    const promise = fetcher()
      .then((data) => {
        this.set(key, data);
        return data;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Background refresh - non-blocking cache update
   */
  private backgroundRefresh<T>(key: string, fetcher: () => Promise<T>): void {
    // Don't start another refresh if one is already in flight
    if (this.inflight.has(key)) return;

    const promise = fetcher()
      .then((data) => {
        this.set(key, data);
      })
      .catch((err) => {
        console.error(`Background refresh failed for cache key "${key}":`, err);
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
  }

  /**
   * Get cache timestamp for a key
   */
  getTimestamp(key: string): number {
    const entry = this.cache.get(key);
    return entry?.timestamp ?? 0;
  }

  /**
   * Subscribe to cache updates (for SSE/streaming)
   */
  subscribe(listener: CacheListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Notify all listeners of a cache update
   */
  private notifyListeners(key: string, timestamp: number): void {
    for (const listener of this.listeners) {
      try {
        listener(key, timestamp);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Invalidate a specific cache key and notify listeners
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    this.notifyListeners(key, Date.now());
  }

  /**
   * Invalidate all cache keys matching a prefix (e.g., "projects:" or "deals:")
   */
  invalidateByPrefix(prefix: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
      this.notifyListeners(key, Date.now());
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats for debugging.
   * Uses approximate byte length estimation to avoid expensive JSON.stringify.
   */
  stats(): { keys: string[]; sizes: Record<string, number>; inflight: string[] } {
    const sizes: Record<string, number> = {};
    for (const [key, entry] of this.cache.entries()) {
      // Use rough estimate instead of JSON.stringify for performance
      const data = entry.data;
      if (Array.isArray(data)) {
        sizes[key] = data.length * 500; // ~500 bytes per array item estimate
      } else if (typeof data === "object" && data !== null) {
        sizes[key] = Object.keys(data as Record<string, unknown>).length * 200;
      } else {
        sizes[key] = String(data).length;
      }
    }
    return {
      keys: Array.from(this.cache.keys()),
      sizes,
      inflight: Array.from(this.inflight.keys()),
    };
  }
}

// Global singleton cache instance
export const appCache = new CacheStore();

// Cache keys
export const CACHE_KEYS = {
  PROJECTS_ALL: "projects:all",
  PROJECTS_ACTIVE: "projects:active",
  DEALS: (pipeline: string) => `deals:${pipeline}`,
  STATS: "stats",
  PIPELINES: "pipelines",
} as const;
