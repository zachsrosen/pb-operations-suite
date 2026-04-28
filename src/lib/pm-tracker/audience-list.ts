/**
 * Pure audience-list helpers — no auth/session imports, so this is safely
 * testable without mocking next-auth.
 *
 * The session-aware `checkAudienceAccess` lives in audience.ts.
 */

// Raw allowlist as authored — entries may have any case, may have whitespace.
// We normalize at module load so `isInAudience` doesn't depend on the author
// remembering to lowercase. A single forgotten capital letter would silently
// deny access to a real audience member otherwise.
const RAW_AUDIENCE: ReadonlyArray<string> = [
  "zach@photonbrothers.com",
  // Add ownership/HR emails here when expanding access.
] as const;

const PM_TRACKER_AUDIENCE: ReadonlyArray<string> = RAW_AUDIENCE.map((e) =>
  e.toLowerCase().trim(),
);

export function isInAudience(email: string | null | undefined): boolean {
  if (!email) return false;
  return PM_TRACKER_AUDIENCE.includes(email.toLowerCase().trim());
}

export function audienceList(): ReadonlyArray<string> {
  return PM_TRACKER_AUDIENCE;
}
