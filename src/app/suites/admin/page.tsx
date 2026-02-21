import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const ADMIN_TOOLS: SuitePageCard[] = [
  {
    href: "/admin/users",
    title: "Users",
    description: "Manage user accounts, roles, and access controls.",
    tag: "ADMIN",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
    section: "Admin Tools",
  },
  {
    href: "/admin/activity",
    title: "Activity Log",
    description: "Audit user actions, dashboard views, and system events.",
    tag: "AUDIT",
    tagColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    section: "Admin Tools",
  },
  {
    href: "/admin/security",
    title: "Security",
    description: "Review security events, impersonation, and admin activity.",
    tag: "SECURITY",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
    section: "Admin Tools",
  },
  {
    href: "/admin/tickets",
    title: "Bug Reports",
    description: "View and manage user-submitted bug reports and issues.",
    tag: "TICKETS",
    tagColor: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    section: "Admin Tools",
  },
  {
    href: "/admin/directory",
    title: "Page Directory",
    description: "Complete page URL directory with per-role route access visibility.",
    tag: "ROUTES",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    section: "Admin Tools",
  },
  {
    href: "/dashboards/zuper-compliance",
    title: "Zuper Compliance",
    description: "Per-user compliance scorecards and crew-composition comparisons.",
    tag: "COMPLIANCE",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
    section: "Admin Tools",
  },
  {
    href: "/dashboards/zuper-status-comparison",
    title: "Zuper Status Comparison",
    description: "Compare Zuper job statuses and schedule/completion dates with HubSpot data.",
    tag: "ZUPER",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    section: "Admin Tools",
  },
  {
    href: "/suites/testing",
    title: "Testing Suite",
    description: "Experimental dashboards, prototypes, and validation tools.",
    tag: "TESTING",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    section: "Admin Tools",
  },
];

const DOCUMENTATION: SuitePageCard[] = [
  {
    href: "/updates",
    title: "Updates",
    description: "Release notes, changelog, and recent feature updates.",
    tag: "CHANGELOG",
    tagColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    section: "Documentation",
  },
  {
    href: "/guide",
    title: "Guide",
    description: "User guide for navigating dashboards and features.",
    tag: "GUIDE",
    tagColor: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    section: "Documentation",
  },
  {
    href: "/roadmap",
    title: "Roadmap",
    description: "Planned features, upcoming work, and development priorities.",
    tag: "ROADMAP",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    section: "Documentation",
  },
  {
    href: "/handbook",
    title: "Handbook",
    description: "Comprehensive guide to dashboards, features, and workflows.",
    tag: "HANDBOOK",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    section: "Documentation",
  },
  {
    href: "/sop",
    title: "SOPs",
    description: "Standard operating procedures for operations, scheduling, and workflows.",
    tag: "SOP",
    tagColor: "bg-teal-500/20 text-teal-400 border-teal-500/30",
    section: "Documentation",
  },
];

const API_SHORTCUTS: SuitePageCard[] = [
  {
    href: "/api/projects?stats=true",
    title: "Projects + Stats API",
    description: "Full project data with statistics.",
    tag: "GET",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "API Shortcuts",
  },
  {
    href: "/api/projects?context=pe",
    title: "PE Projects API",
    description: "Participate Energy project data.",
    tag: "GET",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "API Shortcuts",
  },
  {
    href: "/api/projects?context=scheduling",
    title: "Scheduling Projects API",
    description: "RTB and schedulable projects.",
    tag: "GET",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "API Shortcuts",
  },
];

export default async function AdminSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/admin");
  if (user.role !== "ADMIN") redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/admin"
      title="Admin Suite"
      subtitle="Admin tools, governance dashboards, and system docs."
      cards={[...ADMIN_TOOLS, ...DOCUMENTATION, ...API_SHORTCUTS]}
      role={user.role}
      hoverBorderClass="hover:border-orange-500/50"
      columnsClassName="grid grid-cols-1 md:grid-cols-3 gap-4"
    />
  );
}
