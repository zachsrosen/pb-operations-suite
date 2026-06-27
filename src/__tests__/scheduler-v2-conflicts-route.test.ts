/**
 * Tests for POST /api/scheduler-v2/conflicts — pre-flight conflict check.
 *
 * Covers:
 *  - 404 when SCHEDULER_V2_ENABLED !== "true" (feature gate)
 *  - 401 when unauthenticated (requireApiAuth)
 *  - 400 on missing required body fields
 *  - Double-book: resource already has an assignment on that date → hard.double_book, ok=false
 *  - Over-capacity: location load + 1 > capacity → soft.over_capacity
 *  - Weekend/holiday date → hard.weekend_holiday
 *  - Sales lead-time violation → hard.lead_time
 *  - Travel infeasible → soft.travel
 *  - Travel lib throwing → NO travel flag (fail-open), result still computed
 *  - Travel lib returning null → NO travel flag (fail-open)
 */

// ── Auth ──────────────────────────────────────────────────────────────────────
const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

// ── Prisma ────────────────────────────────────────────────────────────────────
const mockScheduleRecordFindMany = jest.fn();
const mockBookedSlotFindMany = jest.fn();
const mockZuperJobCacheFindMany = jest.fn();
const mockCrewFindMany = jest.fn();
const mockProjectCacheFindMany = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    scheduleRecord: { findMany: (...a: unknown[]) => mockScheduleRecordFindMany(...a) },
    bookedSlot: { findMany: (...a: unknown[]) => mockBookedSlotFindMany(...a) },
    zuperJobCache: { findMany: (...a: unknown[]) => mockZuperJobCacheFindMany(...a) },
    crewMember: { findMany: (...a: unknown[]) => mockCrewFindMany(...a) },
    hubSpotProjectCache: { findMany: (...a: unknown[]) => mockProjectCacheFindMany(...a) },
  },
}));

// ── Scheduling policy (lead-time) ─────────────────────────────────────────────
const mockGetSalesSurveyLeadTimeError = jest.fn();
jest.mock("@/lib/scheduling-policy", () => ({
  getSalesSurveyLeadTimeError: (...a: unknown[]) => mockGetSalesSurveyLeadTimeError(...a),
}));

// ── Travel time ───────────────────────────────────────────────────────────────
const mockEvaluateSlotTravel = jest.fn();
const mockGetConfig = jest.fn();
jest.mock("@/lib/travel-time", () => ({
  evaluateSlotTravel: (...a: unknown[]) => mockEvaluateSlotTravel(...a),
  getConfig: (...a: unknown[]) => mockGetConfig(...a),
}));

// ── Holidays / weekend ────────────────────────────────────────────────────────
// We do NOT mock these — we use real dates (a known Saturday and a known holiday)
// to exercise the real isPbHoliday + isWeekendDateYmd logic in the route.

import { NextRequest, NextResponse } from "next/server";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const AUTH_OK = {
  email: "test@photonbrothers.com",
  role: "ADMIN",
  roles: ["ADMIN"],
  ip: "127.0.0.1",
  userAgent: "jest",
};

const BASE_BODY = {
  workItemId: "wi-1",
  dealId: "deal-1001",
  resourceId: "crew-joe",
  location: "Westminster",
  date: "2026-07-06", // Monday — regular weekday, no holiday
  days: 1,
  startTime: "08:00",
  endTime: "16:00",
  workType: "install",
};

function makeRequest(body: Record<string, unknown> = BASE_BODY): NextRequest {
  return new NextRequest("http://localhost:3000/api/scheduler-v2/conflicts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadPOST() {
  const mod = await import("@/app/api/scheduler-v2/conflicts/route");
  return mod.POST;
}

const ORIGINAL_FLAG = process.env.SCHEDULER_V2_ENABLED;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SCHEDULER_V2_ENABLED = "true";

  mockRequireApiAuth.mockResolvedValue(AUTH_OK);
  mockScheduleRecordFindMany.mockResolvedValue([]);
  mockBookedSlotFindMany.mockResolvedValue([]);
  mockZuperJobCacheFindMany.mockResolvedValue([]);
  mockCrewFindMany.mockResolvedValue([]);
  mockProjectCacheFindMany.mockResolvedValue([]);
  mockGetSalesSurveyLeadTimeError.mockReturnValue(null);
  mockEvaluateSlotTravel.mockResolvedValue(null);
  mockGetConfig.mockReturnValue({
    enabled: false, // disabled by default so travel isn't attempted in most tests
    bufferMinutes: 15,
    unknownThresholdMinutes: 90,
    tightThresholdMinutes: 0,
    apiKey: "",
  });
});

afterAll(() => {
  process.env.SCHEDULER_V2_ENABLED = ORIGINAL_FLAG;
});

// ── Feature gate ──────────────────────────────────────────────────────────────

