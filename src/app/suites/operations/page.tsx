import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/scheduler",
    title: "Master Schedule",
    description: "Drag-and-drop scheduling calendar with crew management.",
    tag: "SCHEDULING",
    section: "Scheduling",
  },
  {
    href: "/dashboards/site-survey-scheduler",
    title: "Site Survey Schedule",
    description: "Dedicated calendar for scheduling site surveys with Zuper integration.",
    tag: "SCHEDULING",
    section: "Scheduling",
  },
  {
    href: "/dashboards/construction-scheduler",
    title: "Construction Schedule",
    description: "Dedicated calendar for scheduling construction installs with Zuper integration.",
    tag: "SCHEDULING",
    section: "Scheduling",
  },
  {
    href: "/dashboards/inspection-scheduler",
    title: "Inspection Schedule",
    description: "Dedicated calendar for scheduling inspections with Zuper integration.",
    tag: "SCHEDULING",
    section: "Scheduling",
  },
  {
    href: "/dashboards/dnr-scheduler",
    title: "D&R Schedule",
    description: "Calendar view of Zuper detach, reset, and D&R inspection jobs.",
    tag: "SCHEDULING",
    section: "Scheduling",
  },
  {
    href: "/dashboards/timeline",
    title: "Timeline View",
    description: "Gantt-style timeline showing project progression and milestones.",
    tag: "PLANNING",
    section: "Planning",
  },
  {
    href: "/dashboards/equipment-backlog",
    title: "Equipment Backlog",
    description: "Equipment forecasting by brand, model, and stage with location filtering.",
    tag: "EQUIPMENT",
    section: "Inventory & Equipment",
  },
  {
    href: "/dashboards/inventory",
    title: "Inventory Hub",
    description: "Warehouse stock levels, receiving, and demand vs. supply gap analysis.",
    tag: "INVENTORY",
    section: "Inventory & Equipment",
  },
];

export default async function OperationsSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/operations");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/operations"
      title="Operations Suite"
      subtitle="Core operations and scheduling dashboards."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-orange-500/50"
      tagColorClass="bg-blue-500/20 text-blue-400 border-blue-500/30"
    />
  );
}
