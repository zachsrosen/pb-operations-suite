/**
 * Survey-invite expiry math.
 *
 * Kept free of Prisma so both the portal token layer and the dependency-light
 * `survey-invite-close` helper can use it.
 */

/**
 * How long a booked invite stays reachable past its survey, so the customer
 * can still reschedule or cancel after the original 14-day token TTL lapses.
 */
export const POST_BOOKING_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Token expiry for a newly booked invite: far enough past the survey that the
 * customer can still reschedule or cancel, never earlier than the TTL the
 * invite already had.
 */
export function bookingExpiresAt(scheduledStartUtc: Date, currentExpiresAt?: Date): Date {
  const extended = new Date(scheduledStartUtc.getTime() + POST_BOOKING_GRACE_MS);
  if (currentExpiresAt && currentExpiresAt > extended) return currentExpiresAt;
  return extended;
}
