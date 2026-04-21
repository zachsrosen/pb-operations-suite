/**
 * Super admin safeguard — code-level break-glass access.
 *
 * Why this exists: since admins can now edit their own role's `allowedRoutes`
 * from the /admin/roles UI (the "role access editor" feature), a bad override
 * could lock every admin out of the admin surface. The invariant guard in
 * `src/lib/role-guards.ts` prevents the obvious footguns, but nothing in the
 * DB-driven access model can be truly un-bypassable — a corrupt DB row or a
 * bug in the resolver could still brick admin access.
 *
 * This module is the un-bypassable layer. A hardcoded list of email addresses
 * is treated as having full, wildcard access regardless of:
 *   - their `User.roles` column (could be empty, VIEWER, anything)
 *   - any RoleDefinitionOverride row (could disable ADMIN entirely)
 *   - any per-user `extraDeniedRoutes` entry
 *   - the ADMIN_ONLY_ROUTES short-circuit
 *
 * The bypass is implemented once at the top of `resolveUserAccess`: when the
 * resolver detects a super-admin email, it short-circuits into a synthetic
 * ADMIN-equivalent access record. From that point on, every downstream check
 * in the codebase (`roles?.includes("ADMIN")`, middleware route allowlist,
 * capability gates, etc.) sees the user as a full admin. No per-call-site
 * updates needed.
 *
 * Why a source-code constant instead of a DB column, env var, or special role:
 *   - DB column: defeats the purpose (could be nulled by the same corruption
 *     we're guarding against).
 *   - Env var: changes don't leave a git trail and require Vercel access to
 *     inspect.
 *   - Special role: someone could accidentally remove the role from a user
 *     row, and the role itself lives in the same DB that could go wrong.
 *   - Source constant: two-person rule (PR + merge), auditable via git blame,
 *     deploy-gated, immune to runtime mutation.
 *
 * Adding or removing super admins is intentionally painful. That's a feature.
 */

/**
 * Emails with unconditional wildcard access. Compared case-insensitively
 * (addresses are lowercased at compare time).
 *
 * Keep this set tiny — the whole point of a super admin is that it's an
 * escape hatch, not a convenience role.
 *
 * NOTE: Both `zach@` and `zach.rosen@` are listed because Google Workspace
 * aliases the two forms and next-auth can surface either depending on the
 * primary address at the moment the session was issued. PRs #239 and #242
 * documented this alias behavior for HubSpot owner resolution; the same
 * reality applies here. Both forms are the same human.
 */
export const SUPER_ADMIN_EMAILS: ReadonlySet<string> = new Set([
  "zach@photonbrothers.com",
  "zach.rosen@photonbrothers.com",
]);

/**
 * True if the given email address is a super admin. Null/undefined/non-string
 * inputs return false — callers that don't have a user context should not
 * accidentally opt into super-admin access.
 */
export function isSuperAdmin(email: string | null | undefined): boolean {
  if (typeof email !== "string" || email.length === 0) return false;
  return SUPER_ADMIN_EMAILS.has(email.toLowerCase());
}
