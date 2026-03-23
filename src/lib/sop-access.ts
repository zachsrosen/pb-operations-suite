/**
 * SOP Tab & Section Access Control
 *
 * Edge-compatible (no Prisma/Node deps). Shared by API routes and the
 * client-side SOP page so visibility rules are enforced in both places.
 */

/** Tabs visible to all authenticated users */
const PUBLIC_TABS = new Set(["hubspot", "ops", "ref", "zoho-inventory"]);

/** PM Guide — gated by first name */
const PM_NAMES = new Set(["alexis", "kaitlyn", "kat", "natasha"]);

/** Admin-only sections within otherwise-visible tabs */
export const ADMIN_ONLY_SECTIONS = ["ref-user-roles", "ref-system"];

const ADMIN_ROLES = new Set(["ADMIN", "EXECUTIVE", "OWNER"]);

/**
 * Can the given user access a tab?
 *
 * @param tabId   - The SOP tab identifier (e.g. "hubspot", "pm", "role-de")
 * @param role    - Normalized UserRole string (or null for unauthenticated)
 * @param firstName - Lowercase first name of the user
 */
export function canAccessTab(
  tabId: string,
  role: string | null,
  firstName: string
): boolean {
  // Admins and owners see everything
  if (role && ADMIN_ROLES.has(role)) return true;

  // Public tabs
  if (PUBLIC_TABS.has(tabId)) return true;

  // PM Guide — name-gated
  if (tabId === "pm") return PM_NAMES.has(firstName);

  // Tech Ops tab
  if (tabId === "role-de") return role === "TECH_OPS";

  // Unknown / shelved tabs (other, role-ops, etc.) — denied
  return false;
}

/**
 * Can the given user access a specific section?
 *
 * Checks both tab-level and section-level restrictions.
 */
export function canAccessSection(
  sectionId: string,
  tabId: string,
  role: string | null,
  firstName: string
): boolean {
  // Admins and owners bypass all checks
  if (role && ADMIN_ROLES.has(role)) return true;

  // Must have access to the parent tab
  if (!canAccessTab(tabId, role, firstName)) return false;

  // Admin-only sections within visible tabs
  if (ADMIN_ONLY_SECTIONS.includes(sectionId)) return false;

  return true;
}
