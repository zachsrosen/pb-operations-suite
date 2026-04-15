import {
  onContactAddressChange,
  computePropertyRollups,
  onDealOrTicketCreated,
} from "@/lib/property-sync";

jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    propertyContactLink: { upsert: jest.fn(), findMany: jest.fn() },
    propertyDealLink: { upsert: jest.fn() },
    propertyTicketLink: { upsert: jest.fn() },
    propertySyncWatermark: { findUnique: jest.fn(), upsert: jest.fn() },
    activityLog: { create: jest.fn() },
    deal: { findMany: jest.fn(), findUnique: jest.fn() },
    internalProduct: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/geocode", () => ({ geocodeAddress: jest.fn() }));
jest.mock("@/lib/hubspot-property", () => ({
  searchPropertyByPlaceId: jest.fn(),
  createProperty: jest.fn(),
  associateProperty: jest.fn(),
  fetchPropertyById: jest.fn(),
  updateProperty: jest.fn(),
}));
jest.mock("@/lib/hubspot", () => ({
  fetchContactById: jest.fn(),
  fetchLineItemsForDeals: jest.fn(),
  fetchDealById: jest.fn(),
  fetchTicketById: jest.fn(),
  fetchPrimaryContactId: jest.fn(),
  fetchPrimaryContactIdForTicket: jest.fn(),
}));
jest.mock("@/lib/hubspot-tickets", () => ({
  batchReadTickets: jest.fn(),
  getTicketStageMap: jest.fn(),
}));
jest.mock("@/lib/resolve-geo-links", () => ({
  resolveAhjForProperty: jest.fn(),
  resolveUtilityForProperty: jest.fn(),
}));
jest.mock("@/lib/hubspot-custom-objects", () => ({
  AHJ_OBJECT_TYPE: "2-7957390",
  UTILITY_OBJECT_TYPE: "2-7957429",
  LOCATION_OBJECT_TYPE: "2-50570396",
}));

describe("onContactAddressChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROPERTY_SYNC_ENABLED = "true";
    process.env.HUBSPOT_PROPERTY_CONTACT_ASSOC_CURRENT_OWNER = "42";
  });

  it("skips when coalescing window is hot (< 2s since last sync)", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    prisma.propertySyncWatermark.findUnique.mockResolvedValue({
      contactId: "c1",
      lastSyncAt: new Date(Date.now() - 500),
    });
    const outcome = await onContactAddressChange("c1");
    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toMatch(/coalesc/i);
  });

  it("skips when contact has incomplete address", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchContactById } = jest.requireMock("@/lib/hubspot");
    prisma.propertySyncWatermark.findUnique.mockResolvedValue(null);
    fetchContactById.mockResolvedValue({
      id: "c1",
      properties: { address: "1 A", city: "", state: "CO", zip: "80301" },
    });
    const outcome = await onContactAddressChange("c1");
    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toMatch(/address incomplete/i);
  });

  it("creates a new Property when no cache row exists for the place_id", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchContactById } = jest.requireMock("@/lib/hubspot");
    const { geocodeAddress } = jest.requireMock("@/lib/geocode");
    const { createProperty, associateProperty, searchPropertyByPlaceId } = jest.requireMock(
      "@/lib/hubspot-property",
    );
    const { resolveAhjForProperty, resolveUtilityForProperty } = jest.requireMock(
      "@/lib/resolve-geo-links",
    );

    prisma.propertySyncWatermark.findUnique.mockResolvedValue(null);
    fetchContactById.mockResolvedValue({
      id: "c1",
      properties: { address: "1 A", city: "B", state: "CO", zip: "80301" },
    });
    geocodeAddress.mockResolvedValue({
      placeId: "p1",
      formattedAddress: "1 A, B CO 80301",
      latitude: 40,
      longitude: -105,
      streetNumber: "1",
      route: "A",
      streetAddress: "1 A",
      city: "B",
      state: "CO",
      zip: "80301",
      county: "Boulder",
    });
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue(null);
    searchPropertyByPlaceId.mockResolvedValue(null);
    resolveAhjForProperty.mockResolvedValue({ objectId: "ahj1", name: "Boulder" });
    resolveUtilityForProperty.mockResolvedValue({ objectId: "util1", name: "Xcel" });
    createProperty.mockResolvedValue({ id: "prop-hs-1" });
    prisma.hubSpotPropertyCache.create.mockResolvedValue({ id: "cache-1" });

    const outcome = await onContactAddressChange("c1");

    expect(createProperty).toHaveBeenCalled();
    expect(associateProperty).toHaveBeenCalledWith(
      "prop-hs-1",
      "contacts",
      "c1",
      expect.any(Number),
    );
    expect(prisma.hubSpotPropertyCache.create).toHaveBeenCalled();
    expect(prisma.propertyContactLink.upsert).toHaveBeenCalled();
    expect(prisma.propertySyncWatermark.upsert).toHaveBeenCalled();
    expect(outcome.status).toBe("created");
    expect(outcome.propertyCacheId).toBe("cache-1");
  });

  it("associates to existing Property when place_id is already known", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchContactById } = jest.requireMock("@/lib/hubspot");
    const { geocodeAddress } = jest.requireMock("@/lib/geocode");
    const { associateProperty, createProperty } = jest.requireMock("@/lib/hubspot-property");

    prisma.propertySyncWatermark.findUnique.mockResolvedValue(null);
    fetchContactById.mockResolvedValue({
      id: "c1",
      properties: { address: "1 A", city: "B", state: "CO", zip: "80301" },
    });
    geocodeAddress.mockResolvedValue({
      placeId: "p1",
      latitude: 40,
      longitude: -105,
      city: "B",
      state: "CO",
      zip: "80301",
      formattedAddress: "1 A, B CO 80301",
      streetAddress: "1 A",
      streetNumber: "1",
      route: "A",
      county: "Boulder",
    });
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue({
      id: "cache-1",
      hubspotObjectId: "prop-hs-1",
    });

    const outcome = await onContactAddressChange("c1");

    expect(createProperty).not.toHaveBeenCalled();
    expect(associateProperty).toHaveBeenCalledWith(
      "prop-hs-1",
      "contacts",
      "c1",
      expect.any(Number),
    );
    expect(outcome.status).toBe("associated");
    expect(outcome.propertyCacheId).toBe("cache-1");
  });
});

