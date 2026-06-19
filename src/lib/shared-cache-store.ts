/**
 * Prisma-backed SharedCacheStore + the two-tier (memory → Postgres → HubSpot)
 * cache helper wired into the hot read paths.
 *
 * The store talks to the SharedCacheEntry table with raw SQL only — no generated
 * model accessor — so it compiles without regenerating the Prisma client and the
 * single-flight lock can use a conditional upsert that the typed API can't express.
 *
 * Every method degrades gracefully: if the database is unavailable or the table
 * does not exist yet (migration not applied), reads return null, the lock is
 * granted (so the caller still fetches), and writes are no-ops. The route then
 * behaves exactly as it did before this layer existed — never worse.
 */
import { prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import {
  getOrFetchShared,
  type SharedCacheStore,
  type SharedCacheRecord,
} from "@/lib/shared-cache";

export const prismaSharedCacheStore: SharedCacheStore = {
  async read(key: string): Promise<SharedCacheRecord | null> {
    if (!prisma) return null;
    try {
      const rows = await prisma.$queryRaw<{ value: unknown; updatedAt: Date }[]>`
        SELECT "value", "updatedAt"
        FROM "SharedCacheEntry"
        WHERE "key" = ${key} AND "value" IS NOT NULL
        LIMIT 1`;
      if (!rows.length) return null;
      return { value: rows[0].value, updatedAt: rows[0].updatedAt.getTime() };
    } catch (err) {
      console.error(`[shared-cache-store] read failed for "${key}":`, err);
      return null;
    }
  },

  async write(key: string, value: unknown, now: number): Promise<void> {
    if (!prisma) return;
    try {
      await prisma.$executeRaw`
        INSERT INTO "SharedCacheEntry" ("key", "value", "updatedAt")
        VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${new Date(now)})
        ON CONFLICT ("key") DO UPDATE
          SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"`;
    } catch (err) {
      console.error(`[shared-cache-store] write failed for "${key}":`, err);
    }
  },

  async acquireLock(key: string, now: number, leaseMs: number): Promise<boolean> {
    if (!prisma) return true; // degrade: caller fetches (no cross-instance lock)
    try {
      const nowTs = new Date(now);
      const cutoff = new Date(now - leaseMs);
      // Claim the row's lock iff it's free or the lease has expired. A cold key
      // inserts a value-less placeholder row purely to hold the lock.
      const affected = await prisma.$executeRaw`
        INSERT INTO "SharedCacheEntry" ("key", "value", "updatedAt", "lockedAt")
        VALUES (${key}, NULL, ${new Date(0)}, ${nowTs})
        ON CONFLICT ("key") DO UPDATE
          SET "lockedAt" = ${nowTs}
          WHERE "SharedCacheEntry"."lockedAt" IS NULL
             OR "SharedCacheEntry"."lockedAt" < ${cutoff}`;
      return affected > 0;
    } catch (err) {
      console.error(`[shared-cache-store] acquireLock failed for "${key}":`, err);
      return true; // degrade: let the caller fetch
    }
  },

  async releaseLock(key: string): Promise<void> {
    if (!prisma) return;
    try {
      await prisma.$executeRaw`
        UPDATE "SharedCacheEntry" SET "lockedAt" = NULL WHERE "key" = ${key}`;
    } catch (err) {
      console.error(`[shared-cache-store] releaseLock failed for "${key}":`, err);
    }
  },
};

// Tunables for the hot HubSpot read paths. Fresh for 2 min; serve last-good for
// up to 20 min on failure; a refresh lease longer than the slowest full fetch.
const HOT_PATH_OPTS = {
  ttlMs: 2 * 60_000,
  staleTtlMs: 20 * 60_000,
  lockLeaseMs: 2 * 60_000,
};

/**
 * Two-tier cache for hot HubSpot read paths. Drop-in replacement for
 * `appCache.getOrFetch` that additionally consults the cross-instance shared
 * store before hitting HubSpot, collapsing the cold-instance fetch herd.
 */
export async function getOrFetchHotPath<T>(
  key: string,
  fetcher: () => Promise<T>,
  forceRefresh = false,
): Promise<{ data: T; cached: boolean; stale: boolean; lastUpdated: string }> {
  return appCache.getOrFetch<T>(
    key,
    () =>
      getOrFetchShared(key, fetcher, prismaSharedCacheStore, {
        ...HOT_PATH_OPTS,
        forceRefresh,
      }).then((r) => r.data),
    forceRefresh,
  );
}
