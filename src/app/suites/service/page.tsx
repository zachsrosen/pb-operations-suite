import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/service-overview",
    title: "Service Overview",
    description: "Priority queue command center — see what needs attention now.",
    tag: "OVERVIEW",
    icon: "🎯",
    section: "Service",
  },
  {
    href: "/dashboards/service-tickets",
    title: "Ticket Board",
    description: "Kanban board for HubSpot service tickets — filter, reassign, change status, and add notes.",
    tag: "TICKETS",
    icon: "🎫",
    section: "Service",
  },
  {
    href: "/dashboards/service-customers",
    title: "Customer History",
    description: "Search customers by name, email, phone, or address — see all deals, tickets, and jobs.",
    tag: "HISTORY",
    icon: "👤",
    section: "Service",
  },
  {
    href: "/dashboards/service-scheduler",
    title: "Service Schedule",
    description: "Calendar view of Zuper service visit and service revisit jobs.",
    tag: "SCHEDULING",
    icon: "📅",
    section: "Service",
  },
  {
    href: "/dashboards/service-backlog",
    title: "Service Equipment Backlog",
    description: "Service pipeline equipment forecasting by brand, model, and stage.",
    tag: "EQUIPMENT",
    icon: "📦",
    section: "Service",
  },
  {
    href: "/dashboards/service",
    title: "Service Pipeline",
    description: "Service deal tracking with stage progression and metrics.",
    tag: "PIPELINE",
    icon: "🔧",
    section: "Service",
  },
  {
    href: "/dashboards/service-catalog",
    title: "Service Catalog",
    description: "Browse service products, pricing, and availability.",
    tag: "CATALOG",
    icon: "🛒",
    section: "Service",
  },
  {
    href: "/dashboards/solar-designer?suite=service",
    title: "Solar Designer",
    description: "Solar design analysis and production modeling.",
    tag: "TOOL",
    icon: "☀️",
    section: "Tools",
  },
];

export default async function ServiceDRSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/service");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/service"
      title="Service Suite"
      subtitle="Service scheduling, equipment tracking, priority queue, and pipelines."
      cards={LINKS}
      role={user.role}
    />
  );
}
