/**
 * Tests for the double-book guard wiring in the customer portal survey
 * book (POST) and reschedule (PUT) routes.
 *
 * The portal validates slots when the page loads, not when the customer
 * confirms — the same stale-availability race PR #1337 closed on the
 * internal scheduler. These routes must call the shared guard right before
 * writing and return a customer-friendly 409 (slotTaken: true, so the
 * client re-renders the picker with fresh availability). Customers get no
 * allowDoubleBook bypass.
 */

// ── Portal token ─────────────────────────────────────────────────────────────
const mockValidateToken = jest.fn();
jest.mock("@/lib/portal-token", () => ({
  validateToken: (...args: unknown[]) => mockValidateToken(...args),
}));

// ── Slot decoding / timezone ─────────────────────────────────────────────────
const mockDecodeSlotId = jest.fn();
jest.mock("@/lib/portal-availability", () => ({
  decodeSlotId: (...args: unknown[]) => mockDecodeSlotId(...args),
  getDayOfWeekForTz: jest.fn(() => 5),
}));
jest.mock("@/lib/constants", () => ({
  getTimezoneForLocation: jest.fn(() => "America/Denver"),
}));

// ── The guard under wiring test ──────────────────────────────────────────────
const mockCheckConflict = jest.fn();
jest.mock("@/lib/survey-booking-guard", () => ({
  checkSurveySlotBookingConflict: (...args: unknown[]) => mockCheckConflict(...args),
}));

// ── Prisma + db helpers ──────────────────────────────────────────────────────
const mockIdemFindUnique = jest.fn();
const mockIdemCreate = jest.fn();
const mockIdemUpdate = jest.fn();
const mockIdemDelete = jest.fn();
const mockCrewFindUnique = jest.fn();
const mockTransaction = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    idempotencyKey: {
      findUnique: (...args: unknown[]) => mockIdemFindUnique(...args),
      create: (...args: unknown[]) => mockIdemCreate(...args),
      update: (...args: unknown[]) => mockIdemUpdate(...args),
      delete: (...args: unknown[]) => mockIdemDelete(...args),
    },
    crewMember: {
      findUnique: (...args: unknown[]) => mockCrewFindUnique(...args),
    },
    scheduleRecord: {
      update: jest.fn(),
    },
    surveyInvite: {
      update: jest.fn(),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
  cacheZuperJob: jest.fn(),
  getCrewMemberByName: jest.fn().mockResolvedValue(null),
  getCachedZuperJobByDealId: jest.fn().mockResolvedValue(null),
}));

// ── Zuper ────────────────────────────────────────────────────────────────────
jest.mock("@/lib/zuper", () => ({
  zuper: {
    isConfigured: jest.fn(() => false),
    rescheduleJob: jest.fn().mockResolvedValue({ type: "error", error: "not configured" }),
  },
  createJobFromProject: jest.fn().mockResolvedValue({ type: "error", error: "not configured" }),
}));

// ── HubSpot / email / calendar side effects ─────────────────────────────────
jest.mock("@/lib/hubspot", () => ({
  updateDealProperty: jest.fn().mockResolvedValue(true),
  getDealProperties: jest.fn().mockResolvedValue(null),
  updateSiteSurveyorProperty: jest.fn().mockResolvedValue(true),
}));
jest.mock("@/lib/email", () => ({
  sendSchedulingNotification: jest.fn().mockResolvedValue({ success: true }),
  sendPortalEmail: jest.fn().mockResolvedValue({ success: true, skipped: true }),
}));
jest.mock("@/lib/google-calendar", () => ({
  upsertSiteSurveyCalendarEvent: jest.fn().mockResolvedValue({ success: true }),
  getDenverSiteSurveyCalendarId: jest.fn(() => null),
  getSharedCalendarImpersonationEmail: jest.fn(() => null),
  getSurveyCalendarEventId: jest.fn(() => "evt-1"),
}));
jest.mock("@/lib/external-links", () => ({
  getGoogleCalendarEventUrl: jest.fn(() => null),
}));

// ── Routes under test ────────────────────────────────────────────────────────
import { NextRequest } from "next/server";
import { POST as bookPOST } from "@/app/api/portal/survey/[token]/book/route";
import { PUT as reschedulePUT } from "@/app/api/portal/survey/[token]/reschedule/route";

// ── Fixtures ─────────────────────────────────────────────────────────────────
const JOE_UID = "f203f99b-4aaf-488e-8e6a-8ee5e94ec217";
const IDEMPOTENCY_KEY = "3f8a2c44-9c1d-4f6e-8a3b-2d5e7f9a1b0c";

const baseInvite = {
  id: "inv-1",
  tokenHash: "hash-1",
  dealId: "60456724017",
  customerName: "Crane, Sarah",
  customerEmail: "sarah@example.com",
  customerPhone: null,
  propertyAddress: "123 Main St",
  pbLocation: "DTC",
  systemSize: null,
  sentBy: null,
  crewMemberId: null,
  scheduleRecordId: null,
  scheduledDate: null,
  scheduledTime: null,
  zuperJobUid: null,
  cutoffAt: null,
};

