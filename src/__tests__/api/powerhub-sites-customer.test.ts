jest.mock("@/lib/db", () => ({
  prisma: {
    powerhubSite: { findMany: jest.fn() },
    hubSpotProjectCache: { findMany: jest.fn() },
  },
}));

import { GET } from "@/app/api/powerhub/sites/route";
import { prisma } from "@/lib/db";

const mockSiteFindMany = prisma.powerhubSite.findMany as jest.Mock;
const mockDealCacheFindMany = prisma.hubSpotProjectCache.findMany as jest.Mock;

function makeSite(overrides: Record<string, unknown> = {}) {
  return {
    siteId: "site-1",
    siteName: "Smith Residence",
    address: "123 Main St",
    city: "Denver",
    state: "CO",
    status: "ACTIVE",
    linkMethod: "ADDRESS",
    linkConfidence: "HIGH",
    dealId: "9876543210",
    totalGateways: 1,
    totalBatteries: 1,
    totalInverters: 1,
    telemetrySnapshot: null,
    alerts: [],
    ...overrides,
  };
}

describe("GET /api/powerhub/sites deal enrichment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POWERHUB_ENABLED = "true";
  });

  it("attaches customerName and dealName to linked sites that already have an address", async () => {
    mockSiteFindMany.mockResolvedValue([makeSite()]);
    mockDealCacheFindMany.mockResolvedValue([
      {
        dealId: "9876543210",
        dealName: "Smith, Jane - PROJ-1234",
        customerName: "Jane Smith",
        address: "123 Main St",
        city: "Denver",
        state: "CO",
        zipCode: "80202",
      },
    ]);

    const res = await GET(new Request("http://localhost:3000/api/powerhub/sites"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sites[0].customerName).toBe("Jane Smith");
    expect(body.sites[0].dealName).toBe("Smith, Jane - PROJ-1234");
  });

  it("leaves customerName null for unlinked sites", async () => {
    mockSiteFindMany.mockResolvedValue([
      makeSite({ dealId: null, linkMethod: "UNLINKED" }),
    ]);
    mockDealCacheFindMany.mockResolvedValue([]);

    const res = await GET(new Request("http://localhost:3000/api/powerhub/sites"));
    const body = await res.json();

    expect(body.sites[0].customerName).toBeNull();
    expect(body.sites[0].dealName).toBeNull();
  });

  it("still backfills missing site addresses from the deal cache", async () => {
    mockSiteFindMany.mockResolvedValue([makeSite({ address: "" })]);
    mockDealCacheFindMany.mockResolvedValue([
      {
        dealId: "9876543210",
        dealName: "Smith, Jane - PROJ-1234",
        customerName: "Jane Smith",
        address: "123 Main St",
        city: "Denver",
        state: "CO",
        zipCode: "80202",
      },
    ]);

    const res = await GET(new Request("http://localhost:3000/api/powerhub/sites"));
    const body = await res.json();

    expect(body.sites[0].address).toBe("123 Main St");
    expect(body.sites[0].customerName).toBe("Jane Smith");
  });
});
