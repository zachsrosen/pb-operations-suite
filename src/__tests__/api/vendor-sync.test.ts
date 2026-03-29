import { POST } from "@/app/api/catalog/vendors/sync/route";
import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// Mock auth
const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

// Mock Zoho client
const mockListVendors = jest.fn();
jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: { listVendors: (...args: unknown[]) => mockListVendors(...args) },
}));

// Mock Prisma
jest.mock("@/lib/db", () => ({
  prisma: {
    vendorLookup: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/catalog/vendors/sync", {
    method: "POST",
    headers,
  });
}

describe("POST /api/catalog/vendors/sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireApiAuth.mockResolvedValue({ email: "admin@test.com", role: "ADMIN" });
  });

  it("upserts vendors from Zoho and soft-deletes missing ones", async () => {
    mockListVendors.mockResolvedValue([
      { contact_id: "z1", contact_name: "Rell Power" },
      { contact_id: "z2", contact_name: "BayWa r.e." },
    ]);
    (prisma.vendorLookup.findMany as jest.Mock).mockResolvedValue([
      { zohoVendorId: "z1" },
      { zohoVendorId: "z3" }, // z3 no longer in Zoho
    ]);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // Should upsert both vendors
    expect(prisma.vendorLookup.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.vendorLookup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { zohoVendorId: "z1" },
        update: expect.objectContaining({ name: "Rell Power", isActive: true }),
        create: expect.objectContaining({ zohoVendorId: "z1", name: "Rell Power" }),
      })
    );

    // Should soft-delete z3 (missing from Zoho response)
    expect(prisma.vendorLookup.updateMany).toHaveBeenCalledWith({
      where: { zohoVendorId: { in: ["z3"] } },
      data: { isActive: false },
    });
  });

  it("returns 502 when Zoho is unreachable", async () => {
    mockListVendors.mockRejectedValue(new Error("Zoho timeout"));

    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("Zoho");
  });

  it("accepts cron auth via CRON_SECRET header", async () => {
    const origSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";
    mockRequireApiAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    mockListVendors.mockResolvedValue([]);
    (prisma.vendorLookup.findMany as jest.Mock).mockResolvedValue([]);

    const res = await POST(makeRequest({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    process.env.CRON_SECRET = origSecret;
  });

  it("rejects cron request with wrong secret", async () => {
    const origSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";
    mockRequireApiAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const res = await POST(makeRequest({ authorization: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);

    process.env.CRON_SECRET = origSecret;
  });

  it("rejects unauthenticated requests", async () => {
    mockRequireApiAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });
});
