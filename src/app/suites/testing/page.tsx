import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const TESTING_DASHBOARDS: SuitePageCard[] = [
  {
    href: "/dashboards/qc",
    title: "QC Metrics",
    description: "Time-between-stages analytics by office and utility.",
    tag: "QC",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/project-management",
    title: "Project Management",
    description: "PM workload, DA backlog, stuck deals, and revenue tracking.",
    tag: "PM",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/design-engineering",
    title: "Design & Engineering",
    description: "Cross-state design analytics, status breakdowns, and ops clarification queue.",
    tag: "D&E",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/permitting-interconnection",
    title: "Permitting & Interconnection",
    description: "Combined P&I analytics, turnaround times, and action-needed views.",
    tag: "P&I",
    tagColor: "bg-teal-500/20 text-teal-400 border-teal-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/alerts",
    title: "Alerts",
    description: "Overdue installs, PE PTO risks, and capacity overload warnings.",
    tag: "ALERTS",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/pe",
    title: "PE Dashboard",
    description: "Participate Energy milestone tracking and compliance monitoring.",
    tag: "PE",
    tagColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/capacity",
    title: "Capacity Planning",
    description: "Crew capacity vs. forecasted installs across all locations.",
    tag: "CAPACITY",
    tagColor: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/pipeline",
    title: "Pipeline Overview",
    description: "Full project pipeline with filters, priority scoring, and milestone tracking.",
    tag: "PIPELINE",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/at-risk",
    title: "At-Risk Projects",
    description: "Projects with overdue milestones, stalled stages, and severity scoring.",
    tag: "AT-RISK",
    tagColor: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/optimizer",
    title: "Pipeline Optimizer",
    description: "Identify scheduling opportunities and optimize project throughput.",
    tag: "OPTIMIZER",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/zuper-compliance",
    title: "Zuper Compliance",
    description: "Per-user compliance scorecards for Zuper field service status updates.",
    tag: "COMPLIANCE",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/mobile",
    title: "Mobile Dashboard",
    description: "Touch-optimized view for field teams and fast project lookup.",
    tag: "MOBILE",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/inventory",
    title: "Inventory Hub",
    description: "Warehouse stock levels, receiving, and demand vs. supply gap analysis.",
    tag: "INVENTORY",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    section: "Testing Dashboards",
  },
  {
    href: "/dashboards/product-comparison",
    title: "Product Catalog Comparison",
    description: "Compare HubSpot, Zuper, and Zoho product records to catch mismatches.",
    tag: "CATALOG",
    tagColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    section: "Testing Dashboards",
  },
];

const PROTOTYPES: SuitePageCard[] = [
  {
    href: "/prototypes/layout-refresh",
    title: "Layout Refresh Prototypes",
    description: "Replacement suite layouts for operations, department, and executive views.",
    tag: "PROTOTYPE",
    tagColor: "bg-pink-500/20 text-pink-400 border-pink-500/30",
    section: "Prototypes",
  },
  {
    href: "/prototypes/solar-checkout",
    title: "Solar Checkout Experience",
    description: "Customer-facing solar checkout flow prototype.",
    tag: "PROTOTYPE",
    tagColor: "bg-pink-500/20 text-pink-400 border-pink-500/30",
    section: "Prototypes",
  },
  {
    href: "/prototypes/solar-surveyor",
    title: "Solar Surveyor v11",
    description: "Next-generation solar site surveyor tool prototype.",
    tag: "PROTOTYPE",
    tagColor: "bg-pink-500/20 text-pink-400 border-pink-500/30",
    section: "Prototypes",
  },
];

export default async function TestingSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/testing");
  if (user.role !== "ADMIN" && user.role !== "OWNER") redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/testing"
      title="Testing Suite"
      subtitle="Experimental dashboards and prototype workflows for owners and admins."
      cards={[...TESTING_DASHBOARDS, ...PROTOTYPES]}
      role={user.role}
      hoverBorderClass="hover:border-orange-500/50"
      columnsClassName="grid grid-cols-1 md:grid-cols-3 gap-4"
    />
  );
}
