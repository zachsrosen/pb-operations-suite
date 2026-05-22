import { computePortalUrl } from "@/lib/tesla-powerhub";
import {
  parseSteDateFromName,
  pickPrimarySite,
  resolvePrimarySite,
  pushToHubSpotForProperty,
  enqueueCrossSystemPush,
  buildDeviceSummary,
} from "@/lib/powerhub-crosslink";
import { prisma } from "@/lib/db";
import { updateDealProperty } from "@/lib/hubspot";
import { updateTicketProperties } from "@/lib/hubspot-tickets";
import { updateProperty as updateHubSpotProperty } from "@/lib/hubspot-property";

jest.mock("@/lib/db", () => ({
  prisma: {
    powerhubSite: { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    hubSpotPropertyCache: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/hubspot", () => ({
  updateDealProperty: jest.fn().mockResolvedValue(true),
}));
jest.mock("@/lib/hubspot-tickets", () => ({
  updateTicketProperties: jest.fn().mockResolvedValue(true),
}));
jest.mock("@/lib/hubspot-property", () => ({
  updateProperty: jest.fn().mockResolvedValue(undefined),
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe("computePortalUrl", () => {
  // Capture per-test, not at module load — protects against ordering with
  // sibling tests that also mutate this env var.
  let savedTemplate: string | undefined;
  beforeEach(() => {
    savedTemplate = process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE;
  });
  afterEach(() => {
    if (savedTemplate === undefined) {
      delete process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE;
    } else {
      process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE = savedTemplate;
    }
  });

  it("uses the default template when env var is unset", () => {
    delete process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE;
    expect(computePortalUrl("abc-123")).toBe("https://gridlogic.tesla.com/sites/abc-123");
  });

  it("uses the configured template when env var is set", () => {
    process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE = "https://example.com/site/{siteId}/view";
    expect(computePortalUrl("xyz-789")).toBe("https://example.com/site/xyz-789/view");
  });

  it("returns null for empty siteId", () => {
    expect(computePortalUrl("")).toBeNull();
  });

  it("returns null for whitespace-only siteId", () => {
    expect(computePortalUrl("   ")).toBeNull();
  });

  it("encodes special characters safely", () => {
    // Tesla site UUIDs are alphanumeric+dashes but be defensive
    expect(computePortalUrl("a b/c")).toBe("https://gridlogic.tesla.com/sites/a%20b%2Fc");
  });
});

describe("parseSteDateFromName", () => {
  it("parses standard STE pattern STE20240105-008", () => {
    expect(parseSteDateFromName("STE20240105-008")).toEqual(new Date("2024-01-05T00:00:00Z"));
  });

  it("returns null for non-STE names", () => {
    expect(parseSteDateFromName("PB-Custom-001")).toBeNull();
    expect(parseSteDateFromName("")).toBeNull();
  });

  it("returns null for malformed STE (bad date)", () => {
    expect(parseSteDateFromName("STE20240230-001")).toBeNull(); // Feb 30
    expect(parseSteDateFromName("STE99999999-001")).toBeNull();
  });
});

describe("pickPrimarySite", () => {
  type S = { id: string; siteName: string; createdAt: Date; totalGateways: number; totalBatteries: number; totalInverters: number };
  const mk = (id: string, siteName: string, createdAt: string, equipment?: { gw?: number; bat?: number; inv?: number }): S => ({
    id, siteName, createdAt: new Date(createdAt),
    totalGateways: equipment?.gw ?? 0,
    totalBatteries: equipment?.bat ?? 0,
    totalInverters: equipment?.inv ?? 0,
  });

  it("returns null for empty array", () => {
    expect(pickPrimarySite([])).toBeNull();
  });

  it("returns the only site when there's one", () => {
    const sites = [mk("a", "STE20240105-008", "2024-01-10")];
    expect(pickPrimarySite(sites)?.id).toBe("a");
  });

  it("prefers site with equipment over newer STE site without", () => {
    const sites = [
      mk("a", "STE20240315-001", "2024-03-15"), // newest STE but no equipment
      mk("b", "STE20231201-002", "2023-12-01", { gw: 1, bat: 3 }), // older STE but has equipment
      mk("c", "STE20231105-003", "2023-11-05"), // no equipment
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b");
  });

  it("still picks newest STE when multiple sites have equipment", () => {
    const sites = [
      mk("a", "STE20230101-001", "2023-01-10", { gw: 1, bat: 2 }),
      mk("b", "STE20240105-008", "2024-01-10", { gw: 1, bat: 3, inv: 1 }),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b");
  });

  it("picks newest STE date", () => {
    const sites = [
      mk("a", "STE20230101-001", "2023-01-10"),
      mk("b", "STE20240105-008", "2024-01-10"),
      mk("c", "STE20220601-002", "2022-06-15"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b");
  });

  it("tie-breaks lexicographically on siteName when STE dates tie", () => {
    const sites = [
      mk("a", "STE20240105-005", "2024-01-10"),
      mk("b", "STE20240105-008", "2024-01-10"),
      mk("c", "STE20240105-003", "2024-01-10"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b"); // 008 sorts last
  });

  it("falls back to createdAt when STE pattern is missing", () => {
    const sites = [
      mk("a", "Custom-A", "2024-01-10"),
      mk("b", "Custom-B", "2024-05-10"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b");
  });

  it("STE-named sites beat fallback-named sites", () => {
    const sites = [
      mk("a", "Custom-A", "2024-06-01"),
      mk("b", "STE20230101-001", "2023-01-10"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b"); // STE wins even if older createdAt
  });

  it("final tie-break is id (lexicographic)", () => {
    const sites = [
      mk("c", "Custom-X", "2024-01-10"),
      mk("a", "Custom-X", "2024-01-10"),
      mk("b", "Custom-X", "2024-01-10"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("c"); // lexicographic max
  });
});

describe("resolvePrimarySite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null and clears cache when no sites are linked", async () => {
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([]);

    const result = await resolvePrimarySite("prop-1");

    expect(result).toBeNull();
    expect(mockPrisma.hubSpotPropertyCache.updateMany).toHaveBeenCalledWith({
      where: { id: "prop-1" },
      data: expect.objectContaining({ teslaPortalUrl: null, teslaSiteId: null }),
    });
    expect(mockPrisma.powerhubSite.updateMany).not.toHaveBeenCalled();
  });

  it("picks newest STE site and writes denormalized fields", async () => {
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", siteId: "tesla-old", siteName: "STE20230101-001", createdAt: new Date("2023-01-01"), portalUrl: "https://gridlogic.tesla.com/sites/tesla-old", primaryForProperty: false, totalGateways: 1, totalBatteries: 2, totalInverters: 0 },
      { id: "s2", siteId: "tesla-new", siteName: "STE20240105-008", createdAt: new Date("2024-01-05"), portalUrl: "https://gridlogic.tesla.com/sites/tesla-new", primaryForProperty: false, totalGateways: 1, totalBatteries: 3, totalInverters: 1 },
    ]);

    const result = await resolvePrimarySite("prop-1");

    expect(result?.id).toBe("s2");
    expect(mockPrisma.hubSpotPropertyCache.updateMany).toHaveBeenCalledWith({
      where: { id: "prop-1" },
      data: expect.objectContaining({
        teslaPortalUrl: "https://gridlogic.tesla.com/sites/tesla-new",
        teslaSiteId: "tesla-new",
      }),
    });
    // Demote losers, promote winner
    expect(mockPrisma.powerhubSite.updateMany).toHaveBeenCalledWith({
      where: { propertyId: "prop-1", id: { not: "s2" } },
      data: { primaryForProperty: false },
    });
    expect(mockPrisma.powerhubSite.update).toHaveBeenCalledWith({
      where: { id: "s2" },
      data: { primaryForProperty: true },
    });
  });

  it("no-ops when the chosen primary is already marked", async () => {
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", siteId: "tesla-1", siteName: "STE20240101-001", createdAt: new Date(), portalUrl: "https://x", primaryForProperty: true, totalGateways: 1, totalBatteries: 0, totalInverters: 0 },
    ]);
    (mockPrisma.hubSpotPropertyCache.update as jest.Mock).mockResolvedValue({});

    const result = await resolvePrimarySite("prop-1");

    expect(result?.id).toBe("s1");
    expect(mockPrisma.powerhubSite.update).toHaveBeenCalled();
  });

  it("retries on P2002 from the partial unique index", async () => {
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", siteId: "tesla-1", siteName: "STE20240101-001", createdAt: new Date(), portalUrl: "https://x", primaryForProperty: false, totalGateways: 1, totalBatteries: 0, totalInverters: 0 },
    ]);
    const p2002 = Object.assign(new Error("Unique violation"), { code: "P2002" });
    (mockPrisma.powerhubSite.update as jest.Mock)
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({});

    const result = await resolvePrimarySite("prop-1");

    expect(result?.id).toBe("s1");
    expect(mockPrisma.powerhubSite.update).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxAttempts P2002 errors and throws", async () => {
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", siteId: "tesla-1", siteName: "STE20240101-001", createdAt: new Date(), portalUrl: "https://x", primaryForProperty: false, totalGateways: 1, totalBatteries: 0, totalInverters: 0 },
    ]);
    const p2002 = Object.assign(new Error("Unique violation"), { code: "P2002" });
    (mockPrisma.powerhubSite.update as jest.Mock).mockRejectedValue(p2002);

    await expect(resolvePrimarySite("prop-1")).rejects.toThrow();
    expect(mockPrisma.powerhubSite.update).toHaveBeenCalledTimes(3); // maxAttempts = 3
  });
});

describe("pushToHubSpotForProperty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POWERHUB_CROSSLINK_ENABLED = "true";
  });

  it("no-ops when feature flag is off", async () => {
    process.env.POWERHUB_CROSSLINK_ENABLED = "false";

    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      hubspotObjectId: "hs-prop-1",
      teslaPortalUrl: "https://x",
      teslaSiteId: "abc",
      dealLinks: [{ dealId: "deal-1" }],
      ticketLinks: [{ ticketId: "ticket-1" }],
    });

    await pushToHubSpotForProperty("prop-1");

    expect(updateHubSpotProperty).not.toHaveBeenCalled();
    expect(updateDealProperty).not.toHaveBeenCalled();
    expect(updateTicketProperties).not.toHaveBeenCalled();
  });

  it("pushes to Property, all Deals, and all Tickets when flag is on", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      hubspotObjectId: "hs-prop-1",
      teslaPortalUrl: "https://gridlogic.tesla.com/sites/abc",
      teslaSiteId: "abc",
      dealLinks: [{ dealId: "deal-1" }, { dealId: "deal-2" }],
      ticketLinks: [{ ticketId: "ticket-1" }],
    });

    await pushToHubSpotForProperty("prop-1");

    expect(updateHubSpotProperty).toHaveBeenCalledWith("hs-prop-1", {
      tesla_portal_url: "https://gridlogic.tesla.com/sites/abc",
      tesla_site_id: "abc",
    });
    expect(updateDealProperty).toHaveBeenCalledTimes(2);
    expect(updateDealProperty).toHaveBeenCalledWith("deal-1", {
      tesla_portal_url: "https://gridlogic.tesla.com/sites/abc",
      tesla_site_id: "abc",
    });
    expect(updateTicketProperties).toHaveBeenCalledWith("ticket-1", {
      tesla_portal_url: "https://gridlogic.tesla.com/sites/abc",
      tesla_site_id: "abc",
    });
  });

  it("pushes nulls when teslaPortalUrl is cleared", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      hubspotObjectId: "hs-prop-1",
      teslaPortalUrl: null,
      teslaSiteId: null,
      dealLinks: [{ dealId: "deal-1" }],
      ticketLinks: [],
    });

    await pushToHubSpotForProperty("prop-1");

    expect(updateHubSpotProperty).toHaveBeenCalledWith("hs-prop-1", {
      tesla_portal_url: null,
      tesla_site_id: null,
    });
    expect(updateDealProperty).toHaveBeenCalledWith("deal-1", {
      tesla_portal_url: null,
      tesla_site_id: null,
    });
  });

  it("continues if one deal push fails", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      hubspotObjectId: "hs-prop-1",
      teslaPortalUrl: "https://x",
      teslaSiteId: "abc",
      dealLinks: [{ dealId: "deal-1" }, { dealId: "deal-2" }],
      ticketLinks: [],
    });
    (updateDealProperty as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(pushToHubSpotForProperty("prop-1")).resolves.not.toThrow();
    expect(updateDealProperty).toHaveBeenCalledTimes(2);
  });
});

