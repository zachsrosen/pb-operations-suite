import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const salesProductRequestsEnabled = process.env.SALES_PRODUCT_REQUESTS_ENABLED === "true";

const LINKS: SuitePageCard[] = [
  ...(salesProductRequestsEnabled
    ? ([
        {
          href: "/dashboards/request-product",
          title: "Request a Product",
          description:
            "Can't find a panel, inverter, battery, or adder in OpenSolar? Request it here.",
          tag: "REQUEST",
          icon: "📦",
          section: "Tools",
        },
      ] as const satisfies readonly SuitePageCard[])
    : []),
  {
    href: "/dashboards/sales",
    title: "Sales Pipeline",
    description: "Active deals, funnel visualization, and proposal tracking.",
    tag: "SALES",
    icon: "💼",
    section: "Tools",
  },
  {
    href: "/dashboards/pricing-calculator",
    title: "Pricing Calculator",
    description: "Price solar + battery systems with PE lease value calculator and COGS breakdown.",
    tag: "PRICING",
    icon: "💲",
    section: "Tools",
  },
  {
    href: "/dashboards/adders",
    title: "Adder Catalog 🚧",
    description: "In progress — not yet ready for reps. Governed list of system adders (MPU, trenching, steep roof, etc.) with prices, shop overrides, and point-of-sale triage questions. Preview only while we complete Phase 0 inventory and OpenSolar sync.",
    tag: "IN PROGRESS",
    icon: "➕",
    section: "Tools",
  },
  {
    href: "/triage",
    title: "Adder Triage 🚧",
    description: "In progress — not yet ready for reps. Mobile questionnaire that captures system conditions at point of sale so adders land on the quote before contract. Preview only.",
    tag: "IN PROGRESS",
    icon: "📱",
    section: "Tools",
  },
  {
    href: "/estimator",
    title: "Estimator",
    description: "Customer-facing quote estimator — solar, battery, EV, and D&R.",
    tag: "ESTIMATOR",
    icon: "📝",
    section: "Tools",
  },
  {
    href: "/dashboards/site-survey-scheduler",
    title: "Site Survey Schedule",
    description: "Schedule customer site surveys.",
    tag: "SCHEDULING",
    icon: "📅",
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
      subtitle="Pipeline visibility, pricing tools, estimating, and survey scheduling."
      cards={LINKS}
      roles={user.roles}
      columnsClassName="grid grid-cols-1 md:grid-cols-2 gap-4"
    />
  );
}