describe("POST /api/scheduler-v2/conflicts — feature gate", () => {
  it("returns 404 when SCHEDULER_V2_ENABLED is not 'true'", async () => {
    process.env.SCHEDULER_V2_ENABLED = "false";
    const POST = await loadPOST();
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
  });

  it("returns 404 when SCHEDULER_V2_ENABLED is missing", async () => {
    delete process.env.SCHEDULER_V2_ENABLED;
    const POST = await loadPOST();
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("POST /api/scheduler-v2/conflicts — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    mockRequireApiAuth.mockResolvedValue(
      NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    );
    const POST = await loadPOST();
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe("POST /api/scheduler-v2/conflicts — validation", () => {
  it("returns 400 when required fields are missing", async () => {
    const POST = await loadPOST();
    const res = await POST(makeRequest({ workItemId: "wi-1" })); // missing resourceId, location, date, days, workType
    expect(res.status).toBe(400);
  });
});

// ── Happy path: clean result ──────────────────────────────────────────────────

describe("POST /api/scheduler-v2/conflicts — clean result", () => {
  it("returns ok=true with empty hard and soft when no conflicts", async () => {
    const POST = await loadPOST();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.hard).toEqual([]);
    expect(body.soft).toEqual([]);
  });
});

// ── Hard: double_book ─────────────────────────────────────────────────────────

describe("POST /api/scheduler-v2/conflicts — double_book", () => {
  it("emits hard double_book when resource already has an assignment that date", async () => {
    // Simulate an existing ScheduleRecord for the same resource on the proposed date
    mockScheduleRecordFindMany.mockResolvedValue([
      {
        id: "sr-existing",
        projectId: "deal-9999",
        projectName: "Other Project",
        scheduledDate: "2026-07-06",
        scheduledDays: 1,
        scheduledStart: "08:00",
        scheduledEnd: "16:00",
        assignedUser: "crew-joe", // resource name matches resourceId in this test
        scheduleType: "install",
        status: "scheduled",
      },
    ]);

    const POST = await loadPOST();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.hard.some((f: { kind: string }) => f.kind === "double_book")).toBe(true);
  });
});

// ── Soft: over_capacity ───────────────────────────────────────────────────────

describe("POST /api/scheduler-v2/conflicts — over_capacity", () => {
  it("emits soft over_capacity when location load + 1 exceeds capacity", async () => {
    // Westminster DEFAULT_LOCATION_CAPACITY = 2 (from schedule-optimizer.ts).
    // Two existing assignments already fill capacity. Adding +1 → load 3 > 2.
    mockScheduleRecordFindMany.mockResolvedValue([
      {
        id: "sr-1",
        projectId: "deal-1",
        projectName: "Project A",
        scheduledDate: "2026-07-06",
        scheduledDays: 1,
        scheduledStart: null,
        scheduledEnd: null,
        assignedUser: "Alice",
        scheduleType: "install",
        status: "scheduled",
      },
      {
        id: "sr-2",
        projectId: "deal-2",
        projectName: "Project B",
        scheduledDate: "2026-07-06",
        scheduledDays: 1,
        scheduledStart: null,
        scheduledEnd: null,
        assignedUser: "Bob",
        scheduleType: "install",
        status: "scheduled",
      },
    ]);
    mockCrewFindMany.mockResolvedValue([]); // no crew → DEFAULT_LOCATION_CAPACITY fallback

    const POST = await loadPOST();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.soft.some((f: { kind: string }) => f.kind === "over_capacity")).toBe(true);
  });
});

// ── Hard: weekend_holiday ─────────────────────────────────────────────────────

describe("POST /api/scheduler-v2/conflicts — weekend_holiday", () => {
  it("emits hard weekend_holiday for a Saturday date", async () => {
    // 2026-07-04 is a Saturday (and also July 4 weekend observed on Jul 3 by PB)
    // Use 2026-07-04 directly — it IS a Saturday
    const POST = await loadPOST();
    const res = await POST(makeRequest({ ...BASE_BODY, date: "2026-07-04" })); // Saturday
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.hard.some((f: { kind: string }) => f.kind === "weekend_holiday")).toBe(true);
  });

  it("emits hard weekend_holiday for a PB observed holiday (Sunday)", async () => {
    // 2026-07-05 is a Sunday
    const POST = await loadPOST();
    const res = await POST(makeRequest({ ...BASE_BODY, date: "2026-07-05" })); // Sunday
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.hard.some((f: { kind: string }) => f.kind === "weekend_holiday")).toBe(true);
  });

  it("emits hard weekend_holiday for a PB paid holiday (weekday)", async () => {
    // 2026-07-03 is a Friday AND a PB paid holiday (Independence Day observed)
    const POST = await loadPOST();
    const res = await POST(makeRequest({ ...BASE_BODY, date: "2026-07-03" })); // PB holiday
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.hard.some((f: { kind: string }) => f.kind === "weekend_holiday")).toBe(true);
  });
});

// ── Hard: lead_time ───────────────────────────────────────────────────────────

