// src/__tests__/map-aggregator.test.ts
import { resolveAddressCoords } from "@/lib/map-aggregator";

// Mock modules
jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    crewMember: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/travel-time", () => ({
  geocodeAddress: jest.fn(),
}));

jest.mock("@/lib/hubspot-tickets", () => ({
  fetchServiceTickets: jest.fn().mockResolvedValue([]),
  resolveTicketAddresses: jest.fn().mockResolvedValue(new Map()),
}));

import { prisma } from "@/lib/db";
import { geocodeAddress as liveGeocode } from "@/lib/travel-time";

const mockFindFirst = prisma.hubSpotPropertyCache.findFirst as jest.Mock;
const mockFindMany = prisma.hubSpotPropertyCache.findMany as jest.Mock;
const mockLiveGeocode = liveGeocode as jest.Mock;

// Helper: convert a `findFirst`-style mock value into a `findMany` row array
// so existing tests can keep using mockFindFirst.mockResolvedValue(...) while
// the batch path gets the same answer for every address.
function mirrorFindFirstIntoFindMany() {
  mockFindMany.mockImplementation(async ({ where }: { where: { OR: Array<{ streetAddress: string; city: string; state: string; zip: string }> } }) => {
    const cached = await mockFindFirst();
    if (!cached) return [];
    // Return one row per OR clause, with the same lat/lng but address copied
    // from the input. Enough to make the batch resolver find each key.
    return where.OR.map((a) => ({
      streetAddress: a.streetAddress,
      city: a.city,
      state: a.state,
      zip: a.zip,
      latitude: cached.latitude,
      longitude: cached.longitude,
    }));
  });
}

describe("resolveAddressCoords", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockFindMany.mockReset();
    mockLiveGeocode.mockReset();
    mirrorFindFirstIntoFindMany();
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
    mockFindMany.mockReset();
    mockLiveGeocode.mockReset();
    mirrorFindFirstIntoFindMany();
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
    mockFindMany.mockReset();
    mockLiveGeocode.mockReset();
    mirrorFindFirstIntoFindMany();
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

import { buildCrewPins } from "@/lib/map-aggregator";
import type { JobMarker } from "@/lib/map-types";

describe("buildCrewPins", () => {
  // Prisma CrewMember fields: `isActive` (not `active`), `locations: String[]` (not `location`)
  const crewMembers = [
    {
      id: "crew-1",
      name: "Alex P.",
      locations: ["dtc"],
      isActive: true,
    },
    {
      id: "crew-2",
      name: "Marco R.",
      locations: ["westy"],
      isActive: true,
    },
  ];

  it("assigns current position from earliest today's stop", () => {
    const markers: JobMarker[] = [
      {
        id: "install:A",
        kind: "install",
        scheduled: true,
        scheduledAt: "2026-04-23T09:00:00Z",
        lat: 39.75,
        lng: -104.99,
        crewId: "crew-1",
        address: { street: "x", city: "x", state: "CO", zip: "0" },
        title: "Stop 1",
      },
      {
        id: "install:B",
        kind: "install",
        scheduled: true,
        scheduledAt: "2026-04-23T15:00:00Z",
        lat: 39.80,
        lng: -104.95,
        crewId: "crew-1",
        address: { street: "x", city: "x", state: "CO", zip: "0" },
        title: "Stop 2",
      },
    ];
    const pins = buildCrewPins(crewMembers as any, markers);
    const alex = pins.find(p => p.id === "crew-1")!;
    expect(alex.working).toBe(true);
    expect(alex.currentLat).toBe(39.75);
    expect(alex.routeStops).toHaveLength(2);
  });

  it("marks crew without today's stops as not working", () => {
    const pins = buildCrewPins(crewMembers as any, []);
    expect(pins.find(p => p.id === "crew-1")?.working).toBe(false);
  });
});

import { aggregateMapMarkers } from "@/lib/map-aggregator";

jest.mock("@/lib/hubspot", () => ({
  fetchAllProjects: jest.fn(),
  // Pass-through: keeps the existing project fixtures visible so tests don't
  // need to spell out every field the real scheduling-context filter reads.
  filterProjectsForContext: jest.fn((projects) => projects),
}));

jest.mock("@/lib/zuper", () => ({
  fetchTodaysServiceJobs: jest.fn(),
}));

import { fetchAllProjects } from "@/lib/hubspot";
import { fetchTodaysServiceJobs } from "@/lib/zuper";

describe("aggregateMapMarkers", () => {
  beforeEach(() => {
    (fetchAllProjects as jest.Mock).mockReset();
    (fetchTodaysServiceJobs as jest.Mock).mockReset();
    (prisma.crewMember.findMany as jest.Mock).mockResolvedValue([]);
    mockFindFirst.mockResolvedValue({ latitude: 40, longitude: -105 });
  });

  it("assembles response with all sources succeeding", async () => {
    (fetchAllProjects as jest.Mock).mockResolvedValue([]);
    (fetchTodaysServiceJobs as jest.Mock).mockResolvedValue([]);
    const res = await aggregateMapMarkers({ mode: "today", types: ["install", "service"] });
    expect(res.markers).toEqual([]);
    expect(res.crews).toEqual([]);
    expect(res.partialFailures ?? []).toEqual([]);
    expect(res.droppedCount).toBe(0);
  });

  it("surfaces partialFailures when one source throws", async () => {
    (fetchAllProjects as jest.Mock).mockRejectedValue(new Error("hubspot down"));
    (fetchTodaysServiceJobs as jest.Mock).mockResolvedValue([]);
    const res = await aggregateMapMarkers({ mode: "today", types: ["install", "service"] });
    expect(res.partialFailures).toEqual(expect.arrayContaining([expect.stringContaining("hubspot")]));
  });

  it("excludes service sources when types filter omits service", async () => {
    (fetchAllProjects as jest.Mock).mockResolvedValue([]);
    const res = await aggregateMapMarkers({ mode: "today", types: ["install"] });
    expect(fetchTodaysServiceJobs).not.toHaveBeenCalled();
    expect(res).toBeDefined();
  });
});

describe("buildServiceMarkers — real Zuper GET shape", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockFindMany.mockReset();
    mockLiveGeocode.mockReset();
    mirrorFindFirstIntoFindMany();
  });

  it("handles top-level customer_address (real API shape)", async () => {
    mockFindFirst.mockResolvedValue({ latitude: 39.75, longitude: -104.99 });
    const { buildServiceMarkers } = await import("@/lib/map-aggregator");
    const realShape = {
      job_uid: "zuper-real",
      job_title: "Inverter replacement",
      scheduled_start_time: "2026-04-23T15:00:00.000Z",
      customer_address: {
        street: "1127 Elder Pl",
        city: "Boulder",
        state: "CO",
        zip_code: "80304",
      },
      current_job_status: { status_name: "In Progress" },
      assigned_to: [{ user: { user_uid: "user-from-get" } }],
    };
    const { markers } = await buildServiceMarkers(
      [realShape as any],
      { today: new Date("2026-04-23") }
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: "zuperjob:zuper-real",
      scheduled: true,
      crewId: "user-from-get",
    });
  });
});