describe("enqueueCrossSystemPush", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset sticky mock implementations from prior describe blocks
    (mockPrisma.powerhubSite.update as jest.Mock).mockResolvedValue({});
    (mockPrisma.powerhubSite.updateMany as jest.Mock).mockResolvedValue({});
    (mockPrisma.hubSpotPropertyCache.update as jest.Mock).mockResolvedValue({});
    process.env.POWERHUB_CROSSLINK_ENABLED = "true";
  });

  it("no-ops when feature flag is off", async () => {
    process.env.POWERHUB_CROSSLINK_ENABLED = "false";
    await enqueueCrossSystemPush("prop-1");
    expect(mockPrisma.powerhubSite.findMany).not.toHaveBeenCalled();
  });

  it("runs resolve → push → mark dirty in order", async () => {
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", siteId: "tesla-1", siteName: "STE20240105-001", createdAt: new Date(), portalUrl: "https://x", primaryForProperty: false, totalGateways: 1, totalBatteries: 0, totalInverters: 0 },
    ]);
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      hubspotObjectId: "hs-1",
      teslaPortalUrl: "https://x",
      teslaSiteId: "tesla-1",
      dealLinks: [],
      ticketLinks: [],
    });

    await enqueueCrossSystemPush("prop-1");

    expect(mockPrisma.powerhubSite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { propertyId: "prop-1" } })
    );
    expect(mockPrisma.hubSpotPropertyCache.findUnique).toHaveBeenCalled();
    // resolvePrimarySite now uses updateMany (safer when cache row may not exist)
    expect(mockPrisma.hubSpotPropertyCache.updateMany).toHaveBeenCalled();
  });
});

