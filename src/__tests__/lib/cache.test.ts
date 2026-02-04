// Test the CacheStore class behavior
// We can't import appCache directly as it's a singleton, so we test the module interface

describe("CacheStore (via appCache)", () => {
  let appCache: typeof import("@/lib/cache").appCache;

  beforeEach(async () => {
    // Fresh import each test to avoid shared state
    jest.resetModules();
    const cacheModule = await import("@/lib/cache");
    appCache = cacheModule.appCache;
    appCache.clear();
  });

  it("returns cached:false and fetches on first call", async () => {
    const fetcher = jest.fn().mockResolvedValue({ value: 42 });

    const result = await appCache.getOrFetch("test-key", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual({ value: 42 });
    expect(result.cached).toBe(false);
    expect(result.stale).toBe(false);
  });

  it("returns cached data on second call without calling fetcher", async () => {
    const fetcher = jest.fn().mockResolvedValue({ value: 42 });

    await appCache.getOrFetch("test-key", fetcher);
    const result = await appCache.getOrFetch("test-key", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1); // NOT called again
    expect(result.data).toEqual({ value: 42 });
    expect(result.cached).toBe(true);
    expect(result.stale).toBe(false);
  });

  it("re-fetches when forceRefresh is true", async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce({ value: 1 })
      .mockResolvedValueOnce({ value: 2 });

    await appCache.getOrFetch("test-key", fetcher);
    const result = await appCache.getOrFetch("test-key", fetcher, true);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ value: 2 });
    expect(result.cached).toBe(false);
  });

  it("coalesces concurrent requests for the same key", async () => {
    let resolvePromise: (v: unknown) => void;
    const fetcher = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    // Start two concurrent requests
    const promise1 = appCache.getOrFetch("coalesce-key", fetcher);
    const promise2 = appCache.getOrFetch("coalesce-key", fetcher);

    // Resolve the promise
    resolvePromise!({ value: "shared" });

    const [result1, result2] = await Promise.all([promise1, promise2]);

    // Only ONE fetch should have been made
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result1.data).toEqual({ value: "shared" });
    expect(result2.data).toEqual({ value: "shared" });
  });

  it("cache clear removes all entries", async () => {
    const fetcher = jest.fn().mockResolvedValue({ value: 1 });

    await appCache.getOrFetch("key1", fetcher);
    appCache.clear();
    await appCache.getOrFetch("key1", fetcher);

    // Should have fetched twice - once before clear, once after
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidate removes a specific key", async () => {
    const fetcher1 = jest.fn().mockResolvedValue({ value: 1 });
    const fetcher2 = jest.fn().mockResolvedValue({ value: 2 });

    await appCache.getOrFetch("key1", fetcher1);
    await appCache.getOrFetch("key2", fetcher2);

    appCache.invalidate("key1");

    await appCache.getOrFetch("key1", fetcher1);
    await appCache.getOrFetch("key2", fetcher2);

    expect(fetcher1).toHaveBeenCalledTimes(2); // Re-fetched after invalidate
    expect(fetcher2).toHaveBeenCalledTimes(1); // Still cached
  });

  it("subscribe notifies on cache set", async () => {
    const listener = jest.fn();
    const unsubscribe = appCache.subscribe(listener);

    await appCache.getOrFetch("notify-key", async () => "data");

    expect(listener).toHaveBeenCalledWith("notify-key", expect.any(Number));

    unsubscribe();
  });

  it("stats returns current cache info", async () => {
    await appCache.getOrFetch("stat-key", async () => ({ a: 1 }));

    const stats = appCache.stats();

    expect(stats.keys).toContain("stat-key");
    expect(stats.sizes["stat-key"]).toBeGreaterThan(0);
    expect(stats.inflight).toEqual([]);
  });
});

describe("CACHE_KEYS", () => {
  it("has expected key patterns", async () => {
    const { CACHE_KEYS } = await import("@/lib/cache");

    expect(CACHE_KEYS.PROJECTS_ALL).toBe("projects:all");
    expect(CACHE_KEYS.PROJECTS_ACTIVE).toBe("projects:active");
    expect(CACHE_KEYS.DEALS("sales")).toBe("deals:sales");
    expect(CACHE_KEYS.DEALS("dnr")).toBe("deals:dnr");
    expect(CACHE_KEYS.STATS).toBe("stats");
  });
});
