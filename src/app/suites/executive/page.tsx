import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/revenue",
    title: "Revenue",
    description: "Revenue by stage, backlog forecasts, location breakdowns, and milestone timelines.",
    tag: "REVENUE",
    tagColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    section: "Executive Views",
  },
  {
    href: "/dashboards/executive",
    title: "Executive Summary",
    description: "High-level pipeline and stage analysis with location and monthly trends.",
    tag: "SUMMARY",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    section: "Executive Views",
  },
  {
    href: "/dashboards/command-center",
    title: "Command Center",
    description: "Real-time executive command center with live metrics and alerts.",
    tag: "LIVE",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
    section: "Executive Views",
  },
  {
    href: "/dashboards/capacity",
    title: "Capacity Planning",
    description: "Crew capacity vs. forecasted installs by location and month.",
    tag: "CAPACITY",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    section: "Executive Views",
  },
  {
    href: "/dashboards/locations",
    title: "Location Comparison",
    description: "Side-by-side location performance, capacity, and pipeline breakdown.",
    tag: "LOCATIONS",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    section: "Executive Views",
  },
  {
    href: "/dashboards/executive-calendar",
    title: "Revenue Calendar",
    description: "Monthly calendar showing daily deal value of scheduled field service work.",
    tag: "REVENUE",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "Executive Views",
  },
  {
    href: "/dashboards/sales",
    title: "Sales Pipeline",
    description: "Active deals, funnel visualization, and proposal tracking.",
    tag: "SALES",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    section: "Sales",
  },
  {
    href: "/dashboards/pe",
    title: "PE Dashboard",
    description: "Participate Energy milestone tracking and compliance monitoring.",
    tag: "PE",
    tagColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    section: "Programs",
  },
  {
    href: "/dashboards/zuper-compliance",
    title: "Zuper Compliance",
    description: "Per-user compliance scorecards and crew-composition comparisons.",
    tag: "COMPLIANCE",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
    section: "Field Performance",
  },
  {
    href: "/dashboards/forecast-accuracy",
    title: "Forecast Accuracy",
    description: "How well the forecasting model predicts reality across milestones and segments.",
    tag: "META",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    section: "Meta",
  },
];

export default async function ExecutiveSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/executive");
  const allowed = ["ADMIN", "OWNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER"];
  if (!allowed.includes(user.role)) redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/executive"
      title="Executive Suite"
      subtitle="Leadership dashboards, pipeline intelligence, and executive views."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-orange-500/50"
      columnsClassName="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
    />
  );
}
