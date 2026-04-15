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

import {
  resolveAhjForProperty,
  resolveUtilityForProperty,
  __resetGeoCacheForTests,
} from "@/lib/resolve-geo-links";

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
    __resetGeoCacheForTests();
  });

  it("returns AHJ from an existing deal at the same zip when available", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAHJsForDeal } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([{ hubspotDealId: "d1", zip: "80301" }]);
    fetchAHJsForDeal.mockResolvedValue([{ id: "ahj-boulder", properties: { record_name: "Boulder" } }]);

    const r = await resolveAhjForProperty({ zip: "80301", city: "Boulder", state: "CO" });
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
    const r = await resolveAhjForProperty({ zip: "80301", city: "Boulder", state: "CO" });
    expect(r).toEqual({ objectId: "a1", name: "Boulder County" });
  });

  it("returns null when nothing matches", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAllAHJs } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([]);
    fetchAllAHJs.mockResolvedValue([]);
    expect(await resolveAhjForProperty({ zip: "99999", city: "Nowhere", state: "XX" })).toBeNull();
  });

  it("falls back to closest-zip AHJ when exact-zip and service_area both miss", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAllAHJs, fetchAHJsForDeal } = jest.requireMock("@/lib/hubspot-custom-objects");
    // First call (exact-zip) returns nothing; second call (closest-zip scan) returns same-state deals at varying zips.
    prisma.deal.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { hubspotDealId: "far", zipCode: "80010" },   // distance 291 from 80301
        { hubspotDealId: "near", zipCode: "80305" },  // distance   4 from 80301  ← winner
        { hubspotDealId: "mid", zipCode: "80250" },   // distance  51 from 80301
      ]);
    // service_area strings deliberately don't substring-match "boulder" so Branch 2 misses.
    fetchAllAHJs.mockResolvedValue([
      { id: "a-far", properties: { record_name: "Aurora AHJ", service_area: "Aurora only" } },
      { id: "a-near", properties: { record_name: "Boulder County AHJ", service_area: "Louisville only" } },
      { id: "a-mid", properties: { record_name: "Denver AHJ", service_area: "Denver only" } },
    ]);
    fetchAHJsForDeal.mockImplementation(async (dealId: string) => {
      if (dealId === "far") return [{ id: "a-far", properties: { record_name: "Aurora AHJ" } }];
      if (dealId === "near") return [{ id: "a-near", properties: { record_name: "Boulder County AHJ" } }];
      if (dealId === "mid") return [{ id: "a-mid", properties: { record_name: "Denver AHJ" } }];
      return [];
    });

    const r = await resolveAhjForProperty({ zip: "80301", city: "Boulder", state: "CO" });
    expect(r).toEqual({ objectId: "a-near", name: "Boulder County AHJ" });
  });
});

describe("resolveUtilityForProperty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetGeoCacheForTests();
  });

  it("returns Utility from an existing deal at the same zip when available", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchUtilitiesForDeal } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([{ hubspotDealId: "d1", zip: "80301" }]);
    fetchUtilitiesForDeal.mockResolvedValue([{ id: "util-xcel", properties: { record_name: "Xcel Energy" } }]);
    const r = await resolveUtilityForProperty({ zip: "80301", city: "Boulder", state: "CO" });
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
    const r = await resolveUtilityForProperty({ zip: "80301", city: "Boulder", state: "CO" });
    expect(r).toEqual({ objectId: "u1", name: "Xcel Energy" });
  });

  it("returns null when nothing matches", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAllUtilities } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([]);
    fetchAllUtilities.mockResolvedValue([]);
    expect(await resolveUtilityForProperty({ zip: "99999", city: "Nowhere", state: "XX" })).toBeNull();
  });

  it("falls back to closest-zip Utility when exact-zip and service_area both miss", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAllUtilities, fetchUtilitiesForDeal } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { hubspotDealId: "far", zipCode: "80010" },   // distance 291 from 80301
        { hubspotDealId: "near", zipCode: "80305" },  // distance   4 from 80301  ← winner
        { hubspotDealId: "mid", zipCode: "80250" },   // distance  51 from 80301
      ]);
    fetchAllUtilities.mockResolvedValue([
      { id: "u-far", properties: { record_name: "Aurora Utility", service_area: "Aurora only" } },
      { id: "u-near", properties: { record_name: "Xcel Energy", service_area: "Longmont only" } },
      { id: "u-mid", properties: { record_name: "Denver Utility", service_area: "Denver only" } },
    ]);
    fetchUtilitiesForDeal.mockImplementation(async (dealId: string) => {
      if (dealId === "far") return [{ id: "u-far", properties: { record_name: "Aurora Utility" } }];
      if (dealId === "near") return [{ id: "u-near", properties: { record_name: "Xcel Energy" } }];
      if (dealId === "mid") return [{ id: "u-mid", properties: { record_name: "Denver Utility" } }];
      return [];
    });

    const r = await resolveUtilityForProperty({ zip: "80301", city: "Boulder", state: "CO" });
    expect(r).toEqual({ objectId: "u-near", name: "Xcel Energy" });
  });
});

