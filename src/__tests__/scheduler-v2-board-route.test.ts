/**
 * Tests for GET /api/scheduler-v2/board — the unified-dispatch board aggregator.
 *
 * Covers:
 *  - 404 when SCHEDULER_V2_ENABLED !== "true" (feature gate)
 *  - 401 when unauthenticated (requireApiAuth)
 *  - 400 when from..to range exceeds 32 days
 *  - Happy path: returns BoardData (resources, workItems, assignments, capacity,
 *    dateRange) with prisma + zuper lookup + team users mocked.
 *  - Fail-soft: a throwing Zuper lookup still yields DB-backed BoardData (no 500).
 */

// ── Auth ──────────────────────────────────────────────────────────────────────
const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

// ── Prisma ────────────────────────────────────────────────────────────────────
const mockCrewFindMany = jest.fn();
const mockScheduleRecordFindMany = jest.fn();
const mockBookedSlotFindMany = jest.fn();
const mockZuperJobCacheFindMany = jest.fn();
const mockProjectCacheFindMany = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    crewMember: { findMany: (...a: unknown[]) => mockCrewFindMany(...a) },
    scheduleRecord: { findMany: (...a: unknown[]) => mockScheduleRecordFindMany(...a) },
    bookedSlot: { findMany: (...a: unknown[]) => mockBookedSlotFindMany(...a) },
    zuperJobCache: { findMany: (...a: unknown[]) => mockZuperJobCacheFindMany(...a) },
    hubSpotProjectCache: { findMany: (...a: unknown[]) => mockProjectCacheFindMany(...a) },
  },
}));

// ── Install pool (HubSpot data functions reused directly) ──────────────────────
const mockFetchAllProjects = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  fetchAllProjects: (...a: unknown[]) => mockFetchAllProjects(...a),
  // Pass-through so the route's scheduling filter is exercised but deterministic.
  filterProjectsForContext: jest.fn((projects: unknown[]) => projects),
}));

// ── Zuper construction lookup (reused via handleLookup) ────────────────────────
const mockHandleLookup = jest.fn();
jest.mock("@/app/api/zuper/jobs/lookup/route", () => ({
  handleLookup: (...a: unknown[]) => mockHandleLookup(...a),
}));

// ── Director-team user resolution ──────────────────────────────────────────────
const mockGetTeamUsersByLocation = jest.fn();
jest.mock("@/lib/scheduler-v2/assign", () => ({
  getTeamUsersByLocation: (...a: unknown[]) => mockGetTeamUsersByLocation(...a),
}));

import { NextRequest, NextResponse } from "next/server";

const AUTH_OK = {
  email: "test@photonbrothers.com",
  role: "ADMIN",
  roles: ["ADMIN"],
  ip: "127.0.0.1",
  userAgent: "jest",
};

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/scheduler-v2/board");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

async function loadGET() {
  const mod = await import("@/app/api/scheduler-v2/board/route");
  return mod.GET;
}

const ORIGINAL_FLAG = process.env.SCHEDULER_V2_ENABLED;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SCHEDULER_V2_ENABLED = "true";

  mockRequireApiAuth.mockResolvedValue(AUTH_OK);
  mockCrewFindMany.mockResolvedValue([]);
  mockScheduleRecordFindMany.mockResolvedValue([]);
  mockBookedSlotFindMany.mockResolvedValue([]);
  mockZuperJobCacheFindMany.mockResolvedValue([]);
  mockProjectCacheFindMany.mockResolvedValue([]);
  mockFetchAllProjects.mockResolvedValue([]);
  mockHandleLookup.mockResolvedValue(
    NextResponse.json({ configured: true, jobs: {} }),
  );
  mockGetTeamUsersByLocation.mockResolvedValue({});
});

afterAll(() => {
  process.env.SCHEDULER_V2_ENABLED = ORIGINAL_FLAG;
});

