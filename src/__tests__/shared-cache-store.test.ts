// When the database is unavailable (prisma null — e.g. DATABASE_URL unset, or
// the migration hasn't been applied yet), the Prisma-backed store must degrade
// to a no-op so the caller falls back to a direct fetch instead of throwing.
jest.mock("@/lib/db", () => ({ prisma: null }));

import { prismaSharedCacheStore } from "@/lib/shared-cache-store";

describe("prismaSharedCacheStore (degraded: no database)", () => {
  it("read returns null", async () => {
    await expect(prismaSharedCacheStore.read("k")).resolves.toBeNull();
  });

  it("write is a no-op that does not throw", async () => {
    await expect(prismaSharedCacheStore.write("k", { a: 1 }, 1000)).resolves.toBeUndefined();
  });

  it("acquireLock returns true so the caller still fetches (no cross-instance lock available)", async () => {
    await expect(prismaSharedCacheStore.acquireLock("k", 1000, 30_000)).resolves.toBe(true);
  });

  it("releaseLock does not throw", async () => {
    await expect(prismaSharedCacheStore.releaseLock("k")).resolves.toBeUndefined();
  });
});
