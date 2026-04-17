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
    href: "/suites/design-engineering",
    title: "Design & Engineering Suite",
    shortLabel: "D&E",
    description: "Design review, clipping analytics, AHJ requirements, and engineering tools.",
  },
  {
    href: "/suites/permitting-interconnection",
    title: "Permitting & Interconnection Suite",
    shortLabel: "P&I",
    description: "Permit tracking, utility management, action queues, and SLA monitoring.",
  },
  {
    href: "/suites/intelligence",
    title: "Intelligence Suite",
    shortLabel: "Intelligence",
    description: "Risk analysis, QC, capacity planning, and pipeline analytics.",
  },
  {
    href: "/suites/service",
    title: "Service Suite",
    shortLabel: "Service",
    description: "Service scheduling, equipment tracking, priority queue, and pipelines.",
  },
  {
    href: "/suites/dnr-roofing",
    title: "D&R + Roofing Suite",
    shortLabel: "D&R + Roofing",
    description: "Detach & reset and roofing scheduling, pipelines, and tracking.",
  },
  {
    href: "/suites/executive",
    title: "Executive Suite",
    shortLabel: "Executive",
    description: "Leadership metrics, revenue, and cross-location analysis.",
  },
  {
    href: "/suites/accounting",
    title: "Accounting Suite",
    shortLabel: "Accounting",
    description: "PE deal payments, pricing tools, and financial tracking.",
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
    "/suites/design-engineering",
    "/suites/permitting-interconnection",
    "/suites/intelligence",
    "/suites/service",
    "/suites/dnr-roofing",
    "/suites/executive",
    "/suites/accounting",
    "/suites/admin",
  ],
  EXECUTIVE: [
    "/suites/operations",
    "/suites/design-engineering",
    "/suites/permitting-interconnection",
    "/suites/intelligence",
    "/suites/service",
    "/suites/dnr-roofing",
    "/suites/executive",
    "/suites/accounting",
  ],
  OWNER: [
    "/suites/operations",
    "/suites/design-engineering",
    "/suites/permitting-interconnection",
    "/suites/intelligence",
    "/suites/service",
    "/suites/dnr-roofing",
    "/suites/executive",
    "/suites/accounting",
  ],
  MANAGER: ["/suites/operations", "/suites/design-engineering", "/suites/permitting-interconnection", "/suites/intelligence", "/suites/service", "/suites/dnr-roofing", "/suites/accounting"],
  PROJECT_MANAGER: ["/suites/operations", "/suites/design-engineering", "/suites/permitting-interconnection", "/suites/intelligence", "/suites/service", "/suites/dnr-roofing", "/suites/accounting"],
  OPERATIONS: ["/suites/operations", "/suites/service", "/suites/dnr-roofing", "/suites/accounting"],
  OPERATIONS_MANAGER: ["/suites/operations", "/suites/intelligence", "/suites/service", "/suites/dnr-roofing", "/suites/accounting"],
  SERVICE: ["/suites/service"],
  TECH_OPS: ["/suites/operations", "/suites/design-engineering", "/suites/permitting-interconnection", "/suites/accounting"],
  DESIGNER: ["/suites/operations", "/suites/design-engineering", "/suites/permitting-interconnection", "/suites/accounting"],
  PERMITTING: ["/suites/operations", "/suites/design-engineering", "/suites/permitting-interconnection", "/suites/accounting"],
  SALES: [],
  SALES_MANAGER: ["/suites/accounting"],
  VIEWER: [],
};

export function getSuiteSwitcherEntriesForRole(role: UserRole): SuiteNavEntry[] {
  const effectiveRole = normalizeRole(role);
  const allowlist = SUITE_SWITCHER_ALLOWLIST[effectiveRole] || [];
  if (allowlist.length === 0) return [];
  const allowed = new Set(allowlist);
  return SUITE_NAV_ENTRIES.filter((suite) => allowed.has(suite.href));
}
