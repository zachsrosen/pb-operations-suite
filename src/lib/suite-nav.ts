import { normalizeRole, type UserRole } from "@/lib/role-permissions";

export interface SuiteNavEntry {
  href: string;
  title: string;
  shortLabel: string;
  description: string;
}

export const SUITE_NAV_ENTRIES: SuiteNavEntry[] = [
  {
    href: "/suites/operations",
    title: "Operations Suite",
    shortLabel: "Operations",
    description: "Scheduling, timeline, inventory, and equipment operations.",
  },
  {
    href: "/suites/department",
    title: "Department Suite",
    shortLabel: "Departments",
    description: "Team-level execution dashboards by functional area.",
  },
  {
    href: "/suites/intelligence",
    title: "Intelligence Suite",
    shortLabel: "Intelligence",
    description: "Risk analysis, QC, capacity planning, and pipeline analytics.",
  },
  {
    href: "/suites/service",
    title: "Service + D&R Suite",
    shortLabel: "Service + D&R",
    description: "Service and detach & reset scheduling, equipment, and pipelines.",
  },
  {
    href: "/suites/executive",
    title: "Executive Suite",
    shortLabel: "Executive",
    description: "Leadership metrics, revenue, and cross-location analysis.",
  },
  {
    href: "/suites/admin",
    title: "Admin Suite",
    shortLabel: "Admin",
    description: "Administrative controls, security, compliance, and documentation.",
  },
];

const SUITE_SWITCHER_ALLOWLIST: Record<UserRole, string[]> = {
  ADMIN: [
    "/suites/operations",
    "/suites/department",
    "/suites/intelligence",
    "/suites/service",
    "/suites/executive",
    "/suites/admin",
  ],
  OWNER: [
    "/suites/operations",
    "/suites/department",
    "/suites/intelligence",
    "/suites/service",
    "/suites/executive",
  ],
  MANAGER: ["/suites/operations", "/suites/department", "/suites/intelligence", "/suites/service"],
  PROJECT_MANAGER: ["/suites/operations", "/suites/department", "/suites/intelligence", "/suites/service"],
  OPERATIONS: ["/suites/operations", "/suites/service"],
  OPERATIONS_MANAGER: ["/suites/operations", "/suites/intelligence", "/suites/service"],
  TECH_OPS: ["/suites/department"],
  DESIGNER: ["/suites/department"],
  PERMITTING: ["/suites/department"],
  SALES: [],
  VIEWER: [],
};

export function getSuiteSwitcherEntriesForRole(role: UserRole): SuiteNavEntry[] {
  const effectiveRole = normalizeRole(role);
  const allowlist = SUITE_SWITCHER_ALLOWLIST[effectiveRole] || [];
  if (allowlist.length === 0) return [];
  const allowed = new Set(allowlist);
  return SUITE_NAV_ENTRIES.filter((suite) => allowed.has(suite.href));
}
