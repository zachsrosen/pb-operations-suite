/**
 * SOP Tab & Section Access Control
 *
 * Edge-compatible (no Prisma/Node deps). Shared by API routes and the
 * client-side SOP page so visibility rules are enforced in both places.
 *
 * Access model (post-2026-04-28 hub flip):
 *   1. ADMIN / OWNER / EXECUTIVE see everything (admin bypass).
 *   2. PUBLIC_TABS are visible to all authenticated users — this is the
 *      DEFAULT for almost every tab. The SOP guide is positioned as the
 *      company-wide knowledge hub: anyone can read about how any team
 *      operates, even teams they're not on.
 *   3. SECTION_ROLE_GATES restrict specific sections within otherwise-
 *      visible tabs. This is the targeted lockdown for sensitive content
 *      (admin internals, financial COGS data, PII workflows).
 *   4. Tabs not in PUBLIC_TABS are admin/owner/executive only — used
 *      for true work-in-progress areas like "drafts".
 *
 * Multi-role users: pass `roles` as an array; access is granted if ANY
 * role passes the check. Single-string `role` argument is supported for
 * back-compat.
 *
 * Historical context: the previous model was opt-in by role — most tabs
 * were gated to specific roles via TAB_ROLE_GATES, with the assumption
 * that "your team's playbook" was the framing. The 2026-04-28 hub flip
 * inverts this: the framing is "the company's playbook, all of it" and
 * the default is open. Only specifically-sensitive sections lock down.
 */

type RoleInput = string | string[] | null | undefined;

/**
 * Tabs visible to all authenticated users.
 *
 * Almost every tab lives here. Only true admin work-in-progress areas
 * (the "drafts" staging tab) are excluded — those fall through to the
 * default-deny path below.
 */
const PUBLIC_TABS = new Set([
  // Foundation knowledge
  "hubspot",
  "ops",
  "ref",

  // Inventory + product
  "zoho-inventory",
  "catalog",
  "inventory",

  // Suites + tools
  "suites",
  "tools",

  // Process / pipelines
  "service",
  "scheduling",
  "forecast",
  "trackers",
  "queues",

  // Department-specific guides — open to everyone for cross-team transparency
  "accounting-sop",
  "sales-marketing-sop",
  "pm", // PM Guide — was name-gated, now open per hub framing
  "role-de", // Design & Engineering
  "role-permit", // Permitting
  "role-ic", // Interconnection
]);

/**
 * Sections that require additional role checks beyond their parent tab.
 * Empty array = admin-only. Non-empty = "any of these roles" grants access.
 *
 * The hub flip dramatically narrowed this list — most sections are now
 * open. What remains here is intentional:
 *   - System / role internals (admin only)
 *   - Financial COGS data (sales/accounting/PM only)
 *   - PII access workflows (operations roles only)
 *   - Suite descriptions for sensitive suites (admin/exec)
 */
const SECTION_ROLE_GATES: Record<string, ReadonlyArray<string>> = {
  // Admin internals — how role gating + system architecture work
  "ref-user-roles": [],
  "ref-system": [],

  // Workflow Builder — admin tooling internals
  "tools-workflow-builder": [],

  // Pricing/COGS — has EPC margins, lease factors, etc. Sensitive labor data.
  "tools-pricing-calculator": [
    "SALES_MANAGER",
    "SALES",
    "ACCOUNTING",
    "PROJECT_MANAGER",
  ],

  // Customer 360 — contains PII access workflow (legal/compliance)
  "service-customer-history": [
    "PROJECT_MANAGER",
    "OPERATIONS_MANAGER",
    "OPERATIONS",
    "SERVICE",
  ],

  // Suite descriptions for sensitive suites
  "suites-executive": [], // exec strategy / financials
  "suites-admin": [], // admin tooling internals
};

/**
 * Legacy export — sections that are admin-only (empty allowlist in
 * SECTION_ROLE_GATES). Kept for back-compat with callers that still use it.
 */
export const ADMIN_ONLY_SECTIONS = Object.entries(SECTION_ROLE_GATES)
  .filter(([, roles]) => roles.length === 0)
  .map(([id]) => id);

const ADMIN_ROLES = new Set(["ADMIN", "EXECUTIVE", "OWNER"]);

function normalizeRoles(roles: RoleInput): string[] {
  if (!roles) return [];
  if (Array.isArray(roles)) return roles.filter((r): r is string => !!r);
  return [roles];
}

function isAdmin(roles: RoleInput): boolean {
  return normalizeRoles(roles).some((r) => ADMIN_ROLES.has(r));
}

function anyRoleMatches(
  userRoles: RoleInput,
  allowed: ReadonlyArray<string>,
): boolean {
  const list = normalizeRoles(userRoles);
  return list.some((r) => allowed.includes(r));
}

/**
 * Can the given user access a tab?
 *
 * @param tabId   - The SOP tab identifier (e.g. "hubspot", "service")
 * @param roles   - User role(s) — string or array (or null for unauthenticated)
 * @param firstName - Lowercase first name of the user (kept for back-compat
 *   with older callers; unused in current logic since the PM name-gate was
 *   removed during the hub flip).
 */
export function canAccessTab(
  tabId: string,
  roles: RoleInput,
  // Unused since PM Guide was opened up — kept in the signature so older
  // callers (and tests) don't break.
  _firstName: string,
): boolean {
  // Admins, owners, and executives see everything.
  if (isAdmin(roles)) return true;

  // Public tabs — the default for almost everything.
  if (PUBLIC_TABS.has(tabId)) return true;

  // Unknown / shelved / drafts tabs — admin-only by default.
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
  roles: RoleInput,
  firstName: string,
): boolean {
  // Admins and owners bypass all checks.
  if (isAdmin(roles)) return true;

  // Must have access to the parent tab.
  if (!canAccessTab(tabId, roles, firstName)) return false;

  // Section-level gates (most specific check).
  const gate = SECTION_ROLE_GATES[sectionId];
  if (gate !== undefined) {
    // Empty array means "admin-only" — non-admins denied.
    if (gate.length === 0) return false;
    // Otherwise: any matching role grants access.
    return anyRoleMatches(roles, gate);
  }

  return true;
}
