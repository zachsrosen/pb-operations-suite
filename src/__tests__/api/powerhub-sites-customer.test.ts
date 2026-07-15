jest.mock("@/lib/db", () => ({
  prisma: {
    powerhubSite: { findMany: jest.fn() },
    propertyDealLink: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/powerhub-site-context", () => ({
  resolveDealSummaries: jest.fn(),
}));
jest.mock("@/lib/powerhub-tickets", () => ({
  ...jest.requireActual("@/lib/powerhub-tickets"),
  // Only the HubSpot fetch is mocked; buildSiteTicketsFromDeals stays real so
  // the route's deal → tickets wiring is exercised.
  getOpenTicketsByDeal: jest.fn(),
}));

import { GET } from "@/app/api/powerhub/sites/route";
import { prisma } from "@/lib/db";
import { resolveDealSummaries } from "@/lib/powerhub-site-context";
import { getOpenTicketsByDeal } from "@/lib/powerhub-tickets";

const mockSiteFindMany = prisma.powerhubSite.findMany as jest.Mock;
const mockDealLinkFindMany = prisma.propertyDealLink.findMany as jest.Mock;
const mockResolveDeals = resolveDealSummaries as jest.Mock;
const mockGetOpenTicketsByDeal = getOpenTicketsByDeal as jest.Mock;

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
    propertyId: null,
    totalGateways: 1,
    totalBatteries: 1,
    totalInverters: 1,
    telemetrySnapshot: null,
    alerts: [],
    property: null,
    ...overrides,
  };
}

describe("GET /api/powerhub/sites deal-name enrichment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POWERHUB_ENABLED = "true";
    mockDealLinkFindMany.mockResolvedValue([]);
    mockGetOpenTicketsByDeal.mockResolvedValue({});
    mockResolveDeals.mockResolvedValue(new Map());
  });

  it("attaches the live-resolved deal name for sites with a direct dealId", async () => {
    mockSiteFindMany.mockResolvedValue([makeSite()]);
    mockResolveDeals.mockResolvedValue(
      new Map([
        ["9876543210", { dealName: "Smith, Jane - PROJ-1234", stageLabel: "Construction" }],
      ])
    );

    const res = await GET(new Request("http://localhost:3000/api/powerhub/sites"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sites[0].dealName).toBe("Smith, Jane - PROJ-1234");
    expect(body.sites[0].resolvedDealId).toBe("9876543210");
  });

  it("resolves the customer through PropertyDealLink for GEO-linked sites without a dealId", async () => {
    // The real fleet: ~2,920 of ~3,120 sites are GEO-linked to a property
    // with NO dealId; only 4 sites have a direct dealId.
    mockSiteFindMany.mockResolvedValue([
      makeSite({
        siteId: "geo-site",
        dealId: null,
        propertyId: "prop-1",
        linkMethod: "GEO",
      }),
    ]);
    mockDealLinkFindMany.mockResolvedValue([
      { propertyId: "prop-1", dealId: "555000" },
    ]);
    mockResolveDeals.mockResolvedValue(
      new Map([["555000", { dealName: "Jones, Bob - PROJ-9999", stageLabel: "PTO" }]])
    );

    const res = await GET(new Request("http://localhost:3000/api/powerhub/sites"));
    const body = await res.json();

    expect(mockResolveDeals).toHaveBeenCalledWith(expect.arrayContaining(["555000"]));
    expect(body.sites[0].dealName).toBe("Jones, Bob - PROJ-9999");
    expect(body.sites[0].resolvedDealId).toBe("555000");
  });

  it("backfills a missing site address from the linked property", async () => {
    mockSiteFindMany.mockResolvedValue([
      makeSite({
        address: "",
        city: "",
        dealId: null,
        propertyId: "prop-1",
        linkMethod: "GEO",
        property: {
          fullAddress: "42 Solar Way, Boulder, CO 80301",
          streetAddress: "42 Solar Way",
          city: "Boulder",
          state: "CO",
        },
      }),
    ]);

    const res = await GET(new Request("http://localhost:3000/api/powerhub/sites"));
    const body = await res.json();

    expect(body.sites[0].address).toBe("42 Solar Way");
    expect(body.sites[0].city).toBe("Boulder");
  });

  it("attaches open tickets via ANY of the property's deals (catches the Polley case)", async () => {
    // A property with two deals; the open ticket hangs off the older sales deal,
    // not the most-recent one — the lossy PropertyTicketLink missed this.
    mockSiteFindMany.mockResolvedValue([
      makeSite({ siteId: "linked", dealId: null, propertyId: "prop-1", linkMethod: "GEO" }),
      makeSite({ siteId: "unlinked", dealId: null, propertyId: null, linkMethod: "UNLINKED" }),
    ]);
    mockDealLinkFindMany.mockResolvedValue([
      { propertyId: "prop-1", dealId: "svc-deal" },   // most recent
      { propertyId: "prop-1", dealId: "sales-deal" }, // older — has the open ticket
    ]);
    mockGetOpenTicketsByDeal.mockResolvedValue({
      "sales-deal": [{ id: "t-open", subject: "Tesla - Solar production limited" }],
    });

    const res = await GET(new Request("http://localhost:3000/api/powerhub/sites"));
    const body = await res.json();

    const linked = body.sites.find((s: { siteId: string }) => s.siteId === "linked");
    const unlinked = body.sites.find((s: { siteId: string }) => s.siteId === "unlinked");
    expect(linked.tickets).toEqual([{ id: "t-open", subject: "Tesla - Solar production limited" }]);
    expect(unlinked.tickets).toEqual([]);
  });

  it("leaves dealName and resolvedDealId null for unlinked sites", async () => {
    mockSiteFindMany.mockResolvedValue([
      makeSite({ dealId: null, propertyId: null, linkMethod: "UNLINKED" }),
    ]);

    const res = await GET(new Request("http://localhost:3000/api/powerhub/sites"));
    const body = await res.json();

    expect(body.sites[0].dealName).toBeNull();
    expect(body.sites[0].resolvedDealId).toBeNull();
  });
});
