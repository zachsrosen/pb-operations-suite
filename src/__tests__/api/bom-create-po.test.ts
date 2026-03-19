/**
 * Tests for POST /api/bom/create-po
 */

jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn(async () => ({
    email: "test@photonbrothers.com",
    name: "Test User",
    role: "ADMIN",
    ip: "127.0.0.1",
    userAgent: "jest",
  })),
}));

const mockFindFirst = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    projectBomSnapshot: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
  logActivity: jest.fn(async () => {}),
}));

const mockParseZohoPurchaseOrders = jest.fn();
const mockResolvePoVendorGroups = jest.fn();
const mockMergeUnassignedIntoVendor = jest.fn();
const mockCreatePurchaseOrders = jest.fn();

jest.mock("@/lib/bom-po-create", () => ({
  parseZohoPurchaseOrders: (...args: unknown[]) => mockParseZohoPurchaseOrders(...args),
  resolvePoVendorGroups: (...args: unknown[]) => mockResolvePoVendorGroups(...args),
  mergeUnassignedIntoVendor: (...args: unknown[]) => mockMergeUnassignedIntoVendor(...args),
  createPurchaseOrders: (...args: unknown[]) => mockCreatePurchaseOrders(...args),
}));

const mockListVendors = jest.fn();
jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    isConfigured: () => true,
    listVendors: (...args: unknown[]) => mockListVendors(...args),
  },
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/bom/create-po/route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/bom/create-po", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "snap-1",
    dealId: "deal-123",
    dealName: "PROJ-1234 Smith",
    version: 1,
    zohoPurchaseOrders: null,
    bomData: {
      project: { address: "123 Solar St" },
      items: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParseZohoPurchaseOrders.mockReturnValue([]);
  mockResolvePoVendorGroups.mockResolvedValue({
    vendorGroups: [
      { vendorId: "vendor-1", vendorName: "QCells", items: [{ bomName: "Panel", zohoName: "Panel", zohoItemId: "z1", quantity: 10, description: "Panel" }] },
    ],
    unassignedItems: [],
  });
  mockMergeUnassignedIntoVendor.mockImplementation((grouping) => grouping);
  mockCreatePurchaseOrders.mockResolvedValue({
    created: [{ vendorId: "vendor-1", vendorName: "QCells", poId: "po-1", poNumber: "PO-1", itemCount: 1 }],
    failed: [],
    skippedExisting: [],
  });
  mockListVendors.mockResolvedValue([
    { contact_id: "vendor-2", contact_name: "Fallback Vendor" },
  ]);
});

describe("POST /api/bom/create-po", () => {
  it("requires dealId and version", async () => {
    const response = await POST(makeRequest({ dealId: "deal-123" }));
    expect(response.status).toBe(400);
  });

  it("returns 404 when the snapshot does not exist", async () => {
    mockFindFirst.mockResolvedValue(null);

    const response = await POST(makeRequest({ dealId: "deal-123", version: 1 }));
    expect(response.status).toBe(404);
  });

  it("creates grouped purchase orders and returns the combined list", async () => {
    mockFindFirst.mockResolvedValue(makeSnapshot());

    const response = await POST(makeRequest({ dealId: "deal-123", version: 1 }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolvePoVendorGroups).toHaveBeenCalledTimes(1);
    expect(mockCreatePurchaseOrders).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: "snap-1",
      dealName: "PROJ-1234 Smith",
      version: 1,
    }));
    expect(json.purchaseOrders).toEqual([
      { vendorId: "vendor-1", vendorName: "QCells", poId: "po-1", poNumber: "PO-1", itemCount: 1 },
    ]);
    expect(json.failed).toEqual([]);
  });

  it("merges unassigned items into the selected vendor when unassignedVendorId is provided", async () => {
    mockFindFirst.mockResolvedValue(makeSnapshot());
    mockResolvePoVendorGroups.mockResolvedValue({
      vendorGroups: [],
      unassignedItems: [
        { name: "Wire", quantity: 5, description: "Wire", zohoItemId: "z2", zohoName: "Wire", reason: "no_vendor" },
      ],
    });
    mockMergeUnassignedIntoVendor.mockReturnValue({
      vendorGroups: [
        { vendorId: "vendor-2", vendorName: "Fallback Vendor", items: [{ bomName: "Wire", zohoName: "Wire", zohoItemId: "z2", quantity: 5, description: "Wire" }] },
      ],
      unassignedItems: [],
    });
    mockCreatePurchaseOrders.mockResolvedValue({
      created: [{ vendorId: "vendor-2", vendorName: "Fallback Vendor", poId: "po-2", poNumber: "PO-2", itemCount: 1 }],
      failed: [],
      skippedExisting: [],
    });

    const response = await POST(makeRequest({
      dealId: "deal-123",
      version: 1,
      unassignedVendorId: "vendor-2",
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockListVendors).toHaveBeenCalledTimes(1);
    expect(mockMergeUnassignedIntoVendor).toHaveBeenCalledWith(
      expect.objectContaining({ unassignedItems: expect.any(Array) }),
      "vendor-2",
      "Fallback Vendor",
    );
    expect(json.purchaseOrders).toEqual([
      { vendorId: "vendor-2", vendorName: "Fallback Vendor", poId: "po-2", poNumber: "PO-2", itemCount: 1 },
    ]);
  });
});
