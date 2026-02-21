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
    description: "Core scheduling, timeline, and inventory operations.",
  },
  {
    href: "/suites/department",
    title: "Department Suite",
    shortLabel: "Departments",
    description: "Team-level execution dashboards by functional area.",
  },
  {
    href: "/suites/service",
    title: "Service Suite",
    shortLabel: "Service",
    description: "Service scheduling, equipment backlog, and service pipeline.",
  },
  {
    href: "/suites/additional-pipeline",
    title: "Additional Pipeline Suite",
    shortLabel: "Pipelines",
    description: "Supplemental sales, service, and D&R pipeline views.",
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
    description: "Administrative controls, security, and documentation.",
  },
  {
    href: "/suites/testing",
    title: "Testing Suite",
    shortLabel: "Testing",
    description: "Experimental dashboards and in-progress validation tools.",
  },
];

const SUITE_SWITCHER_ALLOWLIST: Record<UserRole, string[]> = {
  ADMIN: [
    "/suites/operations",
    "/suites/department",
    "/suites/service",
    "/suites/additional-pipeline",
    "/suites/executive",
    "/suites/admin",
    "/suites/testing",
  ],
  OWNER: [
    "/suites/operations",
    "/suites/department",
    "/suites/service",
    "/suites/executive",
    "/suites/testing",
  ],
  MANAGER: ["/suites/operations", "/suites/department", "/suites/service"],
  PROJECT_MANAGER: ["/suites/operations", "/suites/department", "/suites/service"],
  OPERATIONS: ["/suites/operations", "/suites/service"],
  OPERATIONS_MANAGER: ["/suites/operations", "/suites/service"],
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