describe("GET /api/scheduler-v2/board — feature gate", () => {
  it("returns 404 when SCHEDULER_V2_ENABLED is not 'true'", async () => {
    process.env.SCHEDULER_V2_ENABLED = "false";
    const GET = await loadGET();
    const res = await GET(makeRequest({ from: "2026-07-01", to: "2026-07-07" }));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/scheduler-v2/board — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    mockRequireApiAuth.mockResolvedValue(
      NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    );
    const GET = await loadGET();
    const res = await GET(makeRequest({ from: "2026-07-01", to: "2026-07-07" }));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/scheduler-v2/board — validation", () => {
  it("returns 400 when from..to range exceeds 32 days", async () => {
    const GET = await loadGET();
    const res = await GET(makeRequest({ from: "2026-07-01", to: "2026-08-15" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when from/to are missing", async () => {
    const GET = await loadGET();
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/scheduler-v2/board — happy path", () => {
  beforeEach(() => {
    mockCrewFindMany.mockResolvedValue([
      {
        id: "cm1",
        name: "Joe Lynch",
        role: "technician",
        locations: ["Westminster"],
        isActive: true,
        maxDailyJobs: 2,
        zuperUserUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217",
        zuperTeamUid: "1c23adb9-cefa-44c7-8506-804949afc56f",
      },
    ]);

    mockScheduleRecordFindMany.mockResolvedValue([
      {
        id: "sr1",
        projectId: "1001",
        projectName: "PROJ-1001 | Smith, Jane | 123 Main St",
        scheduledDate: "2026-07-02",
        scheduledDays: 1,
        scheduledStart: "08:00",
        scheduledEnd: "16:00",
        assignedUser: "Joe Lynch",
        scheduleType: "construction",
        status: "scheduled",
      },
    ]);

    mockProjectCacheFindMany.mockResolvedValue([
      { dealId: "1001", amount: 42000, pbLocation: "Westminster" },
    ]);

    mockFetchAllProjects.mockResolvedValue([
      {
        id: 1001,
        name: "PROJ-1001 | Smith, Jane | 123 Main St",
        address: "123 Main St",
        pbLocation: "Westminster",
        amount: 42000,
        constructionScheduleDate: "2026-07-02",
        constructionStatus: "Scheduled",
        constructionCompleteDate: null,
        expectedDaysForInstall: 2,
        daysForInstallers: 2,
      },
    ]);

    mockGetTeamUsersByLocation.mockResolvedValue({
      Westminster: [
        {
          name: "Joe Lynch",
          userUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217",
          teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f",
        },
      ],
    });

    mockHandleLookup.mockResolvedValue(
      NextResponse.json({
        configured: true,
        jobs: {
          "1001": {
            jobUid: "job-1001",
            status: "Scheduled",
            scheduledDate: "2026-07-02",
            scheduledEnd: "2026-07-03",
            scheduledDays: 2,
            assignedTo: ["Joe Lynch"],
          },
        },
      }),
    );
  });

  it("returns BoardData with all five sections populated", async () => {
    const GET = await loadGET();
    const res = await GET(makeRequest({ from: "2026-07-01", to: "2026-07-07" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("resources");
    expect(body).toHaveProperty("workItems");
    expect(body).toHaveProperty("assignments");
    expect(body).toHaveProperty("capacity");
    expect(body).toHaveProperty("dateRange");

    expect(body.dateRange).toEqual({ start: "2026-07-01", end: "2026-07-07" });

    // Resources reconciled from director-team users.
    expect(Array.isArray(body.resources)).toBe(true);
    expect(body.resources.length).toBeGreaterThan(0);
    const joe = body.resources.find((r: { name: string }) => r.name === "Joe Lynch");
    expect(joe).toBeTruthy();
    expect(joe.assignable).toBe(true);
    expect(joe.crewMemberId).toBe("cm1");
    expect(joe.capacityPerDay).toBe(2);

    // Work item built from the install pool + zuper lookup.
    expect(body.workItems.length).toBeGreaterThan(0);
    const wi = body.workItems[0];
    expect(wi.workType).toBe("install");
    expect(wi.location).toBe("Westminster");

    // Assignment built from the schedule record.
    expect(body.assignments.length).toBeGreaterThan(0);
    const asg = body.assignments[0];
    expect(asg.resourceName).toBe("Joe Lynch");
    expect(asg.date).toBe("2026-07-02");

    // Capacity cells present for every location x date.
    expect(body.capacity.length).toBeGreaterThan(0);
    const westyCell = body.capacity.find(
      (c: { location: string; date: string }) =>
        c.location === "Westminster" && c.date === "2026-07-02",
    );
    expect(westyCell).toBeTruthy();
    // Westminster has Joe (maxDailyJobs 2) as the only assignable crew there.
    expect(westyCell.capacityDays).toBe(2);
    expect(westyCell.loadDays).toBe(1);
  });
});

describe("GET /api/scheduler-v2/board — fail-soft", () => {
  it("returns 200 with DB-backed data even when the zuper lookup throws", async () => {
    mockCrewFindMany.mockResolvedValue([
      {
        id: "cm1",
        name: "Joe Lynch",
        role: "technician",
        locations: ["Westminster"],
        isActive: true,
        maxDailyJobs: 2,
        zuperUserUid: "uid-joe",
        zuperTeamUid: null,
      },
    ]);
    mockHandleLookup.mockRejectedValue(new Error("Zuper 503"));

    const GET = await loadGET();
    const res = await GET(makeRequest({ from: "2026-07-01", to: "2026-07-07" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("resources");
    expect(body).toHaveProperty("capacity");
    // Roster still reflects the active crew member even with Zuper down.
    expect(body.resources.some((r: { name: string }) => r.name === "Joe Lynch")).toBe(true);
  });
});
