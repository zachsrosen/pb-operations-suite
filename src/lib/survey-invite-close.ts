/**
 * Close a customer's PENDING survey portal invite when the survey is booked
 * through the INTERNAL scheduler (ops booking on the customer's behalf).
 *
 * Only portal self-bookings previously flipped the invite to SCHEDULED, so
 * ops-booked surveys left the invite PENDING indefinitely (found 7/9: 48 of
 * 61 pending invites were stale this way). A live PENDING invite still lets
 * the customer book a SECOND survey — the portal book route only blocks when
 * status !== PENDING — and inflates pending counts.
 *
 * Best-effort and non-fatal: a survey booking must never fail because the
 * invite couldn't be closed.
 */

import { bookingExpiresAt } from "@/lib/survey-invite-expiry";

// Minimal shape of the Prisma client this helper needs (keeps it unit-testable
// while staying assignable from the fully-typed PrismaClient).
interface InviteCapablePrisma {
  surveyInvite: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findFirst: (args: any) => Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: (args: any) => Promise<any>;
  };
}

export interface SurveyInviteBooking {
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  zuperJobUid?: string | null;
  scheduleRecordId?: string | null;
  crewMemberId?: string | null;
}

export async function closeSurveyInviteForDeal(
  prisma: InviteCapablePrisma | null | undefined,
  dealId: string | number,
  booking: SurveyInviteBooking,
): Promise<{ closed: boolean; inviteId?: string }> {
  if (!prisma) return { closed: false };
  try {
    const invite = await prisma.surveyInvite.findFirst({
      where: { dealId: String(dealId), status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (!invite) return { closed: false };

    // An ops-booked invite gets the same token extension a self-booked one
    // does, so the customer can still reach the portal to reschedule.
    const surveyStart = booking.scheduledDate
      ? new Date(`${booking.scheduledDate}T12:00:00Z`)
      : null;
    const extendedExpiry =
      surveyStart && !Number.isNaN(surveyStart.getTime())
        ? bookingExpiresAt(surveyStart, invite.expiresAt ?? undefined)
        : null;

    await prisma.surveyInvite.update({
      where: { id: invite.id },
      data: {
        status: "SCHEDULED",
        scheduledAt: new Date(),
        ...(extendedExpiry ? { expiresAt: extendedExpiry } : {}),
        ...(booking.scheduledDate ? { scheduledDate: booking.scheduledDate } : {}),
        ...(booking.scheduledTime ? { scheduledTime: booking.scheduledTime } : {}),
        ...(booking.zuperJobUid ? { zuperJobUid: booking.zuperJobUid } : {}),
        ...(booking.scheduleRecordId ? { scheduleRecordId: booking.scheduleRecordId } : {}),
        ...(booking.crewMemberId ? { crewMemberId: booking.crewMemberId } : {}),
      },
    });
    return { closed: true, inviteId: invite.id };
  } catch (err) {
    console.warn(`[survey-invite-close] Failed to close invite for deal ${dealId}:`, err);
    return { closed: false };
  }
}
