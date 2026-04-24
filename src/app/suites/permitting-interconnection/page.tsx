import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";

const PERMIT_HUB_ENABLED = process.env.NEXT_PUBLIC_PERMIT_HUB_ENABLED === "true";

const LINKS: SuitePageCard[] = [
  ...(PERMIT_HUB_ENABLED
    ? [
        {
          href: "/dashboards/permit-hub",
          title: "Permit Hub",
          description:
            "Workspace for working open permit action items — aggregated AHJ context and task-based writeback.",
          tag: "HUB",
          icon: "🏛️",
          section: "Pipeline",
        } as SuitePageCard,
      ]
    : []),
  {
    href: "/dashboards/pi-overview",
    title: "P&I Overview",
    description: "Summary metrics across permitting, interconnection, and PTO pipelines.",
    tag: "OVERVIEW",
    icon: "🎯",
    section: "Pipeline",
  },
  {
    href: "/dashboards/pi-permit-action-queue",
    title: "Permit Action Queue",
    description: "Permit-only action items with ready-to-submit, resubmit, and stale detection.",
    tag: "PERMIT",
    icon: "📋",
    section: "Pipeline",
  },
  {
    href: "/dashboards/pi-ic-action-queue",
    title: "IC & PTO Action Queue",
    description: "Interconnection and PTO action items with status tracking.",
    tag: "IC/PTO",
    icon: "⚡",
    section: "Pipeline",
  },
  {
    href: "/dashboards/pi-permit-revisions",
    title: "Permit Revisions",
    description: "Permit revision queue for ready-to-resubmit and resubmitted jobs.",
    tag: "PERMIT",
    icon: "🔄",
    section: "Pipeline",
  },
  {
    href: "/dashboards/pi-ic-revisions",
    title: "IC Revisions",
    description: "Interconnection revision queue for ready-to-resubmit and resubmitted jobs.",
    tag: "IC",
    icon: "🔁",
    section: "Pipeline",
  },
  {
    href: "/dashboards/pi-metrics",
    title: "P&I Metrics",
    description: "Permits submitted/issued/pending, interconnection apps, PTO status, revenue and deal counts.",
    tag: "METRICS",
    icon: "📊",
    section: "Analytics",
  },
  {
    href: "/dashboards/pi-timeline",
    title: "Timeline & SLA",
    description: "Configurable SLA targets with AHJ/utility benchmarks and on-time distributions.",
    tag: "SLA",
    icon: "⏱️",
    section: "Analytics",
  },
  {
    href: "/dashboards/permitting-interconnection",
    title: "P&I Dept Analytics",
    description: "Combined P&I analytics, turnaround times, and action-needed views.",
    tag: "ANALYTICS",
    icon: "📉",
    section: "Analytics",
  },
  {
    href: "/dashboards/ahj-tracker",
    title: "AHJ Tracker",
    description: "Per-AHJ turnaround times, rejection rates, volume, and trending analytics.",
    tag: "AHJ",
    icon: "🏛️",
    section: "Tracking",
  },
  {
    href: "/dashboards/utility-tracker",
    title: "Utility Tracker",
    description: "Per-utility interconnection timelines, PTO tracking, and bottleneck identification.",
    tag: "UTILITY",
    icon: "🔌",
    section: "Tracking",
  },
  {
    href: "/dashboards/incentives",
    title: "Incentives",
    description: "Rebate and incentive program tracking and application status.",
    tag: "INCENTIVES",
    icon: "💵",
    section: "Programs",
  },
  {
    href: "/dashboards/pi-action-queue",
    title: "Combined Action Queue",
    description: "All pipelines in one view — permit, IC, and PTO action items.",
    tag: "COMBINED",
    icon: "📋",
    section: "Legacy Dashboards",
  },
  {
    href: "/dashboards/pi-revisions",
    title: "Combined Revisions",
    description: "All pipelines in one view — permit and IC revision queues.",
    tag: "COMBINED",
    icon: "🔄",
    section: "Legacy Dashboards",
  },
  {
    href: "/dashboards/permitting",
    title: "Permitting (Legacy)",
    description: "Original permit status tracking, submission dates, and approval monitoring.",
    tag: "LEGACY",
    icon: "📁",
    section: "Legacy Dashboards",
  },
  {
    href: "/dashboards/interconnection",
    title: "Interconnection (Legacy)",
    description: "Original utility interconnection applications, approvals, and meter installations.",
    tag: "LEGACY",
    icon: "📁",
    section: "Legacy Dashboards",
  },
];

export default async function PermittingInterconnectionSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/permitting-interconnection");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/permitting-interconnection"
      title="Permitting & Interconnection Suite"
      subtitle="Permit tracking, utility management, and SLA monitoring."
      cards={LINKS}
      roles={user.roles}
    />
  );
}
