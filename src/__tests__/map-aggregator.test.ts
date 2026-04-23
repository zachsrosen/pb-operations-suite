// src/__tests__/map-aggregator.test.ts
import { resolveAddressCoords } from "@/lib/map-aggregator";

// Mock modules
jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: {
      findFirst: jest.fn(),
    },
    crewMember: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/travel-time", () => ({
  geocodeAddress: jest.fn(),
}));

import { prisma } from "@/lib/db";
import { geocodeAddress as liveGeocode } from "@/lib/travel-time";

const mockFindFirst = prisma.hubSpotPropertyCache.findFirst as jest.Mock;
const mockLiveGeocode = liveGeocode as jest.Mock;

describe("resolveAddressCoords", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockLiveGeocode.mockReset();
  });

  const addr = {
    street: "123 Main St",
    city: "Denver",
    state: "CO",
    zip: "80202",
  };

  it("returns cache hit without calling live geocode", async () => {
    mockFindFirst.mockResolvedValue({ latitude: 39.74, longitude: -104.99 });
    const result = await resolveAddressCoords(addr);
    expect(result).toEqual({ lat: 39.74, lng: -104.99, source: "cache" });
    expect(mockLiveGeocode).not.toHaveBeenCalled();
  });

  it("falls back to live geocode on cache miss", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockLiveGeocode.mockResolvedValue({ lat: 39.74, lng: -104.99 });
    const result = await resolveAddressCoords(addr);
    expect(result).toEqual({ lat: 39.74, lng: -104.99, source: "live" });
    expect(mockLiveGeocode).toHaveBeenCalledTimes(1);
  });

  it("returns null when cache miss + live geocode fails", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockLiveGeocode.mockResolvedValue(null);
    const result = await resolveAddressCoords(addr);
    expect(result).toBeNull();
  });

  it("returns null with missing-fields when address is incomplete", async () => {
    const result = await resolveAddressCoords({
      street: "",
      city: "",
      state: "",
      zip: "",
    });
    expect(result).toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockLiveGeocode).not.toHaveBeenCalled();
  });
});
