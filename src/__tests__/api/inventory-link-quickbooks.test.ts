import { NextRequest, NextResponse } from "next/server";

const mockRequireApiAuth = jest.fn();
const mockSkuFindMany = jest.fn();
const mockSkuUpdate = jest.fn();
const mockCatalogFindMany = jest.fn();

jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

jest.mock("@/lib/db", () => ({
  prisma: {
    equipmentSku: {
      findMany: (...args: unknown[]) => mockSkuFindMany(...args),
      update: (...args: unknown[]) => mockSkuUpdate(...args),
    },
    catalogProduct: {
      findMany: (...args: unknown[]) => mockCatalogFindMany(...args),
    },
  },
}));

import { POST } from "@/app/api/inventory/skus/link-quickbooks/route";

function makeRequest(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost/api/inventory/skus/link-quickbooks", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireApiAuth.mockResolvedValue({ email: "admin@test.com", role: "ADMIN" });
  mockSkuUpdate.mockResolvedValue({ id: "sku_1" });
});

describe("POST /api/inventory/skus/link-quickbooks", () => {
  it("passes through auth failures", async () => {
    mockRequireApiAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockSkuFindMany).not.toHaveBeenCalled();
  });

  it("auto-links by unique SKU match", async () => {
    mockSkuFindMany.mockResolvedValue([
      {
        id: "sku_1",
        category: "MODULE",
        brand: "REC",
        model: "REC-400AA",
        sku: "REC400",
        vendorPartNumber: null,
        quickbooksItemId: null,
      },
    ]);
    mockCatalogFindMany.mockResolvedValue([
      {
        externalId: "qb_item_1",
        name: "REC 400AA",
        normalizedSku: "REC400",
        normalizedName: "rec 400aa",
      },
    ]);

    const res = await POST(makeRequest({ dryRun: false }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.matched).toBe(1);
    expect(data.ambiguous).toBe(0);
    expect(data.noMatch).toBe(0);
    expect(mockSkuUpdate).toHaveBeenCalledWith({
      where: { id: "sku_1" },
      data: { quickbooksItemId: "qb_item_1" },
    });
  });

  it("reports ambiguous matches and does not update", async () => {
    mockSkuFindMany.mockResolvedValue([
      {
        id: "sku_2",
        category: "MODULE",
        brand: "REC",
        model: "REC-400AA",
        sku: null,
        vendorPartNumber: null,
        quickbooksItemId: null,
      },
    ]);
    mockCatalogFindMany.mockResolvedValue([
      {
        externalId: "qb_item_1",
        name: "REC 400AA",
        normalizedSku: null,
        normalizedName: "rec 400aa",
      },
      {
        externalId: "qb_item_2",
        name: "REC-400AA Duplicate",
        normalizedSku: null,
        normalizedName: "rec 400aa",
      },
    ]);

    const res = await POST(makeRequest({ dryRun: false }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.matched).toBe(0);
    expect(data.ambiguous).toBe(1);
    expect(mockSkuUpdate).not.toHaveBeenCalled();
  });
});

