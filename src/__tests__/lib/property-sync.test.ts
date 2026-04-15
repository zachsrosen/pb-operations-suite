import { onContactAddressChange } from "@/lib/property-sync";

jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    propertyContactLink: { upsert: jest.fn() },
    propertySyncWatermark: { findUnique: jest.fn(), upsert: jest.fn() },
    activityLog: { create: jest.fn() },
  },
}));
jest.mock("@/lib/geocode", () => ({ geocodeAddress: jest.fn() }));
jest.mock("@/lib/hubspot-property", () => ({
  searchPropertyByPlaceId: jest.fn(),
  createProperty: jest.fn(),
  associateProperty: jest.fn(),
  fetchPropertyById: jest.fn(),
}));
jest.mock("@/lib/hubspot", () => ({ fetchContactById: jest.fn() }));
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
