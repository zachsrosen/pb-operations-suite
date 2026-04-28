/**
 * PM Tracker audience gate.
 *
 * Sensitive HR-adjacent data — access list is enforced as a hard email
 * allowlist on top of the ADMIN role gate in middleware. Critically, the
 * audience check uses the user's REAL email and ignores impersonation
 * cookies (`pb_effective_roles`, `pb_is_impersonating`) — an admin
 * impersonating ownership cannot use that to view PM tracker data.
 *
 * Expansion: add emails to PM_TRACKER_AUDIENCE below. Future enhancement
 * could move this list to a SystemConfig row for runtime edits without
 * redeploys, but a code constant is fine for v1.
 */

import { auth } from "@/auth";

const PM_TRACKER_AUDIENCE: ReadonlyArray<string> = [
  "zach@photonbrothers.com",
  // Add ownership/HR emails here when expanding access.
] as const;

export function isInAudience(email: string | null | undefined): boolean {
  if (!email) return false;
  return PM_TRACKER_AUDIENCE.includes(email.toLowerCase().trim());
}

/**
 * Resolves to true ONLY if the actual logged-in user (real email from the
 * NextAuth session) is in the allowlist. Impersonation cookies are ignored.
 */
export async function checkAudienceAccess(): Promise<{
  ok: boolean;
  email: string | null;
}> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase().trim() ?? null;
  return { ok: isInAudience(email), email };
}

export function audienceList(): ReadonlyArray<string> {
  return PM_TRACKER_AUDIENCE;
}
