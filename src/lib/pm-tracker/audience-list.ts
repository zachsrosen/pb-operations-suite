/**
 * Pure audience-list helpers — no auth/session imports, so this is safely
 * testable without mocking next-auth.
 *
 * The session-aware `checkAudienceAccess` lives in audience.ts.
 */

const PM_TRACKER_AUDIENCE: ReadonlyArray<string> = [
  "zach@photonbrothers.com",
  // Add ownership/HR emails here when expanding access.
] as const;

export function isInAudience(email: string | null | undefined): boolean {
  if (!email) return false;
  return PM_TRACKER_AUDIENCE.includes(email.toLowerCase().trim());
}

export function audienceList(): ReadonlyArray<string> {
  return PM_TRACKER_AUDIENCE;
}
