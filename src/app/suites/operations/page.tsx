import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import { isSchedulerV2Enabled } from "@/lib/scheduler-v2/flag";

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
    href: "/dashboards/crew-schedule",
    title: "Crew Schedule",
    description: "See where every crew member is working each day across all locations.",
    tag: "SCHEDULING",
    tagColor: "blue",
    icon: "👥",
    section: "Scheduling & Planning",
  },
  {
    href: "/dashboards/atlas",
    title: "Atlas",
    description: "Mapbox map of jobs, deals, and customers with AHJ, utility, and territory overlays.",
    tag: "MAP",
    icon: "🌐",
    section: "Scheduling & Planning",
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
  {
    href: "/dashboards/eagleview-orders",
    title: "EagleView Orders",
    description: "Search deals or tickets and order EagleView TrueDesign aerial imagery.",
    tag: "EAGLEVIEW",
    icon: "🛰️",
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
  {
    href: "/dashboards/pipeline-tracker",
    title: "Pipeline Tracker",
    description: "All deals in site survey, construction, and inspection — sorted by days in stage.",
    tag: "OPS",
    icon: "📊",
    section: "Construction",
  },
  {
    href: "/dashboards/pe-pipeline",
    title: "PE Pipeline Tracker",
    description: "PE deals stuck in construction and inspection — sorted by days in stage.",
    tag: "PE",
    icon: "🚧",
    section: "Construction",
  },
  {
    href: "/dashboards/bottlenecks",
    title: "Bottleneck Monitor",
    description: "Deals stuck past stage thresholds — age, volume, and flow per pipeline stage.",
    tag: "OPS",
    icon: "🚧",
    section: "Construction",
  },
  {
    href: "/dashboards/project-pipeline-funnel",
    title: "Project Pipeline Funnel",
    description: "Full Sales-Closed → PTO funnel — backlog, RTB bench & runway, incoming forecast, and median stage times.",
    tag: "OPS",
    icon: "🏗️",
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

  // ── Office Performance ──
  {
    href: "/dashboards/office-performance/all",
    title: "All Locations",
    description: "Side-by-side overview — surveys, installs, inspections across all 5 locations.",
    tag: "OFFICE",
    icon: "🌐",
    section: "Office Performance",
  },
  {
    href: "/dashboards/office-performance/westminster",
    title: "Westminster",
    description: "Ambient display — pipeline, surveys, installs, inspections for Westminster.",
    tag: "OFFICE",
    icon: "🏢",
    section: "Office Performance",
  },
  {
    href: "/dashboards/office-performance/centennial",
    title: "Centennial",
    description: "Ambient display — pipeline, surveys, installs, inspections for Centennial.",
    tag: "OFFICE",
    icon: "🏢",
    section: "Office Performance",
  },
  {
    href: "/dashboards/office-performance/pueblo",
    title: "Pueblo",
    description: "Ambient display — pipeline, surveys, installs, inspections for Pueblo.",
    tag: "OFFICE",
    icon: "🏢",
    section: "Office Performance",
  },
  {
    href: "/dashboards/office-performance/san-luis-obispo",
    title: "San Luis Obispo",
    description: "Ambient display — pipeline, surveys, installs, inspections for San Luis Obispo.",
    tag: "OFFICE",
    icon: "🏢",
    section: "Office Performance",
  },
  {
    href: "/dashboards/office-performance/camarillo",
    title: "Camarillo",
    description: "Ambient display — pipeline, surveys, installs, inspections for Camarillo.",
    tag: "OFFICE",
    icon: "🏢",
    section: "Office Performance",
  },

  // ── PE Tools ──
  {
    href: "/dashboards/pe-photo-builder",
    title: "PE Photo Builder",
    description: "Drop install photos + a project code to build a labeled Photos-per-Policy PDF and flag missing shots.",
    tag: "PE",
    icon: "📸",
    section: "PE Tools",
  },

  // ── Meetings ──
  {
    href: "/dashboards/idr-meeting",
    title: "Design & Ops Meeting Hub",
    description: "Design/ops meeting review queue with auto-populated projects, inline editing, and HubSpot sync.",
    tag: "MEETING",
    icon: "📋",
    section: "Meetings",
  },

  // ── On-Call ──
  {
    href: "/dashboards/on-call",
    title: "On-Call Electricians",
    description: "Weekly rotation for after-hours service coverage across California and Colorado. Mon-Fri 6-10pm + Sat-Sun 8am-12pm. Log every emergency call from here.",
    tag: "ON-CALL",
    icon: "📞",
    section: "On-Call",
  },

  // ── Reference ──
  // Workflow Map is dark-launched: only shown when the UI flag is "true".
  ...(process.env.NEXT_PUBLIC_UI_WORKFLOW_MAP_ENABLED === "true"
    ? [
        {
          href: "/dashboards/workflow-map",
          title: "Workflow Map",
          description: "Live map of HubSpot automation + SOPs.",
          tag: "WORKFLOW",
          icon: "🔀",
          section: "Reference",
        } satisfies SuitePageCard,
      ]
    : []),

];

// Scheduler v2 (beta) — appended at runtime when the SystemConfig flag is on
// (prod Vercel env space is full, so this gate is DB-driven, not env-driven).
const SCHEDULER_V2_CARD: SuitePageCard = {
  href: "/dashboards/scheduler-v2",
  title: "Dispatch Board (v2)",
  description: "Crew-row dispatch board — beta.",
  tag: "BETA",
  tagColor: "blue",
  icon: "🗂️",
  section: "Scheduling & Planning",
};

// Roles entitled to access /dashboards/pe-photo-builder (mirrors roles.ts allowlist).
// OPERATIONS, OPERATIONS_MANAGER, and TECH_OPS are intentionally excluded — they see
// the Operations suite but cannot reach that route, so we hide the card here to avoid
// a silent 403 dead-end.
const PE_PHOTO_BUILDER_ROLES = ["ADMIN", "EXECUTIVE", "PROJECT_MANAGER"] as const;

export default async function OperationsSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/operations");

  const canSeePePhotoBuilder = user.roles.some((r) =>
    (PE_PHOTO_BUILDER_ROLES as readonly string[]).includes(r),
  );

  const links = BASE_LINKS.filter((l) => {
    if (l.href === "/dashboards/map" && process.env.NEXT_PUBLIC_UI_MAP_VIEW_ENABLED === "false") {
      return false;
    }
    if (l.href === "/dashboards/pe-photo-builder" && !canSeePePhotoBuilder) {
      return false;
    }
    return true;
  });

  const cards = (await isSchedulerV2Enabled()) ? [...links, SCHEDULER_V2_CARD] : links;

  return (
    <SuitePageShell
      currentSuiteHref="/suites/operations"
      title="Operations Suite"
      subtitle="Scheduling, field execution, and equipment management."
      cards={cards}
      roles={user.roles}
    />
  );
}
