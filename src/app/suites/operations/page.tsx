import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  // ── Scheduling & Planning ──
  {
    href: "/dashboards/scheduler",
    title: "Master Schedule",
    description: "Drag-and-drop scheduling calendar with crew management.",
    tag: "SCHEDULING",
    section: "Scheduling & Planning",
    hardNavigate: true,
  },
  {
    href: "/dashboards/forecast-schedule",
    title: "Forecast Schedule",
    description: "Calendar view of all forecasted installs by stage and location with pipeline breakdown.",
    tag: "FORECAST",
    section: "Scheduling & Planning",
  },
  {
    href: "/dashboards/equipment-backlog",
    title: "Equipment Backlog",
    description: "Equipment forecasting by brand, model, and stage with location filtering.",
    tag: "EQUIPMENT",
    section: "Scheduling & Planning",
  },

  // ── Site Survey ──
  {
    href: "/dashboards/site-survey-scheduler",
    title: "Site Survey Schedule",
    description: "Dedicated calendar for scheduling site surveys with Zuper integration.",
    tag: "SCHEDULING",
    section: "Site Survey",
    hardNavigate: true,
  },
  {
    href: "/dashboards/site-survey",
    title: "Site Survey Execution",
    description: "Site survey scheduling, status tracking, and completion monitoring.",
    tag: "SURVEY",
    section: "Site Survey",
  },
  {
    href: "/dashboards/survey-metrics",
    title: "Survey Metrics",
    description: "Site survey turnaround by office and surveyor, completion rates, and awaiting-survey queue.",
    tag: "METRICS",
    section: "Site Survey",
  },

  // ── Construction ──
  {
    href: "/dashboards/construction-scheduler",
    title: "Construction Schedule",
    description: "Dedicated calendar for scheduling construction installs with Zuper integration.",
    tag: "SCHEDULING",
    section: "Construction",
    hardNavigate: true,
  },
  {
    href: "/dashboards/construction",
    title: "Construction Execution",
    description: "Construction status, scheduling, and progress tracking.",
    tag: "CONSTRUCTION",
    section: "Construction",
  },
  {
    href: "/dashboards/construction-metrics",
    title: "Construction Completion Metrics",
    description: "Average start-to-completion times for construction projects across all office locations.",
    tag: "METRICS",
    section: "Construction",
  },

  // ── Inspections ──
  {
    href: "/dashboards/inspection-scheduler",
    title: "Inspection Schedule",
    description: "Dedicated calendar for scheduling inspections with Zuper integration.",
    tag: "SCHEDULING",
    section: "Inspections",
    hardNavigate: true,
  },
  {
    href: "/dashboards/inspections",
    title: "Inspections Execution",
    description: "Inspection status tracking and AHJ analysis.",
    tag: "INSPECTIONS",
    section: "Inspections",
  },

  // ── Inventory & Equipment ──
  {
    href: "#",
    title: "Product Catalog",
    description: "Browse all equipment — modules, inverters, batteries, racking, and specs. (Incoming)",
    tag: "INCOMING",
    tagColor: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    section: "Inventory & Equipment",
    disabled: true,
  },
  {
    href: "/dashboards/bom",
    title: "Planset BOM",
    description: "Import a planset bill of materials, edit inline, and cross-reference against catalogs.",
    tag: "BOM",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    section: "Inventory & Equipment",
    hardNavigate: true,
  },
  {
    href: "/dashboards/submit-product",
    title: "Submit New Product",
    description: "Add a new equipment item to the catalog — fill in details or import from a datasheet with AI.",
    tag: "NEW",
    tagColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    section: "Inventory & Equipment",
  },

  // ── Admin ──
  {
    href: "/dashboards/inventory",
    title: "Inventory Hub",
    description: "Warehouse stock levels, receiving, and demand vs. supply gap analysis.",
    tag: "INVENTORY",
    section: "Admin",
  },
  {
    href: "/dashboards/catalog",
    title: "Catalog Management",
    description: "Manage products, sync health, pending approvals, and deduplication.",
    tag: "CATALOG",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    section: "Admin",
  },
  {
    href: "/dashboards/product-comparison",
    title: "Product Catalog Comparison",
    description: "Match and link Internal, HubSpot, Zuper, and Zoho products.",
    tag: "CATALOG",
    tagColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    section: "Admin",
  },
];

export default async function OperationsSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/operations");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/operations"
      title="Operations Suite"
      subtitle="Scheduling, field execution, and equipment management."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-orange-500/50"
      tagColorClass="bg-blue-500/20 text-blue-400 border-blue-500/30"
    />
  );
}
