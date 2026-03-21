import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/at-risk",
    title: "At-Risk Projects",
    description: "Projects with overdue milestones, stalled stages, and severity scoring.",
    tag: "AT-RISK",
    icon: "⚠️",
    section: "Risk & Quality",
  },
  {
    href: "/dashboards/qc",
    title: "QC Metrics",
    description: "Time-between-stages analytics by office and utility.",
    tag: "QC",
    icon: "✅",
    section: "Risk & Quality",
  },
  {
    href: "/dashboards/alerts",
    title: "Alerts",
    description: "Overdue installs, PE PTO risks, and capacity overload warnings.",
    tag: "ALERTS",
    icon: "🔔",
    section: "Risk & Quality",
  },
  {
    href: "/dashboards/timeline",
    title: "Timeline View",
    description: "Gantt-style timeline showing project progression and milestones.",
    tag: "TIMELINE",
    icon: "⏳",
    section: "Pipeline & Forecasting",
  },
  {
    href: "/dashboards/pipeline",
    title: "Pipeline Overview",
    description: "Full project pipeline with filters, priority scoring, and milestone tracking.",
    tag: "PIPELINE",
    icon: "📊",
    section: "Pipeline & Forecasting",
  },
  {
    href: "/dashboards/optimizer",
    title: "Pipeline Optimizer",
    description: "Identify scheduling opportunities and optimize project throughput.",
    tag: "OPTIMIZER",
    icon: "🧮",
    section: "Pipeline & Forecasting",
  },
  {
    href: "/dashboards/project-management",
    title: "Project Management",
    description: "PM workload, DA backlog, stuck deals, and revenue tracking.",
    tag: "PM",
    icon: "📋",
    section: "Management",
  },
];

export default async function IntelligenceSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/intelligence");

  const allowed = ["ADMIN", "EXECUTIVE", "OPERATIONS_MANAGER", "PROJECT_MANAGER"];
  if (!allowed.includes(user.role)) redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/intelligence"
      title="Intelligence Suite"
      subtitle="Forecast-dependent dashboards under evaluation. Will be redistributed or cut."
      cards={LINKS}
      role={user.role}
      columnsClassName="grid grid-cols-1 md:grid-cols-3 gap-4"
    />
  );
}
