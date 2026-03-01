/**
 * Tests for the fuzzy-match path in syncEquipmentSkus.
 *
 * When CATALOG_LOCKDOWN_ENABLED=true:
 * - Exact canonical match -> use existing SKU
 * - No match -> create PendingCatalogPush
 * - Ambiguous -> create PendingCatalogPush with candidateSkuIds
 */

const mockFindMany = jest.fn();
const mockCreate = jest.fn().mockResolvedValue({ id: "pending_1" });
const mockQueryRawUnsafe = jest.fn().mockResolvedValue([]);

jest.mock("@/lib/db", () => ({
  prisma: {
    equipmentSku: { findMany: mockFindMany },
    pendingCatalogPush: { create: mockCreate },
    $queryRawUnsafe: mockQueryRawUnsafe,
  },
  logActivity: jest.fn(),
}));

import type { BomItem } from "@/lib/bom-snapshot";

describe("syncEquipmentSkus with lockdown", () => {
  const originalEnv = process.env.CATALOG_LOCKDOWN_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CATALOG_LOCKDOWN_ENABLED = "true";
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.CATALOG_LOCKDOWN_ENABLED = originalEnv;
    } else {
      delete process.env.CATALOG_LOCKDOWN_ENABLED;
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
    // Should not create a pending push
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.skipped).toBe(0);
    expect(result.updated).toBe(1);
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
    expect(mockCreate).toHaveBeenCalledWith(
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
    expect(result.created).toBe(1);
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
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewReason: "ambiguous_bom_match",
          candidateSkuIds: ["sku_1", "sku_2"],
        }),
      })
    );
    expect(result.created).toBe(1);
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
    expect(mockCreate).not.toHaveBeenCalled();
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
});
