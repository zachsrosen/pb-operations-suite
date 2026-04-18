import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";
import SyncStatusCard from "./SyncStatusCard";

const ADMIN_TOOLS: SuitePageCard[] = [
  {
    href: "/admin/users",
    title: "Users",
    description: "Manage user accounts, roles, and access controls.",
    tag: "ADMIN",
    icon: "👥",
    section: "Admin Tools",
  },
  {
    href: "/admin/activity",
    title: "Activity Log",
    description: "Audit user actions, dashboard views, and system events.",
    tag: "AUDIT",
    icon: "📜",
    section: "Admin Tools",
  },
  {
    href: "/admin/security",
    title: "Security",
    description: "Review security events, impersonation, and admin activity.",
    tag: "SECURITY",
    icon: "🔒",
    section: "Admin Tools",
  },
  {
    href: "/admin/tickets",
    title: "Bug Reports",
    description: "View and manage user-submitted bug reports and issues.",
    tag: "TICKETS",
    icon: "🐛",
    section: "Admin Tools",
  },
  {
    href: "/admin/directory",
    title: "Page Directory",
    description: "Complete page URL directory with per-role route access visibility.",
    tag: "ROUTES",
    icon: "🗂️",
    section: "Admin Tools",
  },
  {
    href: "/admin/roles",
    title: "Role Inspector",
    description: "Read-only view of every role's suites, routes, landing cards, scope, and capabilities. Source of truth: src/lib/roles.ts.",
    tag: "ROLES",
    icon: "🔐",
    section: "Admin Tools",
  },
  {
    href: "/dashboards/zuper-status-comparison",
    title: "Zuper Status Comparison",
    description: "Compare Zuper job statuses and schedule/completion dates with HubSpot data.",
    tag: "ZUPER",
    icon: "🔄",
    section: "Admin Tools",
  },
  {
    href: "/dashboards/mobile",
    title: "Mobile Dashboard",
    description: "Touch-optimized view for field teams and fast project lookup.",
    tag: "MOBILE",
    icon: "📱",
    section: "Admin Tools",
  },
  {
    href: "/dashboards/availability-approvals",
    title: "Availability Approvals",
    description: "Review and approve or reject crew availability change requests.",
    tag: "APPROVALS",
    icon: "✅",
    section: "Admin Tools",
  },
];

const DOCUMENTATION: SuitePageCard[] = [
  {
    href: "/updates",
    title: "Updates",
    description: "Release notes, changelog, and recent feature updates.",
    tag: "CHANGELOG",
    icon: "📢",
    section: "Documentation",
  },
  {
    href: "/guide",
    title: "Guide",
    description: "User guide for navigating dashboards and features.",
    tag: "GUIDE",
    icon: "📖",
    section: "Documentation",
  },
  {
    href: "/roadmap",
    title: "Roadmap",
    description: "Planned features, upcoming work, and development priorities.",
    tag: "ROADMAP",
    icon: "🗺️",
    section: "Documentation",
  },
  {
    href: "/handbook",
    title: "Handbook",
    description: "Comprehensive guide to dashboards, features, and workflows.",
    tag: "HANDBOOK",
    icon: "📚",
    section: "Documentation",
  },
  {
    href: "/sop",
    title: "SOPs",
    description: "Standard operating procedures for operations, scheduling, and workflows.",
    tag: "SOP",
    icon: "📝",
    section: "Documentation",
  },
];

const PROTOTYPES: SuitePageCard[] = [
  {
    href: "/prototypes/home-refresh",
    title: "Home Refresh Prototypes",
    description: "13 homepage replacement concepts, including focused teal/steel refinements.",
    tag: "PROTOTYPE",
    icon: "🧪",
    section: "Prototypes",
  },
  {
    href: "/prototypes/layout-refresh",
    title: "Layout Refresh Prototypes",
    description: "Replacement suite layouts for operations, D&E, P&I, and executive views.",
    tag: "PROTOTYPE",
    icon: "🧪",
    section: "Prototypes",
  },
  {
    href: "/prototypes/solar-checkout",
    title: "Solar Checkout Experience",
    description: "Customer-facing solar checkout flow prototype.",
    tag: "PROTOTYPE",
    icon: "☀️",
    section: "Prototypes",
  },
  // Solar Surveyor moved to D&E Suite: /dashboards/solar-surveyor
];

const API_SHORTCUTS: SuitePageCard[] = [
  {
    href: "/api/projects?stats=true",
    title: "Projects + Stats API",
    description: "Full project data with statistics.",
    tag: "GET",
    icon: "🔗",
    section: "API Shortcuts",
  },
  {
    href: "/api/projects?context=pe",
    title: "PE Projects API",
    description: "Participate Energy project data.",
    tag: "GET",
    icon: "🔗",
    section: "API Shortcuts",
  },
  {
    href: "/api/projects?context=scheduling",
    title: "Scheduling Projects API",
    description: "RTB and schedulable projects.",
    tag: "GET",
    icon: "🔗",
    section: "API Shortcuts",
  },
];

export default async function AdminSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/admin");
  if (!user.roles.includes("ADMIN")) redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/admin"
      title="Admin Suite"
      subtitle="Admin tools, governance dashboards, and system docs."
      cards={[...ADMIN_TOOLS, ...DOCUMENTATION, ...API_SHORTCUTS, ...PROTOTYPES]}
      roles={user.roles}
      columnsClassName="grid grid-cols-1 md:grid-cols-3 gap-4"
      heroContent={<SyncStatusCard />}
    />
  );
}
