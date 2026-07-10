jest.mock("@/lib/db", () => ({
  prisma: {
    powerhubSite: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/powerhub-site-context", () => ({
  resolveDealSummaries: jest.fn(),
}));

import { GET } from "@/app/api/powerhub/sites/route";
import { prisma } from "@/lib/db";
import { resolveDealSummaries } from "@/lib/powerhub-site-context";

const mockSiteFindMany = prisma.powerhubSite.findMany as jest.Mock;
const mockResolveDeals = resolveDealSummaries as jest.Mock;

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

describe("GET /api/powerhub/sites live deal-name enrichment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POWERHUB_ENABLED = "true";
  });

  it("attaches the live-resolved deal name to linked sites", async () => {
    mockSiteFindMany.mockResolvedValue([makeSite()]);
    mockResolveDeals.mockResolvedValue(
      new Map([
        ["9876543210", { dealName: "Smith, Jane - PROJ-1234", stageLabel: "Construction" }],
      ])
    );

    const res = await GET(new Request("http://localhost:3000/api/powerhub/sites"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockResolveDeals).toHaveBeenCalledWith(["9876543210"]);
    expect(body.sites[0].dealName).toBe("Smith, Jane - PROJ-1234");
  });

  it("leaves dealName null for unlinked sites and when resolution fails", async () => {
    mockSiteFindMany.mockResolvedValue([
      makeSite({ dealId: null, linkMethod: "UNLINKED" }),
      makeSite({ siteId: "site-2", dealId: "111" }),
    ]);
    mockResolveDeals.mockResolvedValue(new Map());

    const res = await GET(new Request("http://localhost:3000/api/powerhub/sites"));
    const body = await res.json();

    expect(body.sites.every((s: { dealName: string | null }) => s.dealName === null)).toBe(true);
  });
});
