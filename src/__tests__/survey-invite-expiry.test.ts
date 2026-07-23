/**
 * Tests for survey-invite expiry semantics.
 *
 * Two bugs found 7/23, both from expiry being a date that nothing acts on:
 *
 * 1. Re-invite lockout. `hasActiveInvite` counted by STATUS only, and the only
 *    code that ever wrote EXPIRED was `validateToken` — which runs when the
 *    customer clicks the dead link. Customers who never clicked left a PENDING
 *    row forever, so every later invite for that deal 409'd. Olivia had been
 *    silently skipping 8 real deals since June (Barentine PROJ-9887 et al).
 *
 * 2. Booked-customer lockout. `book` sets SCHEDULED but never extends
 *    `expiresAt`, so a booking inherits the invite's 14-day TTL. Past that,
 *    a customer clicking their own link to reschedule had their invite stamped
 *    EXPIRED — locking them out of the survey they had already booked.
 *    54 live bookings were sitting past TTL when this was found.
 */

const mockPrisma = {
  surveyInvite: {
    count: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock("@/lib/db", () => ({
  get prisma() {
    return mockPrisma;
  },
}));

import {
  hasActiveInvite,
  expireStaleInvites,
  validateToken,
  hashToken,
} from "@/lib/portal-token";
import { bookingExpiresAt } from "@/lib/survey-invite-expiry";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.surveyInvite.count.mockResolvedValue(0);
  mockPrisma.surveyInvite.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.surveyInvite.update.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// hasActiveInvite — the guard that produced the 409
// ---------------------------------------------------------------------------

describe("hasActiveInvite", () => {
  /** The where clause the guard builds, for asserting on its shape. */
  function capturedWhere() {
    return mockPrisma.surveyInvite.count.mock.calls[0][0].where;
  }

  it("only counts a PENDING invite while it is still unexpired", async () => {
    await hasActiveInvite("60671723705");

    const where = capturedWhere();
    const pendingClause = where.OR.find(
      (c: Record<string, unknown>) => c.status === "PENDING",
    );
    expect(pendingClause).toBeDefined();
    // The expiry bound is what was missing — a lapsed PENDING must not block.
    expect(pendingClause.expiresAt.gt).toBeInstanceOf(Date);
  });

  it("counts booked invites regardless of expiry — a booking still blocks", async () => {
    await hasActiveInvite("60671723705");

    const where = capturedWhere();
    const bookedClause = where.OR.find(
      (c: Record<string, unknown>) => c.status && (c.status as Record<string, unknown>).in,
    );
    expect(bookedClause.status.in).toEqual(
      expect.arrayContaining(["SCHEDULED", "RESCHEDULED"]),
    );
    // No expiry bound here: a past-TTL booking is still a real booking.
    expect(bookedClause.expiresAt).toBeUndefined();
  });

  it("scopes the count to the deal", async () => {
    await hasActiveInvite("60671723705");
    expect(capturedWhere().dealId).toBe("60671723705");
  });

  it("reports active when the count is non-zero", async () => {
    mockPrisma.surveyInvite.count.mockResolvedValue(1);
    await expect(hasActiveInvite("60671723705")).resolves.toBe(true);
  });

  it("reports inactive when nothing matches", async () => {
    mockPrisma.surveyInvite.count.mockResolvedValue(0);
    await expect(hasActiveInvite("60671723705")).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// expireStaleInvites — clears the DB partial unique index before an insert
// ---------------------------------------------------------------------------

describe("expireStaleInvites", () => {
  it("flips only past-expiry PENDING rows to EXPIRED", async () => {
    mockPrisma.surveyInvite.updateMany.mockResolvedValue({ count: 3 });

    const swept = await expireStaleInvites();

    expect(swept).toBe(3);
    const args = mockPrisma.surveyInvite.updateMany.mock.calls[0][0];
    expect(args.where.status).toBe("PENDING");
    expect(args.where.expiresAt.lte).toBeInstanceOf(Date);
    expect(args.data).toEqual({ status: "EXPIRED" });
  });

  it("never touches SCHEDULED or RESCHEDULED rows", async () => {
    await expireStaleInvites();
    // A booking must never be swept — that is bug #2 in reverse.
    expect(mockPrisma.surveyInvite.updateMany.mock.calls[0][0].where.status).toBe("PENDING");
  });

  it("scopes to one deal when given a dealId", async () => {
    await expireStaleInvites("60671723705");
    expect(mockPrisma.surveyInvite.updateMany.mock.calls[0][0].where.dealId).toBe("60671723705");
  });

  it("sweeps every deal when no dealId is given", async () => {
    await expireStaleInvites();
    expect(mockPrisma.surveyInvite.updateMany.mock.calls[0][0].where.dealId).toBeUndefined();
  });

  it("runs against a transaction client when one is passed", async () => {
    const tx = { surveyInvite: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const swept = await expireStaleInvites("60671723705", tx as never);

    expect(swept).toBe(1);
    expect(tx.surveyInvite.updateMany).toHaveBeenCalled();
    expect(mockPrisma.surveyInvite.updateMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// bookingExpiresAt — keeps a booked customer's link alive through their survey
// ---------------------------------------------------------------------------

describe("bookingExpiresAt", () => {
  it("extends the token past the survey date", () => {
    const surveyStart = new Date("2026-08-20T16:00:00Z");
    const extended = bookingExpiresAt(surveyStart);
    expect(extended.getTime()).toBe(surveyStart.getTime() + 7 * DAY);
  });

  it("never shortens an invite that already outlives the booking", () => {
    const surveyStart = new Date("2026-08-20T16:00:00Z");
    const farFuture = new Date("2027-01-01T00:00:00Z");
    expect(bookingExpiresAt(surveyStart, farFuture)).toEqual(farFuture);
  });

  it("beats the 14-day default for a survey booked near the end of the window", () => {
    // The exact shape of bug #2: invite issued 6/02, survey booked 6/14,
    // original TTL lapses 6/16 — two days after the survey, and well before
    // a customer might reasonably want to move it.
    const issued = new Date("2026-06-02T14:29:41Z");
    const originalTtl = new Date(issued.getTime() + 14 * DAY);
    const surveyStart = new Date("2026-06-14T16:00:00Z");

    expect(bookingExpiresAt(surveyStart, originalTtl).getTime()).toBeGreaterThan(
      originalTtl.getTime(),
    );
  });
});

// ---------------------------------------------------------------------------
// validateToken — expiry is fatal for PENDING only
// ---------------------------------------------------------------------------

describe("validateToken", () => {
  const RAW = "raw-token-value";

  function invite(overrides: Record<string, unknown>) {
    return {
      id: "inv-1",
      tokenHash: hashToken(RAW),
      dealId: "60671723705",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 7 * DAY),
      ...overrides,
    };
  }

  it("expires a lapsed PENDING invite and stamps the row", async () => {
    mockPrisma.surveyInvite.findUnique.mockResolvedValue(
      invite({ status: "PENDING", expiresAt: new Date(Date.now() - DAY) }),
    );

    const result = await validateToken(RAW);

    expect(result).toEqual({ valid: false, reason: "expired" });
    expect(mockPrisma.surveyInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "EXPIRED" } }),
    );
  });

  it("keeps a past-TTL booking usable so the customer can still reschedule", async () => {
    mockPrisma.surveyInvite.findUnique.mockResolvedValue(
      invite({ status: "SCHEDULED", expiresAt: new Date(Date.now() - DAY) }),
    );

    const result = await validateToken(RAW);

    expect(result.valid).toBe(true);
  });

  it("never stamps EXPIRED on a booked invite", async () => {
    mockPrisma.surveyInvite.findUnique.mockResolvedValue(
      invite({ status: "RESCHEDULED", expiresAt: new Date(Date.now() - DAY) }),
    );

    await validateToken(RAW);

    // Stamping a live booking EXPIRED is what locked 54 customers out.
    expect(mockPrisma.surveyInvite.update).not.toHaveBeenCalled();
  });

  it("still honours expiry for an unexpired PENDING invite", async () => {
    mockPrisma.surveyInvite.findUnique.mockResolvedValue(invite({ status: "PENDING" }));

    const result = await validateToken(RAW);

    expect(result.valid).toBe(true);
    expect(mockPrisma.surveyInvite.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown token", async () => {
    mockPrisma.surveyInvite.findUnique.mockResolvedValue(null);
    await expect(validateToken(RAW)).resolves.toEqual({ valid: false, reason: "not_found" });
  });

  it("rejects a token whose invite is no longer portal-accessible", async () => {
    mockPrisma.surveyInvite.findUnique.mockResolvedValue(invite({ status: "COMPLETED" }));
    await expect(validateToken(RAW)).resolves.toEqual({ valid: false, reason: "inactive" });
  });
});
