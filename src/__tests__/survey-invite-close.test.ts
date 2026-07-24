/**
 * Tests for closeSurveyInviteForDeal — closes a customer's PENDING survey
 * portal invite when the survey is booked through the INTERNAL scheduler.
 *
 * Gap (found 7/9): only portal self-bookings flipped the invite to
 * SCHEDULED. Surveys booked in the app by ops (e.g. Miles booking Erik
 * Swinson) left the invite PENDING forever — 48 of 61 pending invites were
 * this. A live PENDING invite still lets the customer book a SECOND survey
 * (the book route only 409s when status !== PENDING), and inflates counts.
 */
import { closeSurveyInviteForDeal } from "@/lib/survey-invite-close";

function makePrisma(pendingInvite: Record<string, unknown> | null) {
  const update = jest.fn().mockResolvedValue({});
  const findFirst = jest.fn().mockResolvedValue(pendingInvite);
  return {
    prisma: { surveyInvite: { findFirst, update } },
    findFirst,
    update,
  };
}

describe("closeSurveyInviteForDeal", () => {
  const booking = {
    scheduledDate: "2026-07-17",
    scheduledTime: "15:00",
    zuperJobUid: "job-uid-1",
    scheduleRecordId: "rec-1",
  };

  it("flips the deal's PENDING invite to SCHEDULED with booking details", async () => {
    const { prisma, findFirst, update } = makePrisma({ id: "inv-1" });
    const result = await closeSurveyInviteForDeal(prisma as never, "62322453841", booking);

    expect(result).toEqual({ closed: true, inviteId: "inv-1" });
    // Only ever targets a PENDING invite for this deal
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dealId: "62322453841", status: "PENDING" } }),
    );
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe("SCHEDULED");
    expect(data.scheduledDate).toBe("2026-07-17");
    expect(data.scheduledTime).toBe("15:00");
    expect(data.zuperJobUid).toBe("job-uid-1");
    expect(data.scheduleRecordId).toBe("rec-1");
    expect(data.scheduledAt).toBeInstanceOf(Date);
  });

  it("is a no-op when the deal has no PENDING invite", async () => {
    const { prisma, update } = makePrisma(null);
    const result = await closeSurveyInviteForDeal(prisma as never, "999", booking);
    expect(result).toEqual({ closed: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("is a no-op (never throws) when prisma is unavailable", async () => {
    const result = await closeSurveyInviteForDeal(null as never, "1", booking);
    expect(result).toEqual({ closed: false });
  });

  it("omits optional fields that were not provided", async () => {
    const { prisma, update } = makePrisma({ id: "inv-2" });
    await closeSurveyInviteForDeal(prisma as never, "1", { scheduledDate: "2026-07-17", scheduledTime: "10:00" });
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe("SCHEDULED");
    expect("zuperJobUid" in data).toBe(false);
    expect("scheduleRecordId" in data).toBe(false);
  });

  it("extends the token past the survey so the customer can still reschedule", async () => {
    // Invite issued with the default 14-day TTL, ops books near the end of it.
    const expiresAt = new Date("2026-07-19T00:00:00Z");
    const { prisma, update } = makePrisma({ id: "inv-4", expiresAt });

    await closeSurveyInviteForDeal(prisma as never, "1", booking);

    const data = update.mock.calls[0][0].data;
    expect(data.expiresAt.getTime()).toBeGreaterThan(expiresAt.getTime());
  });

  it("leaves expiry alone when the booking has no date", async () => {
    const { prisma, update } = makePrisma({ id: "inv-5", expiresAt: new Date() });
    await closeSurveyInviteForDeal(prisma as never, "1", { scheduledTime: "10:00" });
    expect("expiresAt" in update.mock.calls[0][0].data).toBe(false);
  });

  it("swallows update errors and reports not-closed (never blocks a booking)", async () => {
    const { prisma, update } = makePrisma({ id: "inv-3" });
    update.mockRejectedValueOnce(new Error("db down"));
    const result = await closeSurveyInviteForDeal(prisma as never, "1", booking);
    expect(result).toEqual({ closed: false });
  });
});
