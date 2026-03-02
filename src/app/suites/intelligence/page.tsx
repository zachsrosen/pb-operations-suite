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
    href: "/dashboards/timeline",
    title: "Timeline View",
    description: "Gantt-style timeline showing project progression and milestones.",
    tag: "TIMELINE",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    section: "Pipeline & Forecasting",
  },
  {
    href: "/dashboards/pipeline",
    title: "Pipeline Overview",
    description: "Full project pipeline with filters, priority scoring, and milestone tracking.",
    tag: "PIPELINE",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "Pipeline & Forecasting",
  },
  {
    href: "/dashboards/optimizer",
    title: "Pipeline Optimizer",
    description: "Identify scheduling opportunities and optimize project throughput.",
    tag: "OPTIMIZER",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    section: "Pipeline & Forecasting",
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
      subtitle="Forecast-dependent dashboards under evaluation. Will be redistributed or cut."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-cyan-500/50"
      columnsClassName="grid grid-cols-1 md:grid-cols-3 gap-4"
    />
  );
}
