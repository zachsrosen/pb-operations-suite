import type { UserRole } from "@/generated/prisma/enums";
import { resolveEffectiveRole } from "@/lib/user-access";

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
    href: "/admin",
    title: "Admin",
    shortLabel: "Admin",
    description: "Administrative controls, security, compliance, and documentation.",
  },
];

/**
 * Filter the canonical suite-nav entries to those visible for a set of roles.
 * Uses `resolveEffectiveRole(roles).suites` so multi-role users see the union
 * of suites across their roles (max-privilege merge handled by the resolver).
 */
export function getSuiteSwitcherEntriesForRoles(roles: UserRole[]): SuiteNavEntry[] {
  const { suites } = resolveEffectiveRole(roles);
  if (suites.length === 0) return [];
  const allowed = new Set(suites);
  return SUITE_NAV_ENTRIES.filter((suite) => allowed.has(suite.href));
}

/** Back-compat single-role wrapper. Prefer `getSuiteSwitcherEntriesForRoles`. */
export function getSuiteSwitcherEntriesForRole(role: UserRole): SuiteNavEntry[] {
  return getSuiteSwitcherEntriesForRoles([role]);
}
