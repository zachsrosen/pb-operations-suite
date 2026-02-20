import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

const TESTING_DASHBOARDS = [
  {
    href: "/dashboards/qc",
    title: "QC Metrics",
    description: "Time-between-stages analytics by office and utility.",
    tag: "QC",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  {
    href: "/dashboards/project-management",
    title: "Project Management",
    description: "PM workload, DA backlog, stuck deals, and revenue tracking.",
    tag: "PM",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
  },
  {
    href: "/dashboards/design-engineering",
    title: "Design & Engineering",
    description: "Cross-state design analytics, status breakdowns, and ops clarification queue.",
    tag: "D&E",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  },
  {
    href: "/dashboards/permitting-interconnection",
    title: "Permitting & Interconnection",
    description: "Combined P&I analytics, turnaround times, and action-needed views.",
    tag: "P&I",
    tagColor: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  },
  {
    href: "/dashboards/alerts",
    title: "Alerts",
    description: "Overdue installs, PE PTO risks, and capacity overload warnings.",
    tag: "ALERTS",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  {
    href: "/dashboards/pe",
    title: "PE Dashboard",
    description: "Participate Energy milestone tracking and compliance monitoring.",
    tag: "PE",
    tagColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  },
  {
    href: "/dashboards/capacity",
    title: "Capacity Planning",
    description: "Crew capacity vs. forecasted installs across all locations.",
    tag: "CAPACITY",
    tagColor: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  },
  {
    href: "/dashboards/pipeline",
    title: "Pipeline Overview",
    description: "Full project pipeline with filters, priority scoring, and milestone tracking.",
    tag: "PIPELINE",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
  },
  {
    href: "/dashboards/at-risk",
    title: "At-Risk Projects",
    description: "Projects with overdue milestones, stalled stages, and severity scoring.",
    tag: "AT-RISK",
    tagColor: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  },
  {
    href: "/dashboards/optimizer",
    title: "Pipeline Optimizer",
    description: "Identify scheduling opportunities and optimize project throughput.",
    tag: "OPTIMIZER",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  },
  {
    href: "/dashboards/zuper-status-comparison",
    title: "Zuper Status Comparison",
    description: "Compare Zuper job statuses and dates with HubSpot deal data.",
    tag: "ZUPER",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  },
  {
    href: "/dashboards/zuper-compliance",
    title: "Zuper Compliance",
    description: "Per-user compliance scorecards for Zuper field service status updates.",
    tag: "COMPLIANCE",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  {
    href: "/dashboards/mobile",
    title: "Mobile Dashboard",
    description: "Touch-optimized view for field teams and fast project lookup.",
    tag: "MOBILE",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  {
    href: "/dashboards/inventory",
    title: "Inventory Hub",
    description: "Warehouse stock levels, receiving, and demand vs. supply gap analysis.",
    tag: "INVENTORY",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  },
];

const PROTOTYPES = [
  {
    href: "/prototypes/layout-refresh",
    title: "Layout Refresh Prototypes",
    description: "Replacement suite layouts for operations, department, and executive views.",
    tag: "PROTOTYPE",
    tagColor: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  },
  {
    href: "/prototypes/solar-checkout",
    title: "Solar Checkout Experience",
    description: "Customer-facing solar checkout flow prototype.",
    tag: "PROTOTYPE",
    tagColor: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  },
  {
    href: "/prototypes/solar-surveyor",
    title: "Solar Surveyor v11",
    description: "Next-generation solar site surveyor tool prototype.",
    tag: "PROTOTYPE",
    tagColor: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  },
];

function SectionGrid({ items }: { items: typeof TESTING_DASHBOARDS }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="group block bg-surface/50 border border-t-border rounded-xl p-5 hover:border-orange-500/50 hover:bg-surface transition-all"
        >
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-foreground group-hover:text-orange-400 transition-colors">
              {item.title}
            </h3>
            <span className={`text-xs font-medium px-2 py-0.5 rounded border ${item.tagColor}`}>
              {item.tag}
            </span>
          </div>
          <p className="text-sm text-muted">{item.description}</p>
        </Link>
      ))}
    </div>
  );
}

export default async function TestingSuitePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login?callbackUrl=/suites/testing");

  const user = await getUserByEmail(session.user.email);
  if (!user || (user.role !== "ADMIN" && user.role !== "OWNER")) redirect("/");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link href="/" className="text-xs text-muted hover:text-foreground transition-colors">
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold mt-3">Testing Suite</h1>
          <p className="text-sm text-muted mt-1">
            Experimental dashboards and prototype workflows for owners and admins.
          </p>
        </div>

        <h2 className="text-lg font-semibold text-foreground/80 mb-4">Testing Dashboards</h2>
        <SectionGrid items={TESTING_DASHBOARDS} />

        <h2 className="text-lg font-semibold text-foreground/80 mt-10 mb-4">Prototypes</h2>
        <SectionGrid items={PROTOTYPES} />
      </main>
    </div>
  );
}
