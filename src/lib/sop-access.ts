/**
 * SOP Tab & Section Access Control
 *
 * Edge-compatible (no Prisma/Node deps). Shared by API routes and the
 * client-side SOP page so visibility rules are enforced in both places.
 *
 * Access model:
 *   1. ADMIN / OWNER / EXECUTIVE see everything (admin bypass).
 *   2. PUBLIC_TABS are visible to all authenticated users.
 *   3. TAB_ROLE_GATES restrict tabs to specific roles. A user with ANY
 *      listed role gets access (multi-role union).
 *   4. SECTION_ROLE_GATES restrict specific sections within otherwise-
 *      visible tabs. ADMIN_ONLY_SECTIONS is a back-compat shortcut.
 *   5. Special legacy gate: PM Guide tab is name-gated.
 *
 * Multi-role users: pass `roles` as an array; access is granted if ANY
 * role passes the check. Single-string `role` argument is supported for
 * back-compat.
 */

type RoleInput = string | string[] | null | undefined;

/** Tabs visible to all authenticated users */
const PUBLIC_TABS = new Set([
  "hubspot",
  "ops",
  "ref",
  "zoho-inventory",
  "catalog",
  "suites",
]);

/**
 * Tabs gated to specific roles. A user with any of these roles (or admin
 * bypass) sees the tab. Tabs not in PUBLIC_TABS or TAB_ROLE_GATES are
 * implicitly admin-only.
 */
const TAB_ROLE_GATES: Record<string, ReadonlyArray<string>> = {
  service: [
    "PROJECT_MANAGER",
    "OPERATIONS_MANAGER",
    "OPERATIONS",
    "SERVICE",
  ],
  scheduling: [
    "PROJECT_MANAGER",
    "OPERATIONS_MANAGER",
    "OPERATIONS",
    "TECH_OPS",
    "SALES_MANAGER",
    "SALES",
    "SERVICE",
    "ROOFING",
  ],
  forecast: [
    "PROJECT_MANAGER",
    "OPERATIONS_MANAGER",
    "INTELLIGENCE",
  ],
  trackers: [
    "PROJECT_MANAGER",
    "OPERATIONS_MANAGER",
    "TECH_OPS",
    "PERMIT",
    "INTERCONNECT",
  ],
  tools: [
    "PROJECT_MANAGER",
    "OPERATIONS_MANAGER",
    "OPERATIONS",
    "TECH_OPS",
    "DESIGN",
    "PERMIT",
    "INTERCONNECT",
    "SERVICE",
    "SALES_MANAGER",
    "SALES",
    "ACCOUNTING",
  ],
  queues: [
    "PROJECT_MANAGER",
    "OPERATIONS_MANAGER",
    "TECH_OPS",
    "DESIGN",
    "PERMIT",
    "INTERCONNECT",
  ],
  // Accounting SOP — matches the runtime role gate on
  // /dashboards/payment-action-queue and similar pages.
  "accounting-sop": ["ACCOUNTING"],
  // Sales & Marketing SOP — sales reps, sales managers, marketing.
  "sales-marketing-sop": ["SALES", "SALES_MANAGER", "MARKETING"],
  // Executive SOP — intentionally NOT listed here. Admin/owner/executive
  // bypass all gates already, and unknown tabs are admin-only by default.

  // Role-specific SOP tabs — legacy TECH_OPS keeps access to all three so
  // existing tech-ops users don't lose anything during the role split.
  "role-de": ["DESIGN", "TECH_OPS"],
  "role-permit": ["PERMIT", "TECH_OPS"],
  "role-ic": ["INTERCONNECT", "TECH_OPS"],
};

/** PM Guide — gated by first name (legacy) */
const PM_NAMES = new Set(["alexis", "kaitlyn", "kat", "natasha"]);

/**
 * Sections that require additional role checks beyond their parent tab.
 * Empty array = admin-only. Non-empty = "any of these roles" grants access.
 */
const SECTION_ROLE_GATES: Record<string, ReadonlyArray<string>> = {
  // Admin-only sections (legacy)
  "ref-user-roles": [],
  "ref-system": [],

  // Workflow Builder — admin internals
  "tools-workflow-builder": [],

  // Pricing/COGS — sales+accounting+leadership only
  "tools-pricing-calculator": [
    "SALES_MANAGER",
    "SALES",
    "ACCOUNTING",
    "PROJECT_MANAGER",
  ],

  // P&I hubs — only the relevant team gets the deep how-to
  "tools-permit-hub": ["PROJECT_MANAGER", "TECH_OPS", "PERMIT"],
  "tools-ic-hub": ["PROJECT_MANAGER", "TECH_OPS", "INTERCONNECT"],

  // Customer 360 — contains PII access workflow
  "service-customer-history": [
    "PROJECT_MANAGER",
    "OPERATIONS_MANAGER",
    "OPERATIONS",
    "SERVICE",
  ],

  // D&E action queues
  "queues-plan-review": ["PROJECT_MANAGER", "TECH_OPS", "DESIGN"],
  "queues-design-approval": ["PROJECT_MANAGER", "TECH_OPS", "DESIGN"],
  "queues-design-revisions": ["PROJECT_MANAGER", "TECH_OPS", "DESIGN"],

  // Permit-team queues
  "queues-permit-action": ["PROJECT_MANAGER", "TECH_OPS", "PERMIT"],
  "queues-permit-revisions": ["PROJECT_MANAGER", "TECH_OPS", "PERMIT"],

  // IC-team queues
  "queues-ic-action": ["PROJECT_MANAGER", "TECH_OPS", "INTERCONNECT"],
  "queues-ic-revisions": ["PROJECT_MANAGER", "TECH_OPS", "INTERCONNECT"],

  // Per-suite descriptions — gated to the suite's own audience.
  // (Overview section stays open — it's the directory.)
  "suites-executive": [],
  "suites-accounting": ["ACCOUNTING"],
  "suites-admin": [],
  "suites-sales-marketing": ["SALES_MANAGER", "SALES", "MARKETING"],
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
 * @param firstName - Lowercase first name of the user
 */
export function canAccessTab(
  tabId: string,
  roles: RoleInput,
  firstName: string,
): boolean {
  // Admins, owners, and executives see everything.
  if (isAdmin(roles)) return true;

  // Public tabs.
  if (PUBLIC_TABS.has(tabId)) return true;

  // Role-gated tabs — any matching role grants access.
  const tabGate = TAB_ROLE_GATES[tabId];
  if (tabGate && anyRoleMatches(roles, tabGate)) return true;

  // PM Guide — name-gated.
  if (tabId === "pm") return PM_NAMES.has(firstName);

  // Unknown / shelved tabs (other, role-ops, etc.) — denied.
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
