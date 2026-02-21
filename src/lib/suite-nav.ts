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
