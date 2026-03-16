import { GET } from "@/app/api/catalog/vendors/route";
import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  prisma: {
    vendorLookup: { findMany: jest.fn() },
  },
}));

function makeRequest(params = "") {
  return new NextRequest(`http://localhost/api/catalog/vendors${params}`);
}

describe("GET /api/catalog/vendors", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns active vendors sorted by name", async () => {
    (prisma.vendorLookup.findMany as jest.Mock).mockResolvedValue([
      { zohoVendorId: "z1", name: "BayWa r.e." },
      { zohoVendorId: "z2", name: "Rell Power" },
    ]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vendors).toEqual([
      { zohoVendorId: "z1", name: "BayWa r.e." },
      { zohoVendorId: "z2", name: "Rell Power" },
    ]);
    expect(prisma.vendorLookup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
        orderBy: { name: "asc" },
      })
    );
  });

  it("includes inactive vendor when includeId is specified", async () => {
    (prisma.vendorLookup.findMany as jest.Mock).mockResolvedValue([
      { zohoVendorId: "z1", name: "Active Vendor" },
      { zohoVendorId: "z-inactive", name: "Old Vendor" },
    ]);

    const res = await GET(makeRequest("?includeId=z-inactive"));
    expect(res.status).toBe(200);

    // Should query with OR condition including the specific ID
    expect(prisma.vendorLookup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { isActive: true },
            { zohoVendorId: "z-inactive" },
          ],
        },
      })
    );
  });
});
