import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const BASE_LINKS: SuitePageCard[] = [
  // Daily Operations — the triage/dispatch surface a service coordinator lives in
  {
    href: "/dashboards/service-overview",
    title: "Service Overview",
    description: "Priority queue command center — see what needs attention now.",
    tag: "OVERVIEW",
    icon: "🎯",
    section: "Daily Operations",
  },
  {
    href: "/dashboards/service-tickets",
    title: "Ticket Board",
    description: "Kanban board for HubSpot service tickets — filter, reassign, change status, and add notes.",
    tag: "TICKETS",
    icon: "🎫",
    section: "Daily Operations",
  },
  {
    href: "/dashboards/service-scheduler",
    title: "Service Schedule",
    description: "Calendar view of Zuper service visit and service revisit jobs.",
    tag: "SCHEDULING",
    icon: "📅",
    section: "Daily Operations",
  },
  {
    href: "/dashboards/service-unscheduled",
    title: "Unscheduled Jobs",
    description: "List of every Zuper job awaiting a scheduled date, with age-based urgency flags.",
    tag: "BACKLOG",
    icon: "⏳",
    section: "Daily Operations",
  },
  {
    href: "/dashboards/map?types=service",
    title: "Jobs Map",
    description: "Map of scheduled and unscheduled work with crew positions and proximity insights.",
    tag: "MAP",
    icon: "🗺️",
    section: "Daily Operations",
  },
  // Customer & Equipment — research/lookup surface for customer history and equipment context
  {
    href: "/dashboards/service-customers",
    title: "Customer History",
    description: "Search customers by name, email, phone, or address — see all deals, tickets, and jobs.",
    tag: "HISTORY",
    icon: "👤",
    section: "Customer & Equipment",
  },
  {
    href: "/dashboards/service",
    title: "Service Pipeline",
    description: "Service deal tracking with stage progression and metrics.",
    tag: "PIPELINE",
    icon: "🔧",
    section: "Customer & Equipment",
  },
  {
    href: "/dashboards/service-backlog",
    title: "Service Equipment Backlog",
    description: "Service pipeline equipment forecasting by brand, model, and stage.",
    tag: "EQUIPMENT",
    icon: "📦",
    section: "Customer & Equipment",
  },
  {
    href: "/dashboards/service-catalog",
    title: "Service Catalog",
    description: "Browse service products, pricing, and availability.",
    tag: "CATALOG",
    icon: "🛒",
    section: "Customer & Equipment",
  },
  // Tools — adjunct tools that support service work
  {
    href: "/dashboards/solar-surveyor?suite=service",
    title: "Solar Surveyor",
    description: "Survey-based solar project design, revisions, and equipment layout.",
    tag: "TOOL",
    icon: "☀️",
    section: "Tools",
  },
  {
    href: "/dashboards/tsrf-calculator",
    title: "TSRF Peak Power Calculator",
    description: "Estimate peak power output from TSRF, module specs, and site conditions.",
    tag: "TOOL",
    icon: "⚡",
    section: "Tools",
  },
];

const LINKS: SuitePageCard[] = BASE_LINKS.filter(
  (l) => !l.href.startsWith("/dashboards/map") || process.env.NEXT_PUBLIC_UI_MAP_VIEW_ENABLED !== "false",
);

export default async function ServiceDRSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/service");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/service"
      title="Service Suite"
      subtitle="Service scheduling, equipment tracking, priority queue, and pipelines."
      cards={LINKS}
      roles={user.roles}
    />
  );
}
