/**
 * Tests for the race-safe create + link-back helper introduced in
 * docs/superpowers/plans/2026-04-24-catalog-sync-quality-hardening.md Task 2.3.
 *
 * The previous implementation used a `updateMany WHERE col IS NULL` guard which
 * silently no-op'd if a concurrent caller wrote first — but only AFTER the
 * external API call had already succeeded, leaving an orphaned external record.
 *
 * The new helper aborts BEFORE calling the external API when the column is
 * already populated, so at most one create call hits the external system.
 */

const mockFindUnique = jest.fn();
const mockUpdateMany = jest.fn();
const mockTransaction = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    internalProduct: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

import { createAndLinkExternal } from "@/lib/catalog-sync";

describe("createAndLinkExternal race-safety", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: $transaction just runs the callback with our mocked tx.
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({
        internalProduct: {
          findUnique: mockFindUnique,
          updateMany: mockUpdateMany,
        },
      });
    });
  });

  it("creates and links when the external ID is null", async () => {
    mockFindUnique.mockResolvedValueOnce({ zohoItemId: null });
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    const doCreate = jest.fn().mockResolvedValue({ externalId: "zoho_new_1" });

    const result = await createAndLinkExternal({
      internalProductId: "sku_1",
      externalIdField: "zohoItemId",
      doCreate,
    });

    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      expect(result.result.externalId).toBe("zoho_new_1");
    }
    expect(doCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "sku_1", zohoItemId: null },
      data: { zohoItemId: "zoho_new_1" },
    });
  });

  it("aborts BEFORE calling doCreate when external ID is already set", async () => {
    // Simulates the second concurrent caller seeing the row already linked.
    mockFindUnique.mockResolvedValueOnce({ zohoItemId: "zoho_existing_1" });
    const doCreate = jest.fn();

    const result = await createAndLinkExternal({
      internalProductId: "sku_1",
      externalIdField: "zohoItemId",
      doCreate,
    });

    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.reason).toMatch(/Another sync linked zohoItemId first/);
    }
    // Critical assertion: the external API was NOT called
    expect(doCreate).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("logs and reports orphan when link-back updateMany affects 0 rows", async () => {
    // Simulates the narrow race window: findUnique sees null, but between the
    // create call and the updateMany, another tx writes the column.
    mockFindUnique.mockResolvedValueOnce({ zohoItemId: null });
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });
    const doCreate = jest.fn().mockResolvedValue({ externalId: "zoho_orphan_1" });
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await createAndLinkExternal({
      internalProductId: "sku_1",
      externalIdField: "zohoItemId",
      doCreate,
    });

    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.reason).toMatch(/orphan/i);
    }
    expect(doCreate).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Race.*zoho_orphan_1.*Orphan/i),
    );
    consoleSpy.mockRestore();
  });

  it("two concurrent creates: only one calls doCreate, the other skips", async () => {
    // Simulate two concurrent sync attempts on the same SKU. The DB row lock
    // serializes the transactions: caller A acquires the lock, finds null,
    // creates externally, writes back. Caller B then acquires the lock, finds
    // the ID already set, and skips WITHOUT calling the external API.
    let linkedZohoId: string | null = null;

    // Shared state mocks: findUnique returns whatever's currently linked,
    // updateMany does a compare-and-swap.
    mockFindUnique.mockImplementation(async () => ({ zohoItemId: linkedZohoId }));
    mockUpdateMany.mockImplementation(async ({ data }: {
      where: { id: string; zohoItemId: null };
      data: { zohoItemId: string };
    }) => {
      if (linkedZohoId === null) {
        linkedZohoId = data.zohoItemId;
        return { count: 1 };
      }
      return { count: 0 };
    });

    const doCreateA = jest.fn().mockImplementation(async () => {
      // Simulate latency on the external API call
      await new Promise((r) => setTimeout(r, 5));
      return { externalId: "zoho_from_A" };
    });
    const doCreateB = jest.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { externalId: "zoho_from_B" };
    });

    // Serialize $transaction calls — Postgres FOR UPDATE row locks would do
    // this for us in production. Here we ensure the second tx waits for the
    // first to fully commit before starting.
    let txChain: Promise<unknown> = Promise.resolve();
    mockTransaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => {
      const next = txChain.then(() =>
        cb({
          internalProduct: {
            findUnique: mockFindUnique,
            updateMany: mockUpdateMany,
          },
        }),
      );
      // Hold the chain on the result, but swallow rejection so a failed tx
      // doesn't poison subsequent ones.
      txChain = next.catch(() => undefined);
      return next;
    });

    const [a, b] = await Promise.all([
      createAndLinkExternal({
        internalProductId: "sku_1",
        externalIdField: "zohoItemId",
        doCreate: doCreateA,
      }),
      createAndLinkExternal({
        internalProductId: "sku_1",
        externalIdField: "zohoItemId",
        doCreate: doCreateB,
      }),
    ]);

    const results = [a, b];
    const created = results.filter((r) => !r.skipped);
    const skipped = results.filter((r) => r.skipped);

    expect(created).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    // Critical assertion: exactly one external API call across both attempts.
    // The previous (buggy) implementation would have made TWO create calls
    // and orphaned the second external record.
    const totalCreateCalls = doCreateA.mock.calls.length + doCreateB.mock.calls.length;
    expect(totalCreateCalls).toBe(1);
    // The skipped one references the "linked first" reason (proactive abort),
    // not the "orphan exists" reason (post-create race).
    if (skipped[0].skipped) {
      expect(skipped[0].reason).toMatch(/Another sync linked/);
    }
    // Final state: linkedZohoId is the externalId from whichever caller won.
    expect(linkedZohoId).toMatch(/^zoho_from_[AB]$/);
  });

  it("works for hubspotProductId field", async () => {
    mockFindUnique.mockResolvedValueOnce({ hubspotProductId: null });
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    const doCreate = jest.fn().mockResolvedValue({ externalId: "hs_123" });

    const result = await createAndLinkExternal({
      internalProductId: "sku_1",
      externalIdField: "hubspotProductId",
      doCreate,
    });

    expect(result.skipped).toBe(false);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "sku_1" },
      select: { hubspotProductId: true },
    });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "sku_1", hubspotProductId: null },
      data: { hubspotProductId: "hs_123" },
    });
  });

  it("works for zuperItemId field", async () => {
    mockFindUnique.mockResolvedValueOnce({ zuperItemId: null });
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });
    const doCreate = jest.fn().mockResolvedValue({ externalId: "zuper_xyz" });

    const result = await createAndLinkExternal({
      internalProductId: "sku_1",
      externalIdField: "zuperItemId",
      doCreate,
    });

    expect(result.skipped).toBe(false);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "sku_1", zuperItemId: null },
      data: { zuperItemId: "zuper_xyz" },
    });
  });
});