describe("computePropertyRollups", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROPERTY_SYNC_ENABLED = "true";
  });

  function primeStageMap(stages: Record<string, string>) {
    const { getTicketStageMap } = jest.requireMock("@/lib/hubspot-tickets");
    getTicketStageMap.mockResolvedValue({
      map: stages,
      orderedStageIds: Object.keys(stages),
    });
  }

  it("no-ops when propertyCacheId does not exist", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue(null);
    await computePropertyRollups("missing");
    expect(prisma.hubSpotPropertyCache.update).not.toHaveBeenCalled();
  });

  it("writes zero counts when the property has no deals or tickets", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { updateProperty } = jest.requireMock("@/lib/hubspot-property");
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue({
      id: "cache-1",
      hubspotObjectId: "hs-1",
      dealLinks: [],
      ticketLinks: [],
    });

    await computePropertyRollups("cache-1");

    expect(prisma.hubSpotPropertyCache.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cache-1" },
        data: expect.objectContaining({
          associatedDealsCount: 0,
          associatedTicketsCount: 0,
          openTicketsCount: 0,
          firstInstallDate: null,
          mostRecentInstallDate: null,
          systemSizeKwDc: null,
          hasBattery: false,
          hasEvCharger: false,
          lastServiceDate: null,
          earliestWarrantyExpiry: null,
        }),
      })
    );
    expect(updateProperty).toHaveBeenCalledWith(
      "hs-1",
      expect.objectContaining({
        associated_deals_count: 0,
        associated_tickets_count: 0,
        open_tickets_count: 0,
        has_battery: false,
        has_ev_charger: false,
        system_size_kw_dc: null,
        earliest_warranty_expiry: "",
      })
    );
  });

  it("aggregates install dates from constructionCompleteDate across 3 deals", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchLineItemsForDeals } = jest.requireMock("@/lib/hubspot");
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue({
      id: "cache-1",
      hubspotObjectId: "hs-1",
      dealLinks: [
        { dealId: "d1" },
        { dealId: "d2" },
        { dealId: "d3" },
      ],
      ticketLinks: [],
    });
    prisma.deal.findMany.mockResolvedValue([
      { hubspotDealId: "d1", constructionCompleteDate: new Date("2024-03-01"), closeDate: null, amount: null },
      { hubspotDealId: "d2", constructionCompleteDate: new Date("2022-06-15"), closeDate: null, amount: null },
      { hubspotDealId: "d3", constructionCompleteDate: new Date("2025-01-10"), closeDate: null, amount: null },
    ]);
    fetchLineItemsForDeals.mockResolvedValue([]);

    await computePropertyRollups("cache-1");

    const call = prisma.hubSpotPropertyCache.update.mock.calls[0][0];
    expect(call.data.associatedDealsCount).toBe(3);
    expect(call.data.firstInstallDate?.toISOString().slice(0, 10)).toBe("2022-06-15");
    expect(call.data.mostRecentInstallDate?.toISOString().slice(0, 10)).toBe("2025-01-10");
  });

  it("ignores deals with null constructionCompleteDate for date rollups", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchLineItemsForDeals } = jest.requireMock("@/lib/hubspot");
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue({
      id: "cache-1",
      hubspotObjectId: "hs-1",
      dealLinks: [{ dealId: "d1" }, { dealId: "d2" }],
      ticketLinks: [],
    });
    prisma.deal.findMany.mockResolvedValue([
      { hubspotDealId: "d1", constructionCompleteDate: null, closeDate: null, amount: null },
      { hubspotDealId: "d2", constructionCompleteDate: new Date("2024-01-10"), closeDate: null, amount: null },
    ]);
    fetchLineItemsForDeals.mockResolvedValue([]);

    await computePropertyRollups("cache-1");

    const call = prisma.hubSpotPropertyCache.update.mock.calls[0][0];
    expect(call.data.associatedDealsCount).toBe(2);
    expect(call.data.firstInstallDate?.toISOString().slice(0, 10)).toBe("2024-01-10");
    expect(call.data.mostRecentInstallDate?.toISOString().slice(0, 10)).toBe("2024-01-10");
  });

  it("sums MODULE wattage × quantity / 1000 for systemSizeKwDc", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchLineItemsForDeals } = jest.requireMock("@/lib/hubspot");
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue({
      id: "cache-1",
      hubspotObjectId: "hs-1",
      dealLinks: [{ dealId: "d1" }],
      ticketLinks: [],
    });
    prisma.deal.findMany.mockResolvedValue([
      { hubspotDealId: "d1", constructionCompleteDate: null, closeDate: null, amount: null },
    ]);
    fetchLineItemsForDeals.mockResolvedValue([
      { id: "li1", dealId: "d1", hubspotProductId: "p-mod-a", quantity: 20 },
      { id: "li2", dealId: "d1", hubspotProductId: "p-bos", quantity: 1 },
    ]);
    prisma.internalProduct.findMany.mockResolvedValue([
      {
        id: "ip1",
        category: "MODULE",
        hubspotProductId: "p-mod-a",
        moduleSpec: { wattage: 400 },
      },
      {
        id: "ip2",
        category: "ELECTRICAL_BOS",
        hubspotProductId: "p-bos",
        moduleSpec: null,
      },
    ]);

    await computePropertyRollups("cache-1");

    const call = prisma.hubSpotPropertyCache.update.mock.calls[0][0];
    // 20 * 400W = 8000W → 8 kW
    expect(call.data.systemSizeKwDc).toBe(8);
    expect(call.data.hasBattery).toBe(false);
    expect(call.data.hasEvCharger).toBe(false);
  });

  it("flags hasBattery when a BATTERY or BATTERY_EXPANSION line item is present", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchLineItemsForDeals } = jest.requireMock("@/lib/hubspot");
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue({
      id: "cache-1",
      hubspotObjectId: "hs-1",
      dealLinks: [{ dealId: "d1" }],
      ticketLinks: [],
    });
    prisma.deal.findMany.mockResolvedValue([
      { hubspotDealId: "d1", constructionCompleteDate: null, closeDate: null, amount: null },
    ]);
    fetchLineItemsForDeals.mockResolvedValue([
      { id: "li1", dealId: "d1", hubspotProductId: "p-batt-exp", quantity: 2 },
    ]);
    prisma.internalProduct.findMany.mockResolvedValue([
      {
        id: "ip1",
        category: "BATTERY_EXPANSION",
        hubspotProductId: "p-batt-exp",
        moduleSpec: null,
      },
    ]);

    await computePropertyRollups("cache-1");

    const call = prisma.hubSpotPropertyCache.update.mock.calls[0][0];
    expect(call.data.hasBattery).toBe(true);
    expect(call.data.hasEvCharger).toBe(false);
  });

  it("flags hasEvCharger when an EV_CHARGER line item is present", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchLineItemsForDeals } = jest.requireMock("@/lib/hubspot");
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue({
      id: "cache-1",
      hubspotObjectId: "hs-1",
      dealLinks: [{ dealId: "d1" }],
      ticketLinks: [],
    });
    prisma.deal.findMany.mockResolvedValue([
      { hubspotDealId: "d1", constructionCompleteDate: null, closeDate: null, amount: null },
    ]);
    fetchLineItemsForDeals.mockResolvedValue([
      { id: "li1", dealId: "d1", hubspotProductId: "p-ev", quantity: 1 },
    ]);
    prisma.internalProduct.findMany.mockResolvedValue([
      { id: "ip1", category: "EV_CHARGER", hubspotProductId: "p-ev", moduleSpec: null },
    ]);

    await computePropertyRollups("cache-1");

    const call = prisma.hubSpotPropertyCache.update.mock.calls[0][0];
    expect(call.data.hasEvCharger).toBe(true);
  });

  it("classifies a non-closed ticket stage as open", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { batchReadTickets } = jest.requireMock("@/lib/hubspot-tickets");
    const { fetchLineItemsForDeals } = jest.requireMock("@/lib/hubspot");
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue({
      id: "cache-1",
      hubspotObjectId: "hs-1",
      dealLinks: [],
      ticketLinks: [{ ticketId: "t1" }],
    });
    fetchLineItemsForDeals.mockResolvedValue([]);
    primeStageMap({ s1: "In Progress", s2: "Closed" });
    batchReadTickets.mockResolvedValue([
      {
        id: "t1",
        properties: {
          hs_pipeline_stage: "s1",
          closed_date: null,
          hs_lastmodifieddate: null,
        },
      },
    ]);

    await computePropertyRollups("cache-1");

    const call = prisma.hubSpotPropertyCache.update.mock.calls[0][0];
    expect(call.data.associatedTicketsCount).toBe(1);
    expect(call.data.openTicketsCount).toBe(1);
  });

  it("classifies a closed stage as not open and takes lastServiceDate = max of closed/lastmodified", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { batchReadTickets } = jest.requireMock("@/lib/hubspot-tickets");
    const { fetchLineItemsForDeals } = jest.requireMock("@/lib/hubspot");
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue({
      id: "cache-1",
      hubspotObjectId: "hs-1",
      dealLinks: [],
      ticketLinks: [{ ticketId: "t1" }, { ticketId: "t2" }],
    });
    fetchLineItemsForDeals.mockResolvedValue([]);
    primeStageMap({ s1: "In Progress", s2: "Closed" });
    batchReadTickets.mockResolvedValue([
      {
        id: "t1",
        properties: {
          hs_pipeline_stage: "s2",
          closed_date: "2024-02-01T00:00:00Z",
          hs_lastmodifieddate: "2024-01-01T00:00:00Z",
        },
      },
      {
        id: "t2",
        properties: {
          hs_pipeline_stage: "s2",
          closed_date: "2025-06-10T00:00:00Z",
          hs_lastmodifieddate: "2025-06-11T00:00:00Z",
        },
      },
    ]);

    await computePropertyRollups("cache-1");

    const call = prisma.hubSpotPropertyCache.update.mock.calls[0][0];
    expect(call.data.associatedTicketsCount).toBe(2);
    expect(call.data.openTicketsCount).toBe(0);
    // Max of closed_date across the two tickets is 2025-06-10.
    expect(call.data.lastServiceDate?.toISOString().slice(0, 10)).toBe("2025-06-10");
  });

  it("keeps earliestWarrantyExpiry null in v1 regardless of deal input", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchLineItemsForDeals } = jest.requireMock("@/lib/hubspot");
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue({
      id: "cache-1",
      hubspotObjectId: "hs-1",
      dealLinks: [{ dealId: "d1" }],
      ticketLinks: [],
    });
    prisma.deal.findMany.mockResolvedValue([
      {
        hubspotDealId: "d1",
        constructionCompleteDate: new Date("2024-01-01"),
        closeDate: null,
        amount: null,
      },
    ]);
    fetchLineItemsForDeals.mockResolvedValue([]);

    await computePropertyRollups("cache-1");

    const call = prisma.hubSpotPropertyCache.update.mock.calls[0][0];
    expect(call.data.earliestWarrantyExpiry).toBeNull();
  });
});

