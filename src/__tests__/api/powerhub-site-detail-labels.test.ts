jest.mock("@/lib/db", () => ({
  prisma: {
    powerhubSite: { findUnique: jest.fn() },
    propertyDealLink: { findFirst: jest.fn() },
  },
}));
jest.mock("@/lib/powerhub-site-context", () => ({
  resolveDealSummaries: jest.fn(),
  resolveTicketSummaries: jest.fn(),
  resolveContactNames: jest.fn(),
}));

import { GET } from "@/app/api/powerhub/sites/[siteId]/route";
import { prisma } from "@/lib/db";
import {
  resolveDealSummaries,
  resolveTicketSummaries,
  resolveContactNames,
} from "@/lib/powerhub-site-context";

const mockFindUnique = prisma.powerhubSite.findUnique as jest.Mock;
const mockDeals = resolveDealSummaries as jest.Mock;
const mockTickets = resolveTicketSummaries as jest.Mock;
const mockContacts = resolveContactNames as jest.Mock;

function makeSite(overrides: Record<string, unknown> = {}) {
  return {
    siteId: "site-1",
    siteName: "Smith Residence",
    dealId: "123",
    telemetrySnapshot: null,
    alerts: [],
    property: {
      id: "prop-1",
      fullAddress: "123 Main St, Denver, CO",
      contactLinks: [{ contactId: "c1", label: "Current Owner" }],
      ticketLinks: [{ ticketId: "555" }],
    },
    ...overrides,
  };
}

function call() {
  return GET(new Request("http://localhost:3000/api/powerhub/sites/site-1"), {
    params: Promise.resolve({ siteId: "site-1" }),
  });
}

describe("GET /api/powerhub/sites/[siteId] label resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POWERHUB_ENABLED = "true";
    mockDeals.mockResolvedValue(new Map());
    mockTickets.mockResolvedValue(new Map());
    mockContacts.mockResolvedValue(new Map());
  });

  it("returns the live deal name and stage label", async () => {
    mockFindUnique.mockResolvedValue(makeSite());
    mockDeals.mockResolvedValue(
      new Map([["123", { dealName: "Smith, Jane - PROJ-1234", stageLabel: "Ready To Build" }]])
    );

    const body = await (await call()).json();
    expect(body.deal.dealName).toBe("Smith, Jane - PROJ-1234");
    expect(body.deal.stage).toBe("Ready To Build");
  });

  it("attaches ticket subjects and contact names to property links", async () => {
    mockFindUnique.mockResolvedValue(makeSite());
    mockTickets.mockResolvedValue(
      new Map([["555", { subject: "Inverter offline", statusName: "New" }]])
    );
    mockContacts.mockResolvedValue(new Map([["c1", "Jane Smith"]]));

    const body = await (await call()).json();
    expect(body.site.property.ticketLinks[0]).toEqual({
      ticketId: "555",
      subject: "Inverter offline",
      statusName: "New",
    });
    expect(body.site.property.contactLinks[0].name).toBe("Jane Smith");
  });

  it("resolves the deal through PropertyDealLink when the site has no dealId", async () => {
    mockFindUnique.mockResolvedValue(
      makeSite({ dealId: null, propertyId: "prop-1" })
    );
    const mockDealLinkFindFirst = prisma.propertyDealLink.findFirst as jest.Mock;
    mockDealLinkFindFirst.mockResolvedValue({ propertyId: "prop-1", dealId: "555000" });
    mockDeals.mockResolvedValue(
      new Map([["555000", { dealName: "Jones, Bob - PROJ-9999", stageLabel: "PTO" }]])
    );

    const body = await (await call()).json();
    expect(body.deal.dealName).toBe("Jones, Bob - PROJ-9999");
    expect(body.deal.dealId).toBe("555000");
  });

  it("degrades to bare IDs when resolution returns nothing", async () => {
    mockFindUnique.mockResolvedValue(makeSite());

    const body = await (await call()).json();
    expect(body.deal).toBeNull();
    expect(body.site.property.ticketLinks[0].ticketId).toBe("555");
    expect(body.site.property.ticketLinks[0].subject).toBeUndefined();
    expect(body.site.property.contactLinks[0].name).toBeUndefined();
  });
});
