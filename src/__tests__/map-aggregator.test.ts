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

import { buildInstallMarkers } from "@/lib/map-aggregator";
import type { Project } from "@/lib/hubspot";

describe("buildInstallMarkers", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockLiveGeocode.mockReset();
  });

  const sampleProject = {
    id: 8241,
    name: "Jenkins Residence",
    address: "4820 Gunbarrel Ave",
    city: "Boulder",
    state: "CO",
    postalCode: "80301",
    stage: "Construction Scheduled",
    constructionScheduleDate: "2026-04-23T16:00:00.000Z",
    readyToBuildDate: null,
  } as unknown as Project;

  it("normalizes a scheduled project into a JobMarker", async () => {
    mockFindFirst.mockResolvedValue({ latitude: 40.01, longitude: -105.25 });
    const { markers, unplaced } = await buildInstallMarkers(
      [sampleProject],
      { today: new Date("2026-04-23") }
    );
    expect(unplaced).toHaveLength(0);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: "install:8241",
      kind: "install",
      scheduled: true,
      lat: 40.01,
      lng: -105.25,
      title: "Jenkins Residence",
      dealId: "8241",
    });
    expect(markers[0].scheduledAt).toBeDefined();
  });

  it("marks RTB projects as unscheduled", async () => {
    mockFindFirst.mockResolvedValue({ latitude: 40.01, longitude: -105.25 });
    const rtb = {
      ...sampleProject,
      stage: "Ready to Build",
      constructionScheduleDate: null,
      readyToBuildDate: "2026-04-20T00:00:00.000Z",
    } as unknown as Project;
    const { markers } = await buildInstallMarkers(
      [rtb],
      { today: new Date("2026-04-23") }
    );
    expect(markers[0].scheduled).toBe(false);
    expect(markers[0].scheduledAt).toBeUndefined();
  });

  it("adds to unplaced[] when geocoding fails", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockLiveGeocode.mockResolvedValue(null);
    const { markers, unplaced } = await buildInstallMarkers(
      [sampleProject],
      { today: new Date("2026-04-23") }
    );
    expect(markers).toHaveLength(0);
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0].reason).toBe("geocode-failed");
  });

  it("adds missing-address unplaced entry when fields are empty", async () => {
    const bad = { ...sampleProject, address: "" } as unknown as Project;
    const { markers, unplaced } = await buildInstallMarkers(
      [bad],
      { today: new Date("2026-04-23") }
    );
    expect(markers).toHaveLength(0);
    expect(unplaced[0].reason).toBe("missing-address");
  });
});

import { buildServiceMarkers } from "@/lib/map-aggregator";

describe("buildServiceMarkers", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockLiveGeocode.mockReset();
  });

  const sampleZuperJob = {
    job_uid: "zuper-abc",
    job_title: "Inverter replacement",
    scheduled_start_date_time: "2026-04-23T15:00:00.000Z",
    customer: {
      customer_address: {
        street: "4820 Gunbarrel Ave",
        city: "Boulder",
        state: "CO",
        zip_code: "80301",
      },
    },
    current_job_status: { status_name: "In Progress" },
    assigned_to: [{ user_uid: "user-1" }],
  };

  it("normalizes scheduled Zuper job as scheduled service marker", async () => {
    mockFindFirst.mockResolvedValue({ latitude: 40.01, longitude: -105.25 });
    const { markers } = await buildServiceMarkers(
      [sampleZuperJob as any],
      { today: new Date("2026-04-23") }
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: "zuperjob:zuper-abc",
      kind: "service",
      scheduled: true,
      zuperJobUid: "zuper-abc",
      crewId: "user-1",
    });
  });

  it("drops Zuper job with unresolvable address", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockLiveGeocode.mockResolvedValue(null);
    const { markers, unplaced } = await buildServiceMarkers(
      [sampleZuperJob as any],
      { today: new Date("2026-04-23") }
    );
    expect(markers).toHaveLength(0);
    expect(unplaced).toHaveLength(1);
    expect(unplaced[0].reason).toBe("geocode-failed");
  });

  it("handles Zuper job with missing customer address", async () => {
    const noAddress = { ...sampleZuperJob, customer: {} };
    const { markers, unplaced } = await buildServiceMarkers(
      [noAddress as any],
      { today: new Date("2026-04-23") }
    );
    expect(markers).toHaveLength(0);
    expect(unplaced[0].reason).toBe("missing-address");
  });
});
