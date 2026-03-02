import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/pi-overview",
    title: "P&I Overview",
    description: "Summary metrics across permitting, interconnection, and PTO pipelines.",
    tag: "OVERVIEW",
    section: "Pipeline",
  },
  {
    href: "/dashboards/pi-metrics",
    title: "P&I Metrics",
    description: "Permits submitted/issued/pending, interconnection apps, PTO status, revenue and deal counts.",
    tag: "METRICS",
    section: "Analytics",
  },
  {
    href: "/dashboards/pi-permit-action-queue",
    title: "Permit Action Queue",
    description: "Permit-only action items with ready-to-submit, resubmit, and stale detection.",
    tag: "PERMIT",
    section: "Pipeline",
  },
  {
    href: "/dashboards/pi-ic-action-queue",
    title: "IC & PTO Action Queue",
    description: "Interconnection and PTO action items with status tracking.",
    tag: "IC/PTO",
    section: "Pipeline",
  },
  {
    href: "/dashboards/pi-permit-revisions",
    title: "Permit Revisions",
    description: "Permit revision queue for ready-to-resubmit and resubmitted jobs.",
    tag: "PERMIT",
    section: "Pipeline",
  },
  {
    href: "/dashboards/pi-ic-revisions",
    title: "IC Revisions",
    description: "Interconnection revision queue for ready-to-resubmit and resubmitted jobs.",
    tag: "IC",
    section: "Pipeline",
  },
  {
    href: "/dashboards/ahj-tracker",
    title: "AHJ Tracker",
    description: "Per-AHJ turnaround times, rejection rates, volume, and trending analytics.",
    tag: "AHJ",
    section: "Tracking",
  },
  {
    href: "/dashboards/utility-tracker",
    title: "Utility Tracker",
    description: "Per-utility interconnection timelines, PTO tracking, and bottleneck identification.",
    tag: "UTILITY",
    section: "Tracking",
  },
  {
    href: "/dashboards/pi-timeline",
    title: "Timeline & SLA",
    description: "Configurable SLA targets with AHJ/utility benchmarks and on-time distributions.",
    tag: "SLA",
    section: "Analytics",
  },
  {
    href: "/dashboards/permitting-interconnection",
    title: "P&I Dept Analytics",
    description: "Combined P&I analytics, turnaround times, and action-needed views.",
    tag: "ANALYTICS",
    tagColor: "bg-teal-500/20 text-teal-400 border-teal-500/30",
    section: "Analytics",
  },
  {
    href: "/dashboards/incentives",
    title: "Incentives",
    description: "Rebate and incentive program tracking and application status.",
    tag: "INCENTIVES",
    tagColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    section: "Programs",
  },
  {
    href: "/dashboards/pi-action-queue",
    title: "Combined Action Queue",
    description: "All pipelines in one view — permit, IC, and PTO action items.",
    tag: "COMBINED",
    section: "Legacy Dashboards",
  },
  {
    href: "/dashboards/pi-revisions",
    title: "Combined Revisions",
    description: "All pipelines in one view — permit and IC revision queues.",
    tag: "COMBINED",
    section: "Legacy Dashboards",
  },
  {
    href: "/dashboards/permitting",
    title: "Permitting (Legacy)",
    description: "Original permit status tracking, submission dates, and approval monitoring.",
    tag: "LEGACY",
    section: "Legacy Dashboards",
  },
  {
    href: "/dashboards/interconnection",
    title: "Interconnection (Legacy)",
    description: "Original utility interconnection applications, approvals, and meter installations.",
    tag: "LEGACY",
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
      role={user.role}
      hoverBorderClass="hover:border-cyan-500/50"
      tagColorClass="bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
    />
  );
}
