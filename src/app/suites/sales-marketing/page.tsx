import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/pipeline",
    title: "Pipeline Overview",
    description: "Full pipeline with filters, priority scoring, and milestone tracking.",
    tag: "PIPELINE",
    icon: "📊",
    section: "Pipeline & Forecasting",
  },
  {
    href: "/dashboards/sales",
    title: "Sales Pipeline",
    description: "Active deals, funnel visualization, and proposal tracking.",
    tag: "SALES",
    icon: "💼",
    section: "Pipeline & Forecasting",
  },
  {
    href: "/dashboards/deals",
    title: "Deals",
    description: "All active deals across pipelines.",
    tag: "DEALS",
    icon: "🤝",
    section: "Pipeline & Forecasting",
  },
  {
    href: "/dashboards/revenue",
    title: "Revenue",
    description: "Revenue trends and goal tracking.",
    tag: "REVENUE",
    icon: "💰",
    section: "Pipeline & Forecasting",
  },
  {
    href: "/dashboards/forecast-timeline",
    title: "Forecast Timeline",
    description: "Forward-looking pipeline projections.",
    tag: "FORECAST",
    icon: "📈",
    section: "Pipeline & Forecasting",
  },
  {
    href: "/dashboards/forecast-accuracy",
    title: "Forecast Accuracy",
    description: "Historical forecast vs actual performance.",
    tag: "ACCURACY",
    icon: "🎯",
    section: "Pipeline & Forecasting",
  },
  {
    href: "/dashboards/pricing-calculator",
    title: "Pricing Calculator",
    description: "Price solar + battery systems with PE lease value calculator and COGS breakdown.",
    tag: "PRICING",
    icon: "💲",
    section: "Tools",
  },
];

export default async function SalesMarketingSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/sales-marketing");

  const allowed = ["ADMIN", "EXECUTIVE", "SALES_MANAGER", "SALES", "MARKETING"];
  if (!user.roles.some((r) => allowed.includes(r))) redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/sales-marketing"
      title="Sales & Marketing Suite"
      subtitle="Pipeline visibility, revenue tracking, forecasting, and marketing analytics."
      cards={LINKS}
      roles={user.roles}
      columnsClassName="grid grid-cols-1 md:grid-cols-3 gap-4"
    />
  );
}
