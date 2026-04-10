import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";
import { RevenueGoalTracker } from "@/components/RevenueGoalTracker";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/revenue",
    title: "Revenue",
    description: "Revenue by stage, backlog forecasts, location breakdowns, and milestone timelines.",
    tag: "REVENUE",
    icon: "💰",
    section: "Executive Views",
  },
  {
    href: "/dashboards/executive",
    title: "Executive Summary",
    description: "High-level pipeline and stage analysis with location and monthly trends.",
    tag: "SUMMARY",
    icon: "📊",
    section: "Executive Views",
  },
  {
    href: "/dashboards/executive-calendar",
    title: "Revenue Calendar",
    description: "Monthly calendar showing daily deal value of scheduled field service work.",
    tag: "REVENUE",
    icon: "📅",
    section: "Executive Views",
  },
  {
    href: "/dashboards/preconstruction-metrics",
    title: "Preconstruction Metrics",
    description: "Survey, design approval, permitting, and interconnection KPIs with 12-month trends.",
    tag: "PRECON",
    icon: "🏗️",
    section: "Executive Views",
  },
  {
    href: "/dashboards/territory-map",
    title: "Territory Map",
    description: "Colorado office territory boundaries, deal distribution, and proposed rebalancing on an interactive map.",
    tag: "MAP",
    icon: "📍",
    section: "Executive Views",
  },
  {
    href: "/dashboards/command-center",
    title: "Command Center",
    description: "Real-time executive command center with live metrics and alerts.",
    tag: "LIVE",
    icon: "🎛️",
    section: "Command & Planning",
  },
  {
    href: "/dashboards/capacity",
    title: "Capacity Planning",
    description: "Crew capacity vs. forecasted installs by location and month.",
    tag: "CAPACITY",
    icon: "📐",
    section: "Command & Planning",
  },
  {
    href: "/dashboards/locations",
    title: "Location Comparison",
    description: "Side-by-side location performance, capacity, and pipeline breakdown.",
    tag: "LOCATIONS",
    icon: "🗺️",
    section: "Command & Planning",
  },
  {
    href: "/dashboards/sales",
    title: "Sales Pipeline",
    description: "Active deals, funnel visualization, and proposal tracking.",
    tag: "SALES",
    icon: "💼",
    section: "Sales",
  },
  {
    href: "/dashboards/design-pipeline-funnel",
    title: "Design Pipeline Funnel",
    description: "Sales → Survey → DA Sent → DA Approved throughput with monthly cohorts and conversion rates.",
    tag: "PIPELINE",
    icon: "📊",
    section: "Sales",
  },
  {
    href: "/dashboards/zuper-compliance",
    title: "Zuper Compliance",
    description: "Per-user compliance scorecards and crew-composition comparisons.",
    tag: "COMPLIANCE",
    icon: "✅",
    section: "Field Performance",
  },
  {
    href: "/dashboards/forecast-accuracy",
    title: "Forecast Accuracy",
    description: "How well the forecasting model predicts reality across milestones and segments.",
    tag: "META",
    icon: "🎯",
    section: "Meta",
  },
  {
    href: "/dashboards/forecast-timeline",
    title: "Forecast Timeline",
    description: "All 10 milestone forecasts for every active project with variance tracking.",
    tag: "FORECAST",
    icon: "⏳",
    section: "Meta",
  },
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
    href: "/dashboards/office-performance/colorado-springs",
    title: "Colorado Springs",
    description: "Ambient display — pipeline, surveys, installs, inspections for Colorado Springs.",
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
];

export default async function ExecutiveSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/executive");
  const allowed = ["ADMIN", "EXECUTIVE", "OPERATIONS_MANAGER", "PROJECT_MANAGER"];
  if (!allowed.includes(user.role)) redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/executive"
      title="Executive Suite"
      subtitle="Leadership dashboards, pipeline intelligence, and executive views."
      cards={LINKS}
      role={user.role}
      heroContent={<RevenueGoalTracker />}
    />
  );
}