const crewMember = {
  name: "Joe Lynch",
  email: "joe.lynch@photonbrothers.com",
  zuperUserUid: JOE_UID,
  zuperTeamUid: "team-1",
};

const slotConflict = {
  projectId: "13833491464",
  projectName: "PROJ-10028 | Branyan",
  assignedUser: "Joe Lynch",
  scheduledStart: "10:00",
  scheduledEnd: "11:00",
  source: "schedule-record" as const,
};

function makeTx() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    bookedSlot: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "bs-1" }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    scheduleRecord: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "sr-1" }),
      update: jest.fn().mockResolvedValue({}),
    },
    crewMember: {
      findUnique: jest.fn().mockResolvedValue({ name: "Old Crew" }),
    },
    surveyInvite: {
      update: jest.fn().mockResolvedValue({}),
    },
    activityLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

function bookRequest() {
  return new NextRequest("http://localhost/api/portal/survey/tok/book", {
    method: "POST",
    body: JSON.stringify({ slotId: "slot-1", idempotencyKey: IDEMPOTENCY_KEY }),
  });
}

function rescheduleRequest() {
  return new NextRequest("http://localhost/api/portal/survey/tok/reschedule", {
    method: "PUT",
    body: JSON.stringify({ slotId: "slot-1", idempotencyKey: IDEMPOTENCY_KEY }),
  });
}

const routeParams = { params: Promise.resolve({ token: "tok" }) };

beforeEach(() => {
  jest.clearAllMocks();
  mockDecodeSlotId.mockReturnValue({
    date: "2099-01-15",
    time: "10:00",
    crewMemberId: "crew-1",
  });
  mockIdemFindUnique.mockResolvedValue(null);
  mockIdemCreate.mockResolvedValue({});
  mockIdemUpdate.mockResolvedValue({});
  mockCrewFindUnique.mockResolvedValue(crewMember);
  mockCheckConflict.mockResolvedValue(null);
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(makeTx()));
});

describe("POST /api/portal/survey/[token]/book — double-book guard", () => {
  beforeEach(() => {
    mockValidateToken.mockResolvedValue({
      valid: true,
      invite: { ...baseInvite, status: "PENDING" },
    });
  });

  it("returns a customer-friendly 409 with slotTaken when the slot is occupied", async () => {
    mockCheckConflict.mockResolvedValue(slotConflict);

    const res = await bookPOST(bookRequest(), routeParams);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.slotTaken).toBe(true);
    expect(body.error).toMatch(/no longer available|just taken/i);
    // Must not leak internal project/surveyor details to the customer
    expect(body.error).not.toContain("Branyan");
    expect(body.error).not.toContain("Joe Lynch");
    // Nothing was written
    expect(mockTransaction).not.toHaveBeenCalled();
    // Idempotency key released for retry
    expect(mockIdemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } }),
    );
  });

  it("checks the requested crew/window against the guard", async () => {
    await bookPOST(bookRequest(), routeParams);

    expect(mockCheckConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: "60456724017",
        date: "2099-01-15",
        startTime: "10:00",
        endTime: "11:00",
        startUtc: expect.stringMatching(/^2099-01-15 \d{2}:00:00$/),
        endUtc: expect.stringMatching(/^2099-01-15 \d{2}:00:00$/),
        assigneeUid: JOE_UID,
        assigneeName: "Joe Lynch",
      }),
    );
  });

  it("books normally when the guard finds no conflict", async () => {
    const res = await bookPOST(bookRequest(), routeParams);

    expect(res.status).toBe(201);
    expect(mockTransaction).toHaveBeenCalled();
  });
});

describe("PUT /api/portal/survey/[token]/reschedule — double-book guard", () => {
  beforeEach(() => {
    mockValidateToken.mockResolvedValue({
      valid: true,
      invite: {
        ...baseInvite,
        status: "SCHEDULED",
        scheduledDate: "2099-01-10",
        scheduledTime: "09:00",
        crewMemberId: "crew-1",
        scheduleRecordId: "sr-old",
        zuperJobUid: "zj-own",
        cutoffAt: new Date("2099-01-09T15:00:00Z"),
      },
    });
  });

  it("returns a customer-friendly 409 with slotTaken when the new slot is occupied", async () => {
    mockCheckConflict.mockResolvedValue(slotConflict);

    const res = await reschedulePUT(rescheduleRequest(), routeParams);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.slotTaken).toBe(true);
    expect(body.error).not.toContain("Branyan");
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockIdemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } }),
    );
  });

  it("excludes the deal's own Zuper job from the conflict check", async () => {
    await reschedulePUT(rescheduleRequest(), routeParams);

    expect(mockCheckConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: "60456724017",
        excludeJobUid: "zj-own",
      }),
    );
  });

  it("reschedules normally when the guard finds no conflict", async () => {
    const res = await reschedulePUT(rescheduleRequest(), routeParams);

    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalled();
  });
});