describe("onDealOrTicketCreated", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROPERTY_SYNC_ENABLED = "true";
    process.env.HUBSPOT_PROPERTY_CONTACT_ASSOC_CURRENT_OWNER = "42";
  });

  // Skeleton rollup cache row used by computePropertyRollups so the happy-path
  // tests don't need to prime every rollup dependency. We care about the
  // associate/link/log behavior here, not the rollup contents.
  function primeEmptyRollup(propertyCacheId: string, hubspotObjectId: string) {
    const { prisma } = jest.requireMock("@/lib/db");
    const { getTicketStageMap } = jest.requireMock("@/lib/hubspot-tickets");
    const { fetchLineItemsForDeals } = jest.requireMock("@/lib/hubspot");
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue({
      id: propertyCacheId,
      hubspotObjectId,
      dealLinks: [],
      ticketLinks: [],
    });
    prisma.deal.findMany.mockResolvedValue([]);
    fetchLineItemsForDeals.mockResolvedValue([]);
    getTicketStageMap.mockResolvedValue({ map: {}, orderedStageIds: [] });
  }

  it("returns skipped when the feature flag is off", async () => {
    process.env.PROPERTY_SYNC_ENABLED = "false";
    const outcome = await onDealOrTicketCreated("deal", "d1");
    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toMatch(/feature flag/i);
  });

  it("returns deferred when a deal has no primary contact", async () => {
    const { fetchDealById, fetchPrimaryContactId } = jest.requireMock("@/lib/hubspot");
    fetchDealById.mockResolvedValue({ id: "d1", properties: {} });
    fetchPrimaryContactId.mockResolvedValue(null);

    const outcome = await onDealOrTicketCreated("deal", "d1");
    expect(outcome.status).toBe("deferred");
    expect(outcome.reason).toMatch(/no primary contact/i);
  });

  it("associates to the sole existing Property when the contact has exactly one", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchDealById, fetchPrimaryContactId } = jest.requireMock("@/lib/hubspot");
    const { associateProperty } = jest.requireMock("@/lib/hubspot-property");

    fetchDealById.mockResolvedValue({ id: "d1", properties: {} });
    fetchPrimaryContactId.mockResolvedValue("c1");
    prisma.propertyContactLink.findMany.mockResolvedValue([
      { propertyId: "cache-1", contactId: "c1", label: "Current Owner" },
    ]);
    prisma.hubSpotPropertyCache.findMany.mockResolvedValue([
      { id: "cache-1", hubspotObjectId: "prop-hs-1", googlePlaceId: "p1" },
    ]);
    primeEmptyRollup("cache-1", "prop-hs-1");

    const outcome = await onDealOrTicketCreated("deal", "d1");

    expect(associateProperty).toHaveBeenCalledWith("prop-hs-1", "deals", "d1");
    expect(prisma.propertyDealLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { propertyId_dealId: { propertyId: "cache-1", dealId: "d1" } },
        create: { propertyId: "cache-1", dealId: "d1" },
      })
    );
    // Rollup recomputed for the matched property.
    expect(prisma.hubSpotPropertyCache.update).toHaveBeenCalled();
    expect(prisma.activityLog.create).toHaveBeenCalled();
    expect(outcome.status).toBe("associated");
    expect(outcome.propertyCacheId).toBe("cache-1");
  });

  it("disambiguates to the Property whose placeId matches the geocoded deal address", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchDealById, fetchPrimaryContactId } = jest.requireMock("@/lib/hubspot");
    const { geocodeAddress } = jest.requireMock("@/lib/geocode");
    const { associateProperty } = jest.requireMock("@/lib/hubspot-property");

    fetchDealById.mockResolvedValue({
      id: "d1",
      properties: { address: "2 B", city: "B", state: "CO", zip: "80301" },
    });
    fetchPrimaryContactId.mockResolvedValue("c1");
    prisma.propertyContactLink.findMany.mockResolvedValue([
      { propertyId: "cache-1", contactId: "c1", label: "Current Owner" },
      { propertyId: "cache-2", contactId: "c1", label: "Current Owner" },
    ]);
    prisma.hubSpotPropertyCache.findMany.mockResolvedValue([
      { id: "cache-1", hubspotObjectId: "prop-hs-1", googlePlaceId: "p-mismatch" },
      { id: "cache-2", hubspotObjectId: "prop-hs-2", googlePlaceId: "p-match" },
    ]);
    geocodeAddress.mockResolvedValue({ placeId: "p-match", city: "B", state: "CO", zip: "80301" });
    primeEmptyRollup("cache-2", "prop-hs-2");

    const outcome = await onDealOrTicketCreated("deal", "d1");

    expect(associateProperty).toHaveBeenCalledWith("prop-hs-2", "deals", "d1");
    expect(prisma.propertyDealLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { propertyId: "cache-2", dealId: "d1" },
      })
    );
    expect(outcome.status).toBe("associated");
    expect(outcome.propertyCacheId).toBe("cache-2");
  });

  it("returns deferred when multiple properties exist and none match the deal's place_id", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchDealById, fetchPrimaryContactId } = jest.requireMock("@/lib/hubspot");
    const { geocodeAddress } = jest.requireMock("@/lib/geocode");
    const { associateProperty } = jest.requireMock("@/lib/hubspot-property");

    fetchDealById.mockResolvedValue({
      id: "d1",
      properties: { address: "2 B", city: "B", state: "CO", zip: "80301" },
    });
    fetchPrimaryContactId.mockResolvedValue("c1");
    prisma.propertyContactLink.findMany.mockResolvedValue([
      { propertyId: "cache-1", contactId: "c1", label: "Current Owner" },
      { propertyId: "cache-2", contactId: "c1", label: "Current Owner" },
    ]);
    prisma.hubSpotPropertyCache.findMany.mockResolvedValue([
      { id: "cache-1", hubspotObjectId: "prop-hs-1", googlePlaceId: "p-a" },
      { id: "cache-2", hubspotObjectId: "prop-hs-2", googlePlaceId: "p-b" },
    ]);
    geocodeAddress.mockResolvedValue({ placeId: "p-other", city: "B", state: "CO", zip: "80301" });

    const outcome = await onDealOrTicketCreated("deal", "d1");

    expect(associateProperty).not.toHaveBeenCalled();
    expect(prisma.propertyDealLink.upsert).not.toHaveBeenCalled();
    expect(outcome.status).toBe("deferred");
    expect(outcome.reason).toMatch(/ambiguous|no address match/i);
  });

  it("when contact has zero Properties, triggers onContactAddressChange and retries; still zero → deferred", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchDealById, fetchPrimaryContactId, fetchContactById } = jest.requireMock("@/lib/hubspot");
    const { geocodeAddress } = jest.requireMock("@/lib/geocode");

    fetchDealById.mockResolvedValue({ id: "d1", properties: {} });
    fetchPrimaryContactId.mockResolvedValue("c1");
    prisma.propertyContactLink.findMany.mockResolvedValue([]);
    // onContactAddressChange will fetch the contact; simulate incomplete address so
    // the recovery call no-ops (status: "skipped") and Properties stays at 0.
    fetchContactById.mockResolvedValue({ id: "c1", properties: { address: "", city: "", state: "", zip: "" } });
    prisma.propertySyncWatermark.findUnique.mockResolvedValue(null);
    geocodeAddress.mockResolvedValue(null);

    const outcome = await onDealOrTicketCreated("deal", "d1");

    // Recovery attempt fired (fetchContactById got called).
    expect(fetchContactById).toHaveBeenCalled();
    expect(outcome.status).toBe("deferred");
    expect(outcome.reason).toMatch(/no properties/i);
  });

  it("ticket variant with one Property associates with 'tickets' scope", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchTicketById, fetchPrimaryContactIdForTicket } = jest.requireMock("@/lib/hubspot");
    const { associateProperty } = jest.requireMock("@/lib/hubspot-property");

    fetchTicketById.mockResolvedValue({ id: "t1", properties: {} });
    fetchPrimaryContactIdForTicket.mockResolvedValue("c1");
    prisma.propertyContactLink.findMany.mockResolvedValue([
      { propertyId: "cache-1", contactId: "c1", label: "Current Owner" },
    ]);
    prisma.hubSpotPropertyCache.findMany.mockResolvedValue([
      { id: "cache-1", hubspotObjectId: "prop-hs-1", googlePlaceId: "p1" },
    ]);
    primeEmptyRollup("cache-1", "prop-hs-1");

    const outcome = await onDealOrTicketCreated("ticket", "t1");

    expect(associateProperty).toHaveBeenCalledWith("prop-hs-1", "tickets", "t1");
    expect(prisma.propertyTicketLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { propertyId_ticketId: { propertyId: "cache-1", ticketId: "t1" } },
        create: { propertyId: "cache-1", ticketId: "t1" },
      })
    );
    expect(outcome.status).toBe("associated");
    expect(outcome.propertyCacheId).toBe("cache-1");
  });
});
