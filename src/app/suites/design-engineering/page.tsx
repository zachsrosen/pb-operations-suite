import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/de-overview",
    title: "D&E Overview",
    description: "Summary metrics, status funnel, and action items across all design & engineering.",
    tag: "OVERVIEW",
    section: "Design Pipeline",
  },
  {
    href: "/dashboards/plan-review",
    title: "Plan Review Queue",
    description: "Projects in initial or final design review with full detail tracking.",
    tag: "REVIEW",
    section: "Design Pipeline",
  },
  {
    href: "/dashboards/pending-approval",
    title: "Pending Design Approval",
    description: "Projects awaiting DA/layout approval — submission tracking and wait times.",
    tag: "APPROVAL",
    section: "Design Pipeline",
  },
  {
    href: "/dashboards/design-revisions",
    title: "Design Revisions",
    description: "Projects in revision cycles — rejection reasons, revision counts, and turnaround.",
    tag: "REVISIONS",
    section: "Design Pipeline",
  },
  {
    href: "/dashboards/de-metrics",
    title: "D&E Metrics",
    description: "Approvals sent/approved/pending, designs drafted/stamped/completed, revenue and deal counts.",
    tag: "METRICS",
    section: "Analytics",
  },
  {
    href: "/dashboards/clipping-analytics",
    title: "Clipping & System Analytics",
    description: "Seasonal clipping detection, equipment performance trends, and system review flags.",
    tag: "CLIPPING",
    section: "Analytics",
  },
  {
    href: "/dashboards/ahj-requirements",
    title: "AHJ Design Requirements",
    description: "AHJ-specific design rules, rejection patterns, and turnaround benchmarks.",
    tag: "AHJ",
    section: "Reference",
  },
  {
    href: "/dashboards/utility-design-requirements",
    title: "Utility Design Requirements",
    description: "Utility-specific design constraints, rules, and specifications.",
    tag: "UTILITY",
    section: "Reference",
  },
  {
    href: "/dashboards/solar-surveyor",
    title: "Solar Surveyor",
    description: "Interactive solar site survey prototype tool.",
    tag: "PROTOTYPE",
    tagColor: "bg-pink-500/20 text-pink-400 border-pink-500/30",
    section: "Tools",
  },
  {
    href: "/dashboards/design",
    title: "Design & Engineering (Legacy)",
    description: "Original design progress tracking, engineering approvals, and plan sets.",
    tag: "LEGACY",
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
      hoverBorderClass="hover:border-indigo-500/50"
      tagColorClass="bg-indigo-500/20 text-indigo-400 border-indigo-500/30"
    />
  );
}
