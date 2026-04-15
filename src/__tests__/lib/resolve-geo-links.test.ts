import { resolvePbLocationFromAddress } from "@/lib/locations";

describe("resolvePbLocationFromAddress", () => {
  it("maps Boulder (80301) to Westminster", () => {
    expect(resolvePbLocationFromAddress("80301", "CO")).toBe("Westminster");
  });
  it("maps Colorado Springs zip to Colorado Springs", () => {
    expect(resolvePbLocationFromAddress("80903", "CO")).toBe("Colorado Springs");
  });
  it("maps a Centennial zip to Centennial", () => {
    expect(resolvePbLocationFromAddress("80112", "CO")).toBe("Centennial");
  });
  it("maps Camarillo zips to Camarillo", () => {
    expect(resolvePbLocationFromAddress("93010", "CA")).toBe("Camarillo");
  });
  it("maps SLO zips to San Luis Obispo", () => {
    expect(resolvePbLocationFromAddress("93401", "CA")).toBe("San Luis Obispo");
  });
  it("returns null for unknown zip+state", () => {
    expect(resolvePbLocationFromAddress("10001", "NY")).toBeNull();
  });
});

import { resolveAhjForProperty, resolveUtilityForProperty } from "@/lib/resolve-geo-links";

jest.mock("@/lib/db", () => ({ prisma: { deal: { findMany: jest.fn() } } }));
jest.mock("@/lib/hubspot-custom-objects", () => ({
  fetchAllAHJs: jest.fn(),
  fetchAllUtilities: jest.fn(),
  fetchAHJsForDeal: jest.fn(),
  fetchUtilitiesForDeal: jest.fn(),
}));

describe("resolveAhjForProperty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns AHJ from an existing deal at the same zip when available", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAHJsForDeal } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([{ hubspotDealId: "d1", zip: "80301" }]);
    fetchAHJsForDeal.mockResolvedValue([{ id: "ahj-boulder", properties: { record_name: "Boulder" } }]);

    const r = await resolveAhjForProperty({ zip: "80301", city: "Boulder", state: "CO", lat: 40, lng: -105 });
    expect(r).toEqual({ objectId: "ahj-boulder", name: "Boulder" });
  });

  it("falls back to service_area substring match", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAllAHJs } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([]);  // both the exact-zip query and the closest-zip query return empty
    fetchAllAHJs.mockResolvedValue([
      { id: "a1", properties: { record_name: "Boulder County", service_area: "Includes Boulder, Longmont, Louisville" } },
      { id: "a2", properties: { record_name: "Denver", service_area: "Denver only" } },
    ]);
    const r = await resolveAhjForProperty({ zip: "80301", city: "Boulder", state: "CO", lat: 40, lng: -105 });
    expect(r).toEqual({ objectId: "a1", name: "Boulder County" });
  });

  it("returns null when nothing matches", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAllAHJs } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([]);
    fetchAllAHJs.mockResolvedValue([]);
    expect(await resolveAhjForProperty({ zip: "99999", city: "Nowhere", state: "XX", lat: 0, lng: 0 })).toBeNull();
  });
});

describe("resolveUtilityForProperty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns Utility from an existing deal at the same zip when available", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchUtilitiesForDeal } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([{ hubspotDealId: "d1", zip: "80301" }]);
    fetchUtilitiesForDeal.mockResolvedValue([{ id: "util-xcel", properties: { record_name: "Xcel Energy" } }]);
    const r = await resolveUtilityForProperty({ zip: "80301", city: "Boulder", state: "CO", lat: 40, lng: -105 });
    expect(r).toEqual({ objectId: "util-xcel", name: "Xcel Energy" });
  });

  it("falls back to service_area substring match", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAllUtilities } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([]);
    fetchAllUtilities.mockResolvedValue([
      { id: "u1", properties: { record_name: "Xcel Energy", service_area: "Boulder, Denver, Longmont" } },
      { id: "u2", properties: { record_name: "Black Hills Energy", service_area: "Pueblo only" } },
    ]);
    const r = await resolveUtilityForProperty({ zip: "80301", city: "Boulder", state: "CO", lat: 40, lng: -105 });
    expect(r).toEqual({ objectId: "u1", name: "Xcel Energy" });
  });

  it("returns null when nothing matches", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAllUtilities } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([]);
    fetchAllUtilities.mockResolvedValue([]);
    expect(await resolveUtilityForProperty({ zip: "99999", city: "Nowhere", state: "XX", lat: 0, lng: 0 })).toBeNull();
  });
});