describe("filterProjectsByMode", () => {
  beforeEach(() => {
    (fetchAllProjects as jest.Mock).mockReset();
    (fetchTodaysServiceJobs as jest.Mock).mockResolvedValue([]);
    (prisma.crewMember.findMany as jest.Mock).mockResolvedValue([]);
    mockFindFirst.mockResolvedValue({ latitude: 40, longitude: -105 });
  });

  const baseProject = {
    id: 1,
    name: "Test",
    address: "123 Main",
    city: "Boulder",
    state: "CO",
    postalCode: "80301",
    stage: "",
    isActive: true,
  };

  it("week mode includes projects scheduled within next 7 days", async () => {
    const today = new Date("2026-04-23T00:00:00Z");
    const inWeek = { ...baseProject, id: 1, constructionScheduleDate: "2026-04-26T10:00:00Z", stage: "Scheduled" };
    const beyondWeek = { ...baseProject, id: 2, constructionScheduleDate: "2026-05-15T10:00:00Z", stage: "Scheduled" };
    (fetchAllProjects as jest.Mock).mockResolvedValue([inWeek, beyondWeek]);
    const res = await (await import("@/lib/map-aggregator")).aggregateMapMarkers({
      mode: "week", types: ["install"], date: today,
    });
    const ids = res.markers.map((m) => m.id);
    expect(ids).toContain("install:1");
    expect(ids).not.toContain("install:2");
  });

  it("backlog mode includes pre-construction stages even without scheduled date", async () => {
    const today = new Date("2026-04-23T00:00:00Z");
    const rtb = { ...baseProject, id: 10, stage: "Ready to Build", constructionScheduleDate: null };
    const permit = { ...baseProject, id: 11, stage: "Permitting", constructionScheduleDate: null };
    const early = { ...baseProject, id: 12, stage: "Lead", constructionScheduleDate: null };
    (fetchAllProjects as jest.Mock).mockResolvedValue([rtb, permit, early]);
    const res = await (await import("@/lib/map-aggregator")).aggregateMapMarkers({
      mode: "backlog", types: ["install"], date: today,
    });
    const ids = res.markers.map((m) => m.id);
    expect(ids).toContain("install:10");
    expect(ids).toContain("install:11");
    expect(ids).not.toContain("install:12");
  });

  it("install Today mode includes isSchedulable projects (matches construction-scheduler)", async () => {
    const today = new Date("2026-04-23T00:00:00Z");
    const rtbBlocked = {
      ...baseProject,
      id: 20,
      stage: "RTB - Blocked",
      isSchedulable: true,
      constructionScheduleDate: null,
    };
    const siteSurvey = {
      ...baseProject,
      id: 21,
      stage: "Site Survey",
      isSchedulable: true,
      constructionScheduleDate: null,
    };
    (fetchAllProjects as jest.Mock).mockResolvedValue([rtbBlocked, siteSurvey]);
    const res = await (await import("@/lib/map-aggregator")).aggregateMapMarkers({
      mode: "today", types: ["install"], date: today,
    });
    const ids = res.markers.map((m) => m.id);
    // Both count as "ready-to-schedule" per the scheduler's isSchedulable
    // definition (SCHEDULABLE_STAGES: Site Survey, RTB, RTB-Blocked,
    // Construction, Inspection).
    expect(ids).toContain("install:20");
    expect(ids).toContain("install:21");
  });
});

