import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/at-risk",
    title: "At-Risk Projects",
    description: "Projects with overdue milestones, stalled stages, and severity scoring.",
    tag: "AT-RISK",
    tagColor: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    section: "Risk & Quality",
  },
  {
    href: "/dashboards/qc",
    title: "QC Metrics",
    description: "Time-between-stages analytics by office and utility.",
    tag: "QC",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    section: "Risk & Quality",
  },
  {
    href: "/dashboards/alerts",
    title: "Alerts",
    description: "Overdue installs, PE PTO risks, and capacity overload warnings.",
    tag: "ALERTS",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
    section: "Risk & Quality",
  },
  {
    href: "/dashboards/pipeline",
    title: "Pipeline Overview",
    description: "Full project pipeline with filters, priority scoring, and milestone tracking.",
    tag: "PIPELINE",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "Pipeline & Capacity",
  },
  {
    href: "/dashboards/optimizer",
    title: "Pipeline Optimizer",
    description: "Identify scheduling opportunities and optimize project throughput.",
    tag: "OPTIMIZER",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    section: "Pipeline & Capacity",
  },
  {
    href: "/dashboards/capacity",
    title: "Capacity Planning",
    description: "Crew capacity vs. forecasted installs across all locations.",
    tag: "CAPACITY",
    tagColor: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
    section: "Pipeline & Capacity",
  },
  {
    href: "/dashboards/pe",
    title: "PE Dashboard",
    description: "Participate Energy milestone tracking and compliance monitoring.",
    tag: "PE",
    tagColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    section: "Pipeline & Capacity",
  },
  {
    href: "/dashboards/sales",
    title: "Sales Pipeline",
    description: "Active deals, funnel visualization, and proposal tracking.",
    tag: "SALES",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    section: "Pipeline & Capacity",
  },
  {
    href: "/dashboards/project-management",
    title: "Project Management",
    description: "PM workload, DA backlog, stuck deals, and revenue tracking.",
    tag: "PM",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "Department Analytics",
  },
  {
    href: "/dashboards/design-engineering",
    title: "Design & Engineering",
    description: "Cross-state design analytics, status breakdowns, and ops clarification queue.",
    tag: "D&E",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    section: "Department Analytics",
  },
  {
    href: "/dashboards/permitting-interconnection",
    title: "Permitting & Interconnection",
    description: "Combined P&I analytics, turnaround times, and action-needed views.",
    tag: "P&I",
    tagColor: "bg-teal-500/20 text-teal-400 border-teal-500/30",
    section: "Department Analytics",
  },
];

export default async function IntelligenceSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/intelligence");

  const allowed = ["ADMIN", "OWNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER"];
  if (!allowed.includes(user.role)) redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/intelligence"
      title="Intelligence Suite"
      subtitle="Risk analysis, QC metrics, capacity planning, and pipeline analytics."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-cyan-500/50"
      columnsClassName="grid grid-cols-1 md:grid-cols-3 gap-4"
    />
  );
}
