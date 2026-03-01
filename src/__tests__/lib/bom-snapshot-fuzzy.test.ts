/**
 * Tests for the fuzzy-match path in syncEquipmentSkus.
 *
 * When CATALOG_LOCKDOWN_ENABLED=true:
 * - Exact canonical match -> use existing SKU
 * - No match -> create PendingCatalogPush (idempotent)
 * - Ambiguous -> create PendingCatalogPush with candidateSkuIds (idempotent)
 * - Duplicate items in one BOM -> idempotent (no unique constraint violation)
 * - `created` is always 0 (lockdown never creates SKUs); `pending` tracks pushes
 */

const mockFindMany = jest.fn();
const mockPendingCreate = jest.fn().mockResolvedValue({ id: "pending_1" });
const mockPendingFindMany = jest.fn().mockResolvedValue([]);
const mockPendingFindFirst = jest.fn();
const mockPendingUpdate = jest.fn().mockResolvedValue({ id: "pending_1" });
const mockQueryRawUnsafe = jest.fn().mockResolvedValue([]);

jest.mock("@/lib/db", () => ({
  prisma: {
    equipmentSku: { findMany: mockFindMany },
    pendingCatalogPush: {
      create: mockPendingCreate,
      findMany: mockPendingFindMany,
      findFirst: mockPendingFindFirst,
      update: mockPendingUpdate,
    },
    $queryRawUnsafe: mockQueryRawUnsafe,
  },
  logActivity: jest.fn(),
}));

import type { BomItem } from "@/lib/bom-snapshot";