describe("completion filtering", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockFindMany.mockReset();
    mockLiveGeocode.mockReset();
    mirrorFindFirstIntoFindMany();
    (fetchAllProjects as jest.Mock).mockReset();
    (fetchTodaysServiceJobs as jest.Mock).mockResolvedValue([]);
    (prisma.crewMember.findMany as jest.Mock).mockResolvedValue([]);
    mockFindFirst.mockResolvedValue({ latitude: 40, longitude: -105 });
  });

  const addr = { address: "1 Main", city: "Boulder", state: "CO", postalCode: "80301" };

  it("install: hides completed projects even when isSchedulable is true", async () => {
    // Avoid timezone-sensitive date math by testing via the ready-to-schedule
    // path (not a specific calendar day).
    const completed = {
      id: 100,
      name: "Done deal",
      ...addr,
      stage: "Close Out",
      isSchedulable: true,
      isActive: true,
      constructionScheduleDate: null,
      constructionCompleteDate: "2026-04-20T15:00:00Z", // already done
    };
    const active = {
      id: 101,
      name: "Live install",
      ...addr,
      stage: "Ready to Build",
      isSchedulable: true,
      isActive: true,
      constructionScheduleDate: null,
      constructionCompleteDate: null,
    };
    (fetchAllProjects as jest.Mock).mockResolvedValue([completed, active]);
    const res = await (await import("@/lib/map-aggregator")).aggregateMapMarkers({
      mode: "today", types: ["install"],
    });
    const ids = res.markers.map((m) => m.id);
    expect(ids).toContain("install:101");
    expect(ids).not.toContain("install:100");
  });

  it("inspection: hides projects whose inspection already passed", async () => {
    const today = new Date("2026-04-23T00:00:00Z");
    const passed = {
      id: 200,
      name: "Inspected",
      ...addr,
      stage: "Inspection",
      isActive: true,
      inspectionScheduleDate: "2026-04-23T10:00:00Z",
      inspectionPassDate: "2026-04-23T14:00:00Z",
    };
    (fetchAllProjects as jest.Mock).mockResolvedValue([passed]);
    const res = await (await import("@/lib/map-aggregator")).aggregateMapMarkers({
      mode: "today", types: ["inspection"], date: today,
    });
    expect(res.markers.map((m) => m.id)).not.toContain("inspection:200");
  });

  it("zuper: drops jobs in terminal status", async () => {
    const { buildServiceMarkers } = await import("@/lib/map-aggregator");
    const addressFields = {
      customer_address: { street: "1 Main", city: "Boulder", state: "CO", zip_code: "80301" },
    };
    const active = { job_uid: "live", job_title: "Live", current_job_status: { status_name: "In Progress" }, ...addressFields };
    const completed = { job_uid: "done", job_title: "Done", current_job_status: { status_name: "Completed" }, ...addressFields };
    const cancelled = { job_uid: "cx", job_title: "Cx", current_job_status: { status_name: "Cancelled" }, ...addressFields };
    const invoiced = { job_uid: "inv", job_title: "Inv", current_job_status: { status_name: "Invoiced" }, ...addressFields };
    const { markers } = await buildServiceMarkers(
      [active, completed, cancelled, invoiced] as any,
      { today: new Date("2026-04-23") }
    );
    const ids = markers.map((m) => m.id);
    expect(ids).toContain("zuperjob:live");
    expect(ids).not.toContain("zuperjob:done");
    expect(ids).not.toContain("zuperjob:cx");
    expect(ids).not.toContain("zuperjob:inv");
  });
});
