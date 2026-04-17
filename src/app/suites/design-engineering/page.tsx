import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/de-overview",
    title: "D&E Overview",
    description: "Summary metrics, status funnel, and action items across all design & engineering.",
    tag: "OVERVIEW",
    icon: "🎯",
    section: "Design Pipeline",
  },
  {
    href: "/dashboards/plan-review",
    title: "Plan Review Queue",
    description: "Projects in initial or final design review with full detail tracking.",
    tag: "REVIEW",
    icon: "📝",
    section: "Design Pipeline",
  },
  {
    href: "/dashboards/pending-approval",
    title: "Design Approval Queue",
    description: "Action queue: survey done needing design, designs ready to send, and DAs awaiting customer approval.",
    tag: "QUEUE",
    icon: "✏️",
    section: "Design Pipeline",
  },
  {
    href: "/dashboards/design-revisions",
    title: "Design Revisions",
    description: "Projects in revision cycles — rejection reasons, revision counts, and turnaround.",
    tag: "REVISIONS",
    icon: "🔄",
    section: "Design Pipeline",
  },
  {
    href: "/dashboards/design-pipeline-funnel",
    title: "Design Pipeline Funnel",
    description: "Sales-to-DA throughput funnel — shows upstream volume driving design workload.",
    tag: "CROSS-REF",
    icon: "📊",
    section: "Design Pipeline",
  },
  {
    href: "/dashboards/de-metrics",
    title: "D&E Metrics",
    description: "DA turnaround and revisions by office, approval pipeline, designer productivity, and monthly trends.",
    tag: "METRICS",
    icon: "📊",
    section: "Analytics",
  },
  {
    href: "/dashboards/clipping-analytics",
    title: "Clipping & System Analytics",
    description: "Seasonal clipping detection, equipment performance trends, and system review flags.",
    tag: "CLIPPING",
    icon: "⚡",
    section: "Analytics",
  },
  {
    href: "/dashboards/design-engineering",
    title: "D&E Dept Analytics",
    description: "Cross-state design analytics, status breakdowns, and ops clarification queue.",
    tag: "ANALYTICS",
    icon: "📉",
    section: "Analytics",
  },
  {
    href: "/dashboards/ahj-requirements",
    title: "AHJ Design Requirements",
    description: "AHJ-specific design rules, rejection patterns, and turnaround benchmarks.",
    tag: "AHJ",
    icon: "📖",
    section: "Reference",
  },
  {
    href: "/dashboards/utility-design-requirements",
    title: "Utility Design Requirements",
    description: "Utility-specific design constraints, rules, and specifications.",
    tag: "UTILITY",
    icon: "🔌",
    section: "Reference",
  },
  {
    href: "/dashboards/solar-surveyor?suite=de",
    title: "Solar Surveyor",
    description: "Interactive solar site survey tool.",
    tag: "TOOL",
    icon: "☀️",
    section: "Tools",
  },
  {
    href: "/dashboards/solar-designer?suite=de",
    title: "Solar Designer",
    description: "Solar design analysis and production modeling.",
    tag: "TOOL",
    icon: "☀️",
    section: "Tools",
  },
  {
    href: "/dashboards/idr-meeting",
    title: "Design & Ops Meeting Hub",
    description: "Design/ops meeting review queue with auto-populated projects, inline editing, and HubSpot sync",
    tag: "MEETING",
    icon: "📋",
    section: "Tools",
  },
  {
    href: "/dashboards/design",
    title: "Design & Engineering (Legacy)",
    description: "Original design progress tracking, engineering approvals, and plan sets.",
    tag: "LEGACY",
    icon: "📁",
    section: "Legacy Dashboards",
  },
];

export default async function DesignEngineeringSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/design-engineering");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/design-engineering"
      title="Design & Engineering Suite"
      subtitle="Design review, system analytics, and engineering reference tools."
      cards={LINKS}
      role={user.role}
    />
  );
}
