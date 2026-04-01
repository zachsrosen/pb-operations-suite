const mockInternalFindFirst = jest.fn();
const mockInternalFindMany = jest.fn();
const mockInternalUpdate = jest.fn();
const mockInternalCreate = jest.fn();
const mockPendingFindFirst = jest.fn();
const mockPendingCreate = jest.fn();
const mockPendingUpdate = jest.fn();
const mockGetItemsForMatching = jest.fn();
const mockFindItemIdByName = jest.fn();
const mockNotifyAdmins = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    internalProduct: {
      findFirst: (...args: unknown[]) => mockInternalFindFirst(...args),
      findMany: (...args: unknown[]) => mockInternalFindMany(...args),
      update: (...args: unknown[]) => mockInternalUpdate(...args),
      create: (...args: unknown[]) => mockInternalCreate(...args),
    },
    pendingCatalogPush: {
      findFirst: (...args: unknown[]) => mockPendingFindFirst(...args),
      create: (...args: unknown[]) => mockPendingCreate(...args),
      update: (...args: unknown[]) => mockPendingUpdate(...args),
    },
  },
  logActivity: jest.fn(),
}));

jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    getItemsForMatching: (...args: unknown[]) => mockGetItemsForMatching(...args),
    findItemIdByName: (...args: unknown[]) => mockFindItemIdByName(...args),
  },
}));

jest.mock("@/lib/catalog-notify", () => ({
  notifyAdminsOfNewCatalogRequest: (...args: unknown[]) => mockNotifyAdmins(...args),
}));

import { syncInternalProducts } from "@/lib/bom-snapshot";

describe("bom-snapshot internal product matching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItemsForMatching.mockResolvedValue([]);
    mockFindItemIdByName.mockResolvedValue(null);
  });

  it("auto-links a unique Powerwall family match instead of creating a pending push", async () => {
    mockInternalFindFirst.mockResolvedValueOnce(null);
    mockInternalFindMany.mockResolvedValueOnce([
      {
        id: "sku_pw3",
        model: "1707000-21-K",
        canonicalKey: "BATTERY|tesla|170700021k",
      },
    ]);

    const result = await syncInternalProducts([
      {
        category: "BATTERY",
        brand: "Tesla",
        model: "1707000-XX-Y",
        description: "Tesla Powerwall 3",
        qty: 1,
      },
    ]);

    expect(result).toMatchObject({
      created: 0,
      updated: 1,
      pending: 0,
      zohoMatched: 0,
      items: [
        {
          category: "BATTERY",
          brand: "Tesla",
          model: "1707000-XX-Y",
          matchSource: "internal",
          internalProductId: "sku_pw3",
          action: "matched",
        },
      ],
    });
    expect(mockPendingCreate).not.toHaveBeenCalled();
  });

  it("queues an ambiguous family match with candidate SKU ids for review", async () => {
    mockInternalFindFirst.mockResolvedValueOnce(null);
    mockInternalFindMany.mockResolvedValueOnce([
      {
        id: "sku_pw3_a",
        model: "1707000-21-K",
        canonicalKey: "BATTERY|tesla|170700021k",
      },
      {
        id: "sku_pw3_b",
        model: "1707000-24-A",
        canonicalKey: "BATTERY|tesla|170700024a",
      },
    ]);
    mockPendingFindFirst.mockResolvedValueOnce(null);
    mockPendingCreate.mockResolvedValueOnce({
      id: "push_pw3_ambiguous",
      candidateSkuIds: ["sku_pw3_a", "sku_pw3_b"],
    });

    const result = await syncInternalProducts([
      {
        category: "BATTERY",
        brand: "Tesla",
        model: "1707000-XX-Y",
        description: "Tesla Powerwall 3",
        qty: 1,
      },
    ]);

    expect(result).toMatchObject({
      created: 0,
      updated: 0,
      pending: 1,
      zohoMatched: 0,
      items: [
        {
          category: "BATTERY",
          brand: "Tesla",
          model: "1707000-XX-Y",
          matchSource: "pending",
          pendingPushId: "push_pw3_ambiguous",
          action: "queued_pending",
        },
      ],
    });

    expect(mockPendingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          canonicalKey: "BATTERY|tesla|1707000xxy",
          reviewReason: "ambiguous_family_match",
          candidateSkuIds: ["sku_pw3_a", "sku_pw3_b"],
        }),
      })
    );
  });
});