describe("buildDeviceSummary", () => {
  it("preserves raw part number as model and mirrors PW3 serials to powerwall", () => {
    // Tesla reports PW3 units in the gateways bucket — integrated battery+gateway
    const summary = buildDeviceSummary({
      gateways: [
        { serial_number: "TG124271002CS6", part_number: "1707000-11-J" },
      ],
      batteries: [],
    });
    // Model fields hold raw part numbers (variant matters for IRA / warranty)
    expect(summary.gatewayModel).toBe("1707000-11-J");
    expect(summary.powerwallModel).toBe("1707000-11-J");
    expect(summary.gatewaySerial).toBe("TG124271002CS6");
    expect(summary.powerwallSerials).toBe("TG124271002CS6");
    // Formatted display uses friendly product name + part number variant
    expect(summary.formatted).toContain("Powerwall 3: TG124271002CS6 (1707000-11-J");
    expect(summary.formatted).not.toContain("Gateway: TG124271002CS6");
  });

  it("joins all serials for multi-unit Powerwall 3 sites", () => {
    const summary = buildDeviceSummary({
      gateways: [
        { serial_number: "TG124056002MBB", part_number: "1707000-11-J" },
        { serial_number: "TG124055002744", part_number: "1707000-11-J" },
        { serial_number: "TG124056002JMN", part_number: "1707000-11-J" },
      ],
      batteries: [],
    });
    expect(summary.gatewaySerial).toBe("TG124056002MBB");
    expect(summary.powerwallSerials).toBe("TG124056002MBB; TG124055002744; TG124056002JMN");
    expect(summary.gatewayModel).toBe("1707000-11-J");
    expect(summary.powerwallModel).toBe("1707000-11-J");
  });

  it("keeps gateway and battery models distinct for standalone PW2 sites", () => {
    // PW2 site: standalone Backup Gateway 2 + standalone Powerwall 2 batteries
    const summary = buildDeviceSummary({
      gateways: [{ serial_number: "GW001", part_number: "1232100-01-A" }],
      batteries: [
        { serial_number: "BAT001", part_number: "2012170-02-B" },
        { serial_number: "BAT002", part_number: "2012170-02-B" },
      ],
    });
    expect(summary.gatewayModel).toBe("1232100-01-A");
    expect(summary.powerwallModel).toBe("2012170-02-B");
    expect(summary.gatewaySerial).toBe("GW001");
    expect(summary.powerwallSerials).toBe("BAT001; BAT002");
    // Formatted display labels each row with the product name
    expect(summary.formatted).toContain("Gateway: GW001 (1232100-01-A");
    expect(summary.formatted).toContain("Powerwall: BAT001 (2012170-02-B)");
  });

  it("keeps unknown prefixes as raw part numbers", () => {
    const summary = buildDeviceSummary({
      gateways: [{ serial_number: "GW1", part_number: "9999999-XX-X" }],
      batteries: [],
    });
    expect(summary.gatewayModel).toBe("9999999-XX-X");
    // Unknown prefix → not treated as integrated → no mirror
    expect(summary.powerwallModel).toBeNull();
    expect(summary.powerwallSerials).toBeNull();
  });

  it("returns null model fields when devices are empty", () => {
    const summary = buildDeviceSummary({});
    expect(summary.gatewayModel).toBeNull();
    expect(summary.powerwallModel).toBeNull();
    expect(summary.inverterModel).toBeNull();
    expect(summary.meterModel).toBeNull();
  });
});
