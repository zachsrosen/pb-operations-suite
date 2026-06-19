// Unit tests for the cross-instance shared cache orchestration.
// The store is injected (fake in-memory impl) so we test the fresh/stale/
// fetch/error/single-flight logic without a database.
jest.mock("@/lib/db", () => ({ prisma: null }));

import {
  getOrFetchShared,
  flushBackgroundRefreshes,
  type SharedCacheStore,
  type SharedCacheRecord,
} from "@/lib/shared-cache";

class FakeStore implements SharedCacheStore {
  records = new Map<string, SharedCacheRecord>();
  locks = new Map<string, number>(); // key -> lockedAt (epoch ms)
  readCalls = 0;
  writeCalls = 0;

  async read(key: string): Promise<SharedCacheRecord | null> {
    this.readCalls++;
    return this.records.get(key) ?? null;
  }
  async write(key: string, value: unknown, now: number): Promise<void> {
    this.writeCalls++;
    this.records.set(key, { value, updatedAt: now });
  }
  async acquireLock(key: string, now: number, leaseMs: number): Promise<boolean> {
    const lockedAt = this.locks.get(key);
    if (lockedAt === undefined || now - lockedAt > leaseMs) {
      this.locks.set(key, now);
      return true;
    }
    return false;
  }
  async releaseLock(key: string): Promise<void> {
    this.locks.delete(key);
  }
}

const OPTS = { ttlMs: 60_000, staleTtlMs: 600_000, lockLeaseMs: 30_000 };

describe("getOrFetchShared", () => {
  it("returns the fresh value from the store without calling the fetcher", async () => {
    const store = new FakeStore();
    store.records.set("k", { value: ["fresh"], updatedAt: 1_000 });
    const fetcher = jest.fn(async () => ["new"]);

    const result = await getOrFetchShared("k", fetcher, store, { ...OPTS, now: () => 1_500 });

    expect(result.data).toEqual(["fresh"]);
    expect(result.source).toBe("fresh");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fetches and stores when no record exists", async () => {
    const store = new FakeStore();
    const fetcher = jest.fn(async () => ["fetched"]);

    const result = await getOrFetchShared("k", fetcher, store, { ...OPTS, now: () => 1_000 });

    expect(result.data).toEqual(["fetched"]);
    expect(result.source).toBe("fetched");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.records.get("k")).toEqual({ value: ["fetched"], updatedAt: 1_000 });
    expect(store.locks.has("k")).toBe(false); // lock released
  });

  it("returns stale value and refreshes in the background when past ttl but within staleTtl", async () => {
    const store = new FakeStore();
    store.records.set("k", { value: ["old"], updatedAt: 0 });
    const fetcher = jest.fn(async () => ["refreshed"]);

    // age = 90s > ttl(60s) but < staleTtl(600s)
    const result = await getOrFetchShared("k", fetcher, store, { ...OPTS, now: () => 90_000 });

    expect(result.data).toEqual(["old"]); // served immediately
    expect(result.source).toBe("stale");

    await flushBackgroundRefreshes();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.records.get("k")).toEqual({ value: ["refreshed"], updatedAt: 90_000 });
  });

  it("serves the last-good value when the fetcher throws and a record exists", async () => {
    const store = new FakeStore();
    store.records.set("k", { value: ["lastgood"], updatedAt: 0 });
    const fetcher = jest.fn(async () => {
      throw new Error("HubSpot rate limited");
    });

    // age way past staleTtl -> would normally fetch synchronously, but fetch fails
    const result = await getOrFetchShared("k", fetcher, store, { ...OPTS, now: () => 10_000_000 });

    expect(result.data).toEqual(["lastgood"]);
    expect(result.source).toBe("stale");
    expect(store.locks.has("k")).toBe(false); // lock released even on error
  });

  it("throws when the fetcher fails and there is no prior value", async () => {
    const store = new FakeStore();
    const fetcher = jest.fn(async () => {
      throw new Error("HubSpot rate limited");
    });

    await expect(
      getOrFetchShared("k", fetcher, store, { ...OPTS, now: () => 1_000 })
    ).rejects.toThrow("HubSpot rate limited");
    expect(store.locks.has("k")).toBe(false);
  });

  it("does not call the fetcher when another instance holds the lock and a record exists (single-flight)", async () => {
    const store = new FakeStore();
    store.records.set("k", { value: ["old"], updatedAt: 0 });
    store.locks.set("k", 9_999_000); // another instance holds a fresh lock
    const fetcher = jest.fn(async () => ["refreshed"]);

    // expired record (age > staleTtl) but lock is held -> serve stale, don't pile on
    const result = await getOrFetchShared("k", fetcher, store, { ...OPTS, now: () => 10_000_000 });

    expect(result.data).toEqual(["old"]);
    expect(result.source).toBe("stale");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
