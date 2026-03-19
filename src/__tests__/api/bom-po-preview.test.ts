/**
 * Tests for GET /api/bom/po-preview
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

const mockResolvePoVendorGroups = jest.fn();
jest.mock("@/lib/bom-po-create", () => ({
  resolvePoVendorGroups: (...args: unknown[]) => mockResolvePoVendorGroups(...args),
}));

const mockIsConfigured = jest.fn();
jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    isConfigured: () => mockIsConfigured(),
  },
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/bom/po-preview/route";

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
  mockFindFirst.mockResolvedValue({
    id: "snap-1",
    dealId: "deal-123",
    dealName: "PROJ-1234 Smith",
    version: 1,
    bomData: { items: [] },
  });
  mockResolvePoVendorGroups.mockResolvedValue({
    vendorGroups: [],
    unassignedItems: [],
  });
});

describe("GET /api/bom/po-preview", () => {
  it("fails early when Zoho is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    const response = await GET(new NextRequest("http://localhost:3000/api/bom/po-preview?dealId=deal-123&version=1"));
    expect(response.status).toBe(503);
  });

  it("returns the preview grouping for the snapshot", async () => {
    const response = await GET(new NextRequest("http://localhost:3000/api/bom/po-preview?dealId=deal-123&version=1"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolvePoVendorGroups).toHaveBeenCalledTimes(1);
    expect(json).toEqual({ vendorGroups: [], unassignedItems: [] });
  });
});