describe("POST /api/scheduler-v2/conflicts — lead_time", () => {
  it("emits hard lead_time when getSalesSurveyLeadTimeError returns a string", async () => {
    mockGetSalesSurveyLeadTimeError.mockReturnValue(
      "Sales users cannot schedule site surveys for today or tomorrow. Please choose a date at least 2 days out.",
    );

    const POST = await loadPOST();
    const res = await POST(makeRequest({ ...BASE_BODY, workType: "survey" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    const leadFlag = body.hard.find((f: { kind: string }) => f.kind === "lead_time");
    expect(leadFlag).toBeTruthy();
    expect(leadFlag.message).toMatch(/Sales users/);
  });

  it("does NOT emit lead_time when getSalesSurveyLeadTimeError returns null", async () => {
    mockGetSalesSurveyLeadTimeError.mockReturnValue(null);

    const POST = await loadPOST();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hard.some((f: { kind: string }) => f.kind === "lead_time")).toBe(false);
  });
});

// ── Soft: travel ──────────────────────────────────────────────────────────────

describe("POST /api/scheduler-v2/conflicts — travel", () => {
  beforeEach(() => {
    // Enable travel time so the route attempts it
    mockGetConfig.mockReturnValue({
      enabled: true,
      bufferMinutes: 15,
      unknownThresholdMinutes: 90,
      tightThresholdMinutes: 0,
      apiKey: "fake-key",
    });
  });

  it("emits soft travel flag when evaluateSlotTravel returns infeasible warning", async () => {
    // Set up an existing booking with times so the route finds an adjacent job
    // and calls evaluateSlotTravel.
    mockScheduleRecordFindMany.mockResolvedValue([
      {
        id: "sr-prev",
        projectId: "deal-prev",
        projectName: "Previous Project",
        scheduledDate: "2026-07-06",
        scheduledDays: 1,
        scheduledStart: "06:00",
        scheduledEnd: "07:30", // ends 30 min before our 08:00 start
        assignedUser: "crew-joe", // same resource
        scheduleType: "install",
        status: "scheduled",
      },
    ]);

    mockEvaluateSlotTravel.mockResolvedValue({
      type: "tight",
      direction: "before",
      availableMinutesBefore: 5,
    });

    const POST = await loadPOST();
    const res = await POST(makeRequest({ ...BASE_BODY, startTime: "08:00", endTime: "16:00" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.soft.some((f: { kind: string }) => f.kind === "travel")).toBe(true);
  });

  it("does NOT emit travel flag when evaluateSlotTravel returns null (no adjacent jobs)", async () => {
    mockEvaluateSlotTravel.mockResolvedValue(null);

    const POST = await loadPOST();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.soft.some((f: { kind: string }) => f.kind === "travel")).toBe(false);
  });

  it("does NOT emit travel flag when evaluateSlotTravel throws (fail-open)", async () => {
    mockEvaluateSlotTravel.mockRejectedValue(new Error("Maps API quota exceeded"));

    const POST = await loadPOST();
    const res = await POST(makeRequest());
    // Result must still be computed — no 500
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("hard");
    expect(body).toHaveProperty("soft");
    expect(body.soft.some((f: { kind: string }) => f.kind === "travel")).toBe(false);
  });

  it("does NOT emit travel flag when evaluateSlotTravel returns null after error-like condition (fail-open)", async () => {
    // Simulate quota-style null return
    mockEvaluateSlotTravel.mockResolvedValue(null);

    const POST = await loadPOST();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.soft.some((f: { kind: string }) => f.kind === "travel")).toBe(false);
  });
});

// ── Multiple conflicts together ───────────────────────────────────────────────

describe("POST /api/scheduler-v2/conflicts — multiple flags", () => {
  it("returns both hard and soft flags when multiple issues apply", async () => {
    // Lead-time violation (hard) + over-capacity (soft) simultaneously.
    // Westminster DEFAULT_LOCATION_CAPACITY = 2; need 2 existing assignments so
    // projected load (2+1=3) > capacity (2).
    mockGetSalesSurveyLeadTimeError.mockReturnValue("Lead time violation");
    mockScheduleRecordFindMany.mockResolvedValue([
      {
        id: "sr-1",
        projectId: "deal-1",
        projectName: "Project A",
        scheduledDate: "2026-07-06",
        scheduledDays: 1,
        scheduledStart: null,
        scheduledEnd: null,
        assignedUser: "Alice",
        scheduleType: "install",
        status: "scheduled",
      },
      {
        id: "sr-2",
        projectId: "deal-2",
        projectName: "Project B",
        scheduledDate: "2026-07-06",
        scheduledDays: 1,
        scheduledStart: null,
        scheduledEnd: null,
        assignedUser: "Bob",
        scheduleType: "install",
        status: "scheduled",
      },
    ]);
    mockCrewFindMany.mockResolvedValue([]);

    const POST = await loadPOST();
    const res = await POST(makeRequest({ ...BASE_BODY, workType: "survey" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.hard.some((f: { kind: string }) => f.kind === "lead_time")).toBe(true);
    expect(body.soft.some((f: { kind: string }) => f.kind === "over_capacity")).toBe(true);
  });
});
