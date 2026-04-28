/**
 * PM Tracker audience gate (session-aware wrapper around audience-list.ts).
 *
 * Sensitive HR-adjacent data — access list is enforced as a hard email
 * allowlist on top of the ADMIN role gate in middleware. Critically, the
 * audience check uses the user's REAL email and ignores impersonation
 * cookies (`pb_effective_roles`, `pb_is_impersonating`) — an admin
 * impersonating ownership cannot use that to view PM tracker data.
 */

import { auth } from "@/auth";
import { isInAudience } from "./audience-list";

export { isInAudience, audienceList } from "./audience-list";

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
