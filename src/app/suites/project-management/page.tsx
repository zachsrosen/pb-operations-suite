import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const BASE_LINKS: SuitePageCard[] = [
  // ── Action & Triage ──
  {
    href: "/dashboards/pm-action-queue",
    title: "PM Action Queue",
    description:
      "Exception-based PM workflow — only flagged deals show up. Live-mode evaluation against current pipeline data.",
    tag: "PM FLAGS",
    icon: "🚩",
    section: "Action & Triage",
  },
  {
    href: "/dashboards/my-tasks",
    title: "My Tasks",
    description: "Your open HubSpot tasks — grouped by due date, filter by type, priority, and queue.",
    tag: "TASKS",
    icon: "✅",
    section: "Action & Triage",
  },
  {
    href: "/dashboards/my-tickets",
    title: "My Tickets",
    description: "Your open Freshservice IT tickets — track status, priority, and resolution.",
    tag: "TICKETS",
    icon: "🎫",
    section: "Action & Triage",
  },

  // ── Pipeline & Workload ──
  {
    href: "/dashboards/project-management",
    title: "Project Management",
    description: "PM workload, DA backlog, stuck deals, and revenue by month across the active pipeline.",
    tag: "PM",
    icon: "📋",
    section: "Pipeline & Workload",
  },
  {
    href: "/dashboards/equipment-backlog",
    title: "Equipment Backlog",
    description: "Equipment forecasting by brand, model, and stage with location filtering.",
    tag: "EQUIPMENT",
    icon: "📦",
    section: "Pipeline & Workload",
  },

  // ── Scheduling ──
  {
    href: "/dashboards/scheduler",
    title: "Master Schedule",
    description: "Drag-and-drop scheduling calendar with crew management.",
    tag: "SCHEDULING",
    icon: "📅",
    section: "Scheduling",
    hardNavigate: true,
  },
  {
    href: "/dashboards/forecast-schedule",
    title: "Forecast Schedule",
    description: "Calendar view of all forecasted installs by stage and location with pipeline breakdown.",
    tag: "FORECAST",
    icon: "📊",
    section: "Scheduling",
  },
  {
    href: "/dashboards/site-survey-scheduler",
    title: "Site Survey Schedule",
    description: "Dedicated calendar for scheduling site surveys with Zuper integration.",
    tag: "SCHEDULING",
    icon: "🗓️",
    section: "Scheduling",
    hardNavigate: true,
  },
  {
    href: "/dashboards/construction-scheduler",
    title: "Construction Schedule",
    description: "Dedicated calendar for scheduling construction installs with Zuper integration.",
    tag: "SCHEDULING",
    icon: "🏗️",
    section: "Scheduling",
    hardNavigate: true,
  },
  {
    href: "/dashboards/inspection-scheduler",
    title: "Inspection Schedule",
    description: "Dedicated calendar for scheduling inspections with Zuper integration.",
    tag: "SCHEDULING",
    icon: "🔍",
    section: "Scheduling",
    hardNavigate: true,
  },
  {
    href: "/dashboards/map",
    title: "Jobs Map",
    description: "Map of scheduled and unscheduled work with crew positions and proximity insights.",
    tag: "MAP",
    icon: "🗺️",
    section: "Scheduling",
  },

  // ── Reviews ──
  {
    href: "/dashboards/pending-approval",
    title: "Pending Approval",
    description: "Designs awaiting customer approval with revision history and timing.",
    tag: "REVIEW",
    icon: "⏳",
    section: "Reviews",
  },
  {
    href: "/dashboards/design-revisions",
    title: "Design Revisions",
    description: "Active design revision queue with rework tracking by AHJ and PM.",
    tag: "REVIEW",
    icon: "🔄",
    section: "Reviews",
  },

  // ── Metrics ──
  {
    href: "/dashboards/survey-metrics",
    title: "Survey Metrics",
    description: "Site survey turnaround by office and surveyor, completion rates, and awaiting-survey queue.",
    tag: "METRICS",
    icon: "📈",
    section: "Metrics",
  },
  {
    href: "/dashboards/construction-metrics",
    title: "Construction Metrics",
    description: "Average start-to-completion times for construction projects across all office locations.",
    tag: "METRICS",
    icon: "📈",
    section: "Metrics",
  },
  {
    href: "/dashboards/inspection-metrics",
    title: "Inspection Metrics",
    description: "Turnaround times, first-time pass rates, and failure tracking by PB Location and AHJ.",
    tag: "METRICS",
    icon: "📈",
    section: "Metrics",
  },

  // ── Meetings ──
  {
    href: "/dashboards/idr-meeting",
    title: "IDR Meeting",
    description: "Design & Ops meeting hub for cross-functional review.",
    tag: "MEETING",
    icon: "🤝",
    section: "Meetings",
  },
  {
    href: "/dashboards/shit-show-meeting",
    title: "Shit-Show Meeting",
    description: "Critical-issue review meeting for projects requiring escalation.",
    tag: "MEETING",
    icon: "🚨",
    section: "Meetings",
  },
];

const LINKS: SuitePageCard[] = BASE_LINKS.filter(
  (l) => l.href !== "/dashboards/map" || process.env.NEXT_PUBLIC_UI_MAP_VIEW_ENABLED !== "false",
);

export default async function ProjectManagementSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/project-management");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/project-management"
      title="Project Management Suite"
      subtitle="Cross-stage project tracking, action queues, and PM workflow."
      cards={LINKS}
      roles={user.roles}
    />
  );
}