describe("syncEquipmentSkus with lockdown", () => {
  const originalEnv = process.env.CATALOG_LOCKDOWN_ENABLED;
  const originalModeEnv = process.env.CATALOG_LOCKDOWN_MODE;
  const originalCategoryEnv = process.env.CATALOG_LOCKDOWN_CATEGORIES;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CATALOG_LOCKDOWN_ENABLED = "true";
    delete process.env.CATALOG_LOCKDOWN_MODE;
    delete process.env.CATALOG_LOCKDOWN_CATEGORIES;
    mockPendingFindMany.mockResolvedValue([]);
    // Default: no conflict retry lookup needed
    mockPendingFindFirst.mockResolvedValue(null);
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.CATALOG_LOCKDOWN_ENABLED = originalEnv;
    } else {
      delete process.env.CATALOG_LOCKDOWN_ENABLED;
    }
    if (originalModeEnv !== undefined) {
      process.env.CATALOG_LOCKDOWN_MODE = originalModeEnv;
    } else {
      delete process.env.CATALOG_LOCKDOWN_MODE;
    }
    if (originalCategoryEnv !== undefined) {
      process.env.CATALOG_LOCKDOWN_CATEGORIES = originalCategoryEnv;
    } else {
      delete process.env.CATALOG_LOCKDOWN_CATEGORIES;
    }
  });

  it("uses existing SKU when canonical key matches exactly", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "sku_1",
        category: "MODULE",
        canonicalKey: "MODULE|recsolar|alpha405aa",
      },
    ]);

    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      {
        category: "MODULE",
        brand: "REC Solar",
        model: "Alpha 405-AA",
        description: "test",
        qty: 1,
      },
    ];

    const result = await syncEquipmentSkus(items);
    expect(mockPendingCreate).not.toHaveBeenCalled();
    expect(result.skipped).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
    expect(result.pending).toBe(0);
  });

  it("creates PendingCatalogPush when no match found", async () => {
    mockFindMany.mockResolvedValue([]); // no matches

    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      {
        category: "MODULE",
        brand: "NewBrand",
        model: "NewModel",
        description: "test",
        qty: 1,
      },
    ];

    const result = await syncEquipmentSkus(items);
    expect(mockPendingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          brand: "NewBrand",
          model: "NewModel",
          source: "bom_extraction",
          reviewReason: "no_match",
          candidateSkuIds: [],
        }),
      })
    );
    expect(result.created).toBe(0);
    expect(result.pending).toBe(1);
  });

  it("creates PendingCatalogPush with candidateSkuIds for ambiguous match", async () => {
    mockFindMany.mockResolvedValue([
      { id: "sku_1", canonicalKey: "MODULE|acme|panel100" },
      { id: "sku_2", canonicalKey: "MODULE|acme|panel100" },
    ]);

    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      {
        category: "MODULE",
        brand: "Acme",
        model: "Panel 100",
        description: "ambiguous",
        qty: 1,
      },
    ];

    const result = await syncEquipmentSkus(items);
    expect(mockPendingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewReason: "ambiguous_bom_match",
          candidateSkuIds: ["sku_1", "sku_2"],
        }),
      })
    );
    expect(result.created).toBe(0);
    expect(result.pending).toBe(1);
  });

  it("skips items with missing brand/model", async () => {
    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      {
        category: "MODULE",
        brand: null,
        model: "Panel 100",
        description: "no brand",
        qty: 1,
      },
      {
        category: "MODULE",
        brand: "Acme",
        model: null,
        description: "no model",
        qty: 1,
      },
    ];

    const result = await syncEquipmentSkus(items);
    expect(result.skipped).toBe(2);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockPendingCreate).not.toHaveBeenCalled();
  });

  it("skips items with non-inventory categories", async () => {
    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      {
        category: "CONDUIT",
        brand: "Acme",
        model: "C-100",
        description: "not in inventory",
        qty: 1,
      },
    ];

    const result = await syncEquipmentSkus(items);
    expect(result.skipped).toBe(1);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("updates existing pending record instead of creating duplicate (P1 fix)", async () => {
    // First call: no SKU match
    mockFindMany.mockResolvedValue([]);
    mockPendingFindMany.mockResolvedValue([
      {
        id: "existing_pending_1",
        canonicalKey: "MODULE|newbrand|newmodel",
        candidateSkuIds: ["old_candidate"],
      },
    ]);

    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      {
        category: "MODULE",
        brand: "NewBrand",
        model: "NewModel",
        description: "test",
        qty: 1,
      },
    ];

    const result = await syncEquipmentSkus(items);

    // Should NOT create — should update the existing pending record
    expect(mockPendingCreate).not.toHaveBeenCalled();
    expect(mockPendingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing_pending_1" },
        data: expect.objectContaining({
          candidateSkuIds: ["old_candidate"], // merged (old + new empty = old)
          reviewReason: "no_match",
        }),
      })
    );
    expect(result.pending).toBe(1);
    expect(result.created).toBe(0);
  });

  it("handles duplicate items in one BOM without throwing (P1 regression)", async () => {
    // No SKU matches for either occurrence
    mockFindMany.mockResolvedValue([]);

    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      {
        category: "MODULE",
        brand: "Acme",
        model: "Panel 100",
        description: "first occurrence",
        qty: 10,
      },
      {
        category: "MODULE",
        brand: "Acme",
        model: "Panel 100",
        description: "duplicate",
        qty: 10,
      },
    ];

    // Should not throw despite same canonical key appearing twice
    const result = await syncEquipmentSkus(items);

    // First item: create (no existing pending)
    expect(mockPendingCreate).toHaveBeenCalledTimes(1);
    // Second item: update (uses in-memory map after first create)
    expect(mockPendingUpdate).toHaveBeenCalledTimes(1);
    expect(result.pending).toBe(2);
    expect(result.created).toBe(0);
  });

  it("merges candidate IDs from ambiguous match into existing pending record", async () => {
    // Two SKU matches (ambiguous)
    mockFindMany.mockResolvedValue([
      { id: "sku_a", canonicalKey: "MODULE|acme|panel100" },
      { id: "sku_b", canonicalKey: "MODULE|acme|panel100" },
    ]);
    mockPendingFindMany.mockResolvedValue([
      {
        id: "existing_pending_2",
        canonicalKey: "MODULE|acme|panel100",
        candidateSkuIds: ["sku_old"],
      },
    ]);

    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      {
        category: "MODULE",
        brand: "Acme",
        model: "Panel 100",
        description: "ambiguous reprocess",
        qty: 1,
      },
    ];

    await syncEquipmentSkus(items);

    expect(mockPendingCreate).not.toHaveBeenCalled();
    expect(mockPendingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing_pending_2" },
        data: expect.objectContaining({
          // Union of old + new candidates, deduplicated
          candidateSkuIds: expect.arrayContaining(["sku_old", "sku_a", "sku_b"]),
          reviewReason: "ambiguous_bom_match",
        }),
      })
    );
  });

  it("recovers from P2002 race condition via retry-as-update", async () => {
    mockFindMany.mockResolvedValue([]); // no SKU match
    mockPendingFindMany.mockResolvedValue([]);
    mockPendingFindFirst
      // Retry after P2002: now the other request's record exists
      .mockResolvedValueOnce({
        id: "race_winner_pending",
        candidateSkuIds: [],
      });

    // Simulate P2002 unique constraint violation on create
    const p2002 = Object.assign(new Error("Unique constraint"), { code: "P2002" });
    mockPendingCreate.mockRejectedValueOnce(p2002);

    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      {
        category: "MODULE",
        brand: "RaceBrand",
        model: "RaceModel",
        description: "concurrent",
        qty: 1,
      },
    ];

    // Should not throw — P2002 is caught and retried as update
    const result = await syncEquipmentSkus(items);

    expect(mockPendingCreate).toHaveBeenCalledTimes(1); // attempted create
    expect(mockPendingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "race_winner_pending" },
      })
    );
    expect(result.pending).toBe(1);
    expect(result.created).toBe(0);
  });

  it("runs shadow mode without creating pending records", async () => {
    process.env.CATALOG_LOCKDOWN_MODE = "shadow";
    mockFindMany.mockResolvedValue([]);
    mockQueryRawUnsafe.mockResolvedValueOnce([{ xmax: "0" }]);

    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      {
        category: "MODULE",
        brand: "ShadowBrand",
        model: "ShadowModel",
        description: "shadow test",
        qty: 1,
      },
    ];

    const result = await syncEquipmentSkus(items);

    expect(mockQueryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(mockPendingCreate).not.toHaveBeenCalled();
    expect(result.created).toBe(1);
    expect(result.pending).toBe(0);
    expect(result.shadow).toMatchObject({
      evaluated: 1,
      unmatched: 1,
      wouldQueue: 1,
    });
  });

  it("enforces lockdown only for configured categories", async () => {
    process.env.CATALOG_LOCKDOWN_MODE = "enforced";
    process.env.CATALOG_LOCKDOWN_CATEGORIES = "BATTERY";
    mockFindMany.mockResolvedValue([]);
    mockQueryRawUnsafe.mockResolvedValueOnce([{ xmax: "0" }]);

    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      {
        category: "MODULE",
        brand: "LegacyBrand",
        model: "LegacyModel",
        description: "module follows direct path",
        qty: 1,
      },
      {
        category: "BATTERY",
        brand: "LockBrand",
        model: "LockModel",
        description: "battery follows lockdown path",
        qty: 1,
      },
    ];

    const result = await syncEquipmentSkus(items);

    expect(mockQueryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(mockPendingCreate).toHaveBeenCalledTimes(1);
    expect(mockPendingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: "BATTERY" }),
      })
    );
    expect(result.created).toBe(1);
    expect(result.pending).toBe(1);
  });
});
