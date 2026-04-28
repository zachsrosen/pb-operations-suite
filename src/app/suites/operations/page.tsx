import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const BASE_LINKS: SuitePageCard[] = [
  // ── Scheduling & Planning ──
  {
    href: "/dashboards/scheduler",
    title: "Master Schedule",
    description: "Drag-and-drop scheduling calendar with crew management.",
    tag: "SCHEDULING",
    icon: "📅",
    section: "Scheduling & Planning",
    hardNavigate: true,
  },
  {
    href: "/dashboards/map",
    title: "Jobs Map",
    description: "Map of scheduled and unscheduled work with crew positions and proximity insights.",
    tag: "MAP",
    icon: "🗺️",
    section: "Scheduling & Planning",
  },
  {
    href: "/dashboards/forecast-schedule",
    title: "Forecast Schedule",
    description: "Calendar view of all forecasted installs by stage and location with pipeline breakdown.",
    tag: "FORECAST",
    icon: "📊",
    section: "Scheduling & Planning",
  },
  {
    href: "/dashboards/equipment-backlog",
    title: "Equipment Backlog",
    description: "Equipment forecasting by brand, model, and stage with location filtering.",
    tag: "EQUIPMENT",
    icon: "📦",
    section: "Scheduling & Planning",
  },

  // ── Site Survey ──
  {
    href: "/dashboards/site-survey-scheduler",
    title: "Site Survey Schedule",
    description: "Dedicated calendar for scheduling site surveys with Zuper integration.",
    tag: "SCHEDULING",
    icon: "🗓️",
    section: "Site Survey",
    hardNavigate: true,
  },
  {
    href: "/dashboards/site-survey",
    title: "Site Survey Execution",
    description: "Site survey scheduling, status tracking, and completion monitoring.",
    tag: "SURVEY",
    icon: "✅",
    section: "Site Survey",
  },
  {
    href: "/dashboards/survey-metrics",
    title: "Survey Metrics",
    description: "Site survey turnaround by office and surveyor, completion rates, and awaiting-survey queue.",
    tag: "METRICS",
    icon: "📈",
    section: "Site Survey",
  },

  // ── Construction ──
  {
    href: "/dashboards/construction-scheduler",
    title: "Construction Schedule",
    description: "Dedicated calendar for scheduling construction installs with Zuper integration.",
    tag: "SCHEDULING",
    icon: "🏗️",
    section: "Construction",
    hardNavigate: true,
  },
  {
    href: "/dashboards/construction",
    title: "Construction Execution",
    description: "Construction status, scheduling, and progress tracking.",
    tag: "CONSTRUCTION",
    icon: "🔨",
    section: "Construction",
  },
  {
    href: "/dashboards/construction-metrics",
    title: "Construction Completion Metrics",
    description: "Average start-to-completion times for construction projects across all office locations.",
    tag: "METRICS",
    icon: "⏱️",
    section: "Construction",
  },

  // ── Inspections ──
  {
    href: "/dashboards/inspection-scheduler",
    title: "Inspection Schedule",
    description: "Dedicated calendar for scheduling inspections with Zuper integration.",
    tag: "SCHEDULING",
    icon: "📋",
    section: "Inspections",
    hardNavigate: true,
  },
  {
    href: "/dashboards/inspections",
    title: "Inspections Execution",
    description: "Inspection status tracking and AHJ analysis.",
    tag: "INSPECTIONS",
    icon: "🔍",
    section: "Inspections",
  },
  {
    href: "/dashboards/inspection-metrics",
    title: "Inspection Metrics",
    description: "Turnaround times, first-time pass rates, and failure tracking by PB Location and AHJ.",
    tag: "METRICS",
    icon: "📊",
    section: "Inspections",
  },

  // ── Inventory & Equipment ──
  {
    href: "/dashboards/product-catalog",
    title: "Product Catalog",
    description: "Browse all equipment — modules, inverters, batteries, racking, and specs.",
    tag: "CATALOG",
    icon: "🛒",
    section: "Inventory & Equipment",
  },
  {
    href: "/dashboards/bom",
    title: "Planset BOM",
    description: "Import a planset bill of materials, edit inline, and cross-reference against catalogs.",
    tag: "BOM",
    icon: "📐",
    section: "Inventory & Equipment",
    hardNavigate: true,
  },
  {
    href: "/dashboards/submit-product",
    title: "Submit New Product",
    description: "Add a new equipment item to the catalog — fill in details or import from a datasheet with AI.",
    tag: "NEW",
    icon: "➕",
    section: "Inventory & Equipment",
  },

  // ── Catalog & Inventory ──
  {
    href: "/dashboards/inventory",
    title: "Inventory Hub",
    description: "Warehouse stock levels, receiving, and demand vs. supply gap analysis.",
    tag: "INVENTORY",
    icon: "🏭",
    section: "Catalog & Inventory",
  },
  {
    href: "/dashboards/catalog",
    title: "Catalog Management",
    description: "Manage products, sync health, pending approvals, and deduplication.",
    tag: "CATALOG",
    icon: "⚙️",
    section: "Catalog & Inventory",
  },
  {
    href: "/dashboards/product-requests-review",
    title: "Product Request Queue",
    description: "Review sales rep requests for products + adders to add to OpenSolar.",
    tag: "REVIEW",
    icon: "📥",
    section: "Catalog & Inventory",
  },
  {
    href: "/dashboards/product-comparison",
    title: "Product Catalog Comparison",
    description: "Match and link Internal, HubSpot, Zuper, and Zoho products.",
    tag: "CATALOG",
    icon: "🔗",
    section: "Catalog & Inventory",
  },

  // ── Communications ──
  {
    href: "/dashboards/comms",
    title: "Comms",
    description: "Gmail, Google Chat, and HubSpot messages with AI-assisted drafting.",
    tag: "COMMS",
    icon: "✉️",
    section: "Communications",
  },
  {
    href: "/dashboards/my-tasks",
    title: "My Tasks",
    description: "Your open HubSpot tasks — grouped by due date, filter by type, priority, and queue.",
    tag: "TASKS",
    icon: "📋",
    section: "Communications",
  },

  // ── PM Flags ──
  {
    href: "/dashboards/pm-action-queue",
    title: "PM Action Queue",
    description:
      "Exception-based PM workflow — only flagged deals show up. Round-robin assignment from HubSpot workflows or manual escalations.",
    tag: "PM FLAGS",
    icon: "🚩",
    section: "Project Management",
  },
];

const LINKS: SuitePageCard[] = BASE_LINKS.filter(
  (l) => l.href !== "/dashboards/map" || process.env.NEXT_PUBLIC_UI_MAP_VIEW_ENABLED !== "false",
);

export default async function OperationsSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/operations");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/operations"
      title="Operations Suite"
      subtitle="Scheduling, field execution, and equipment management."
      cards={LINKS}
      roles={user.roles}
    />
  );
}
