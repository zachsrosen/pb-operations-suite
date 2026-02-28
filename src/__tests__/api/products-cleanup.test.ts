const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

const mockGetUserByEmail = jest.fn();
const mockFindMany = jest.fn();
const mockEquipmentUpdate = jest.fn();
const mockCatalogDeleteMany = jest.fn();
const mockLogActivity = jest.fn();

jest.mock("@/lib/db", () => ({
  getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
  prisma: {
    equipmentSku: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockEquipmentUpdate(...args),
    },
    catalogProduct: {
      deleteMany: (...args: unknown[]) => mockCatalogDeleteMany(...args),
    },
  },
}));

const mockRunCleanupAdapter = jest.fn();
jest.mock("@/lib/product-cleanup-adapters", () => ({
  CLEANUP_SOURCES: ["hubspot", "zuper", "zoho", "quickbooks"],
  runCleanupAdapter: (...args: unknown[]) => mockRunCleanupAdapter(...args),
}));

import { NextRequest } from "next/server";
import {
  POST,
  createProductCleanupConfirmationToken,
} from "@/app/api/products/cleanup/route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/products/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function signCleanup(ids: string[], actions: {
  internal: "none" | "deactivate";
  links: "none" | "unlink_selected";
  external: "none" | "delete_selected";
  sources: readonly Array<"hubspot" | "zuper" | "zoho" | "quickbooks">;
  deleteCachedProducts?: boolean;
}, issuedAt = Date.now()) {
  const token = createProductCleanupConfirmationToken({
    internalSkuIds: ids,
    actions: {
      ...actions,
      sources: [...actions.sources],
    },
    issuedAt,
  });
  return { token, issuedAt };
}

const baseSku = {
  id: "sku_1",
  isActive: true,
  hubspotProductId: "hs_1",
  zuperItemId: "zu_1",
  zohoItemId: "zo_1",
  quickbooksItemId: "qb_1",
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PRODUCT_CLEANUP_ENABLED = "true";
  process.env.AUTH_TOKEN_SECRET = "cleanup-test-secret";

  mockRequireApiAuth.mockResolvedValue({
    email: "admin@photonbrothers.com",
    role: "ADMIN",
    ip: "127.0.0.1",
    userAgent: "jest",
  });
  mockGetUserByEmail.mockResolvedValue({ role: "ADMIN" });
  mockFindMany.mockResolvedValue([baseSku]);
  mockEquipmentUpdate.mockResolvedValue({ id: "sku_1" });
  mockCatalogDeleteMany.mockResolvedValue({ count: 1 });
  mockLogActivity.mockResolvedValue({ id: "activity_1" });
});

describe("POST /api/products/cleanup", () => {
  it("rejects requests above the 50-SKU batch limit", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `sku_${i + 1}`);
    const actions = {
      internal: "none" as const,
      links: "none" as const,
      external: "none" as const,
      sources: [],
    };
    const confirmation = signCleanup(ids, actions);

    const response = await POST(
      makeRequest({
        internalSkuIds: ids,
        actions,
        confirmation,
      })
    );

    expect(response.status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects invalid confirmation tokens", async () => {
    const actions = {
      internal: "none" as const,
      links: "none" as const,
      external: "none" as const,
      sources: [],
    };

    const response = await POST(
      makeRequest({
        internalSkuIds: ["sku_1"],
        actions,
        confirmation: {
          token: "invalid-token",
          issuedAt: Date.now(),
        },
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(String(payload.error || "").toLowerCase()).toContain("invalid confirmation token");
  });

  it("rejects expired confirmation tokens", async () => {
    const actions = {
      internal: "none" as const,
      links: "none" as const,
      external: "none" as const,
      sources: [],
    };
    const issuedAt = Date.now() - (5 * 60 * 1000 + 10_000);
    const confirmation = signCleanup(["sku_1"], actions, issuedAt);

    const response = await POST(
      makeRequest({
        internalSkuIds: ["sku_1"],
        actions,
        confirmation,
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(String(payload.error || "").toLowerCase()).toContain("expired");
  });

  it("unlink-only flow does not call external adapters", async () => {
    const actions = {
      internal: "none" as const,
      links: "unlink_selected" as const,
      external: "none" as const,
      sources: ["hubspot", "zuper"] as const,
      deleteCachedProducts: false,
    };
    const confirmation = signCleanup(["sku_1"], actions);

    const response = await POST(
      makeRequest({
        internalSkuIds: ["sku_1"],
        actions,
        confirmation,
      })
    );

    expect(response.status).toBe(200);
    expect(mockRunCleanupAdapter).not.toHaveBeenCalled();
    expect(mockEquipmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sku_1" },
        data: expect.objectContaining({
          hubspotProductId: null,
          zuperItemId: null,
        }),
      })
    );
  });

  it("returns partial summary when one external source fails", async () => {
    const actions = {
      internal: "none" as const,
      links: "none" as const,
      external: "delete_selected" as const,
      sources: ["hubspot", "zuper"] as const,
      deleteCachedProducts: false,
    };
    const confirmation = signCleanup(["sku_1"], actions);

    mockRunCleanupAdapter
      .mockResolvedValueOnce({
        source: "hubspot",
        externalId: "hs_1",
        status: "archived",
        message: "archived",
      })
      .mockResolvedValueOnce({
        source: "zuper",
        externalId: "zu_1",
        status: "failed",
        message: "permission denied",
      });

    const response = await POST(
      makeRequest({
        internalSkuIds: ["sku_1"],
        actions,
        confirmation,
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.summary).toEqual({
      total: 1,
      succeeded: 0,
      partial: 1,
      failed: 0,
    });
    expect(payload.results[0].status).toBe("partial");
    expect(payload.results[0].externalBySource.hubspot.status).toBe("archived");
    expect(payload.results[0].externalBySource.zuper.status).toBe("failed");
  });

  it("accepts QuickBooks archived status and cleans matching cache row", async () => {
    const actions = {
      internal: "none" as const,
      links: "none" as const,
      external: "delete_selected" as const,
      sources: ["quickbooks"] as const,
      deleteCachedProducts: true,
    };
    const confirmation = signCleanup(["sku_1"], actions);

    mockRunCleanupAdapter.mockResolvedValueOnce({
      source: "quickbooks",
      externalId: "qb_1",
      status: "archived",
      message: "set inactive",
    });

    const response = await POST(
      makeRequest({
        internalSkuIds: ["sku_1"],
        actions,
        confirmation,
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.results[0].externalBySource.quickbooks.status).toBe("archived");
    expect(payload.summary.succeeded).toBe(1);
    expect(mockCatalogDeleteMany).toHaveBeenCalledWith({
      where: {
        source: "QUICKBOOKS",
        externalId: "qb_1",
      },
    });
  });

  it("skips cache cleanup when external cleanup fails", async () => {
    const actions = {
      internal: "none" as const,
      links: "none" as const,
      external: "delete_selected" as const,
      sources: ["quickbooks"] as const,
      deleteCachedProducts: true,
    };
    const confirmation = signCleanup(["sku_1"], actions);

    mockRunCleanupAdapter.mockResolvedValueOnce({
      source: "quickbooks",
      externalId: "qb_1",
      status: "failed",
      message: "api error",
    });

    const response = await POST(
      makeRequest({
        internalSkuIds: ["sku_1"],
        actions,
        confirmation,
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.results[0].status).toBe("failed");
    expect(mockCatalogDeleteMany).not.toHaveBeenCalled();
  });
});