describe("geo cache (per-process)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetGeoCacheForTests();
  });

  it("resolveAhjForProperty hits HubSpot only once per (state, zip)", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAHJsForDeal } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([{ hubspotDealId: "d1", zipCode: "80301" }]);
    fetchAHJsForDeal.mockResolvedValue([{ id: "ahj-boulder", properties: { record_name: "Boulder" } }]);

    const a = await resolveAhjForProperty({ zip: "80301", city: "Boulder", state: "CO" });
    const b = await resolveAhjForProperty({ zip: "80301", city: "Boulder", state: "CO" });
    const c = await resolveAhjForProperty({ zip: "80301", city: "Different", state: "CO" });

    expect(a).toEqual({ objectId: "ahj-boulder", name: "Boulder" });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    // One call total for the same (state, zip); city differences must not bust.
    expect(fetchAHJsForDeal).toHaveBeenCalledTimes(1);
    expect(prisma.deal.findMany).toHaveBeenCalledTimes(1);
  });

  it("caches negative (null) results so dead zips don't re-fetch", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAllAHJs } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([]);
    fetchAllAHJs.mockResolvedValue([]);

    const a = await resolveAhjForProperty({ zip: "99999", city: "Nowhere", state: "XX" });
    const b = await resolveAhjForProperty({ zip: "99999", city: "Nowhere", state: "XX" });

    expect(a).toBeNull();
    expect(b).toBeNull();
    // fetchAllAHJs is the expensive fallback — must be called once, not twice.
    expect(fetchAllAHJs).toHaveBeenCalledTimes(1);
  });

  it("different (state, zip) combos do NOT share cache entries", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAHJsForDeal } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([{ hubspotDealId: "d1", zipCode: "80301" }]);
    fetchAHJsForDeal.mockResolvedValue([{ id: "ahj-x", properties: { record_name: "X" } }]);

    await resolveAhjForProperty({ zip: "80301", city: "Boulder", state: "CO" });
    await resolveAhjForProperty({ zip: "80302", city: "Boulder", state: "CO" }); // same state, diff zip
    await resolveAhjForProperty({ zip: "80301", city: "Boulder", state: "NM" }); // same zip, diff state

    expect(fetchAHJsForDeal).toHaveBeenCalledTimes(3);
  });

  it("AHJ and Utility caches are independent", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAHJsForDeal, fetchUtilitiesForDeal } = jest.requireMock(
      "@/lib/hubspot-custom-objects",
    );
    prisma.deal.findMany.mockResolvedValue([{ hubspotDealId: "d1", zipCode: "80301" }]);
    fetchAHJsForDeal.mockResolvedValue([{ id: "a1", properties: { record_name: "A" } }]);
    fetchUtilitiesForDeal.mockResolvedValue([{ id: "u1", properties: { record_name: "U" } }]);

    await resolveAhjForProperty({ zip: "80301", city: "Boulder", state: "CO" });
    await resolveUtilityForProperty({ zip: "80301", city: "Boulder", state: "CO" });

    // Caching AHJ doesn't satisfy a Utility lookup.
    expect(fetchAHJsForDeal).toHaveBeenCalledTimes(1);
    expect(fetchUtilitiesForDeal).toHaveBeenCalledTimes(1);
  });
});
