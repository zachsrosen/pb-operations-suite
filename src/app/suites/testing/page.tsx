import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/at-risk",
    title: "At-Risk Projects",
    description: "Projects with overdue milestones, stalled stages, and severity scoring.",
    tag: "AT-RISK",
    icon: "!",
    section: "Intelligence",
  },
  {
    href: "/dashboards/qc",
    title: "QC Metrics",
    description: "Time-between-stages analytics by office and utility.",
    tag: "QC",
    icon: "QC",
    section: "Intelligence",
  },
  {
    href: "/dashboards/alerts",
    title: "Alerts",
    description: "Overdue installs, PE PTO risks, and capacity overload warnings.",
    tag: "ALERTS",
    icon: "A",
    section: "Intelligence",
  },
  {
    href: "/dashboards/timeline",
    title: "Timeline View",
    description: "Gantt-style timeline showing project progression and milestones.",
    tag: "TIMELINE",
    icon: "T",
    section: "Intelligence",
  },
  {
    href: "/dashboards/pipeline",
    title: "Pipeline Overview",
    description: "Full project pipeline with filters, priority scoring, and milestone tracking.",
    tag: "PIPELINE",
    icon: "P",
    section: "Intelligence",
  },
  {
    href: "/dashboards/optimizer",
    title: "Pipeline Optimizer",
    description: "Identify scheduling opportunities and optimize project throughput.",
    tag: "OPTIMIZER",
    icon: "O",
    section: "Intelligence",
  },
  {
    href: "/dashboards/project-management",
    title: "Project Management",
    description: "PM workload, DA backlog, stuck deals, and revenue tracking.",
    tag: "PM",
    icon: "PM",
    section: "Intelligence",
  },
  {
    href: "/dashboards/ai",
    title: "AI Skills",
    description: "AI-powered tools and assistants that are still under operational review.",
    tag: "AI",
    icon: "AI",
    section: "Tools Under Test",
  },
  {
    href: "/dashboards/product-comparison",
    title: "Product Catalog Comparison",
    description: "Match and link Internal, HubSpot, Zuper, and Zoho products.",
    tag: "CATALOG",
    icon: "PC",
    section: "Tools Under Test",
  },
  {
    href: "/dashboards/inventory",
    title: "Inventory Hub",
    description: "Warehouse stock levels, receiving, and demand vs. supply gap analysis.",
    tag: "INVENTORY",
    icon: "I",
    section: "Tools Under Test",
  },
  {
    href: "/dashboards/inventory/cost-audit",
    title: "Cost Audit",
    description: "Cross-reference Zoho item costs against vendor bill line items to surface stale or wrong purchase rates.",
    tag: "COST",
    icon: "$",
    section: "Tools Under Test",
  },
  {
    href: "/dashboards/inventory/sync-health",
    title: "Sync Health",
    description: "Rollup of catalog drift across InternalProduct, HubSpot, Zuper, and Zoho. Tiles drill into Product Comparison.",
    tag: "DRIFT",
    icon: "✓",
    section: "Tools Under Test",
  },
  {
    href: "/dashboards/mobile",
    title: "Mobile Dashboard",
    description: "Touch-optimized view for field teams and fast project lookup.",
    tag: "MOBILE",
    icon: "M",
    section: "Tools Under Test",
  },
  {
    href: "/dashboards/command-center",
    title: "Command Center",
    description: "Real-time executive command center with live metrics and alerts.",
    tag: "LIVE",
    icon: "CC",
    section: "Executive Tests",
  },
  {
    href: "/dashboards/capacity",
    title: "Capacity Planning",
    description: "Crew capacity vs. forecasted installs by location and month.",
    tag: "CAPACITY",
    icon: "C",
    section: "Executive Tests",
  },
  {
    href: "/dashboards/locations",
    title: "Location Comparison",
    description: "Side-by-side location performance, capacity, and pipeline breakdown.",
    tag: "LOCATIONS",
    icon: "L",
    section: "Executive Tests",
  },
  {
    href: "/dashboards/zuper-status-comparison",
    title: "Zuper Status Comparison",
    description: "Compare Zuper job statuses and dates with HubSpot deal data.",
    tag: "ZUPER",
    icon: "Z",
    section: "Data Quality",
  },
  {
    href: "/dashboards/zuper-compliance",
    title: "Zuper Compliance",
    description: "Per-user compliance scorecards and crew-composition comparisons.",
    tag: "COMPLIANCE",
    icon: "ZC",
    section: "Data Quality",
  },
  {
    href: "/prototypes/solar-checkout",
    title: "Solar Checkout Prototype",
    description: "Customer-facing checkout flow prototype.",
    tag: "PROTO",
    icon: "SC",
    section: "Prototypes",
  },
  {
    href: "/prototypes/solar-surveyor",
    title: "Solar Surveyor Prototype",
    description: "Legacy static prototype for the solar surveyor workflow.",
    tag: "PROTO",
    icon: "SS",
    section: "Prototypes",
  },
];

export default async function TestingSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/testing");
  if (!user.roles.includes("ADMIN")) redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/testing"
      title="Testing Suite"
      subtitle="Admin-only workspace for intelligence dashboards, prototypes, and pages still under review."
      cards={LINKS}
      roles={user.roles}
    />
  );
}
