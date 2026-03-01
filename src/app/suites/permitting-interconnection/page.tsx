import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/pi-overview",
    title: "P&I Overview",
    description: "Summary metrics across permitting, interconnection, and PTO pipelines.",
    tag: "OVERVIEW",
    section: "Pipeline",
  },
  {
    href: "/dashboards/pi-metrics",
    title: "P&I Metrics",
    description: "Permits submitted/issued/pending, interconnection apps, PTO status, revenue and deal counts.",
    tag: "METRICS",
    section: "Pipeline",
  },
  {
    href: "/dashboards/pi-action-queue",
    title: "Action Queue",
    description: "Combined permitting + interconnection action-needed view with stale detection.",
    tag: "ACTION",
    section: "Pipeline",
  },
  {
    href: "/dashboards/ahj-tracker",
    title: "AHJ Tracker",
    description: "Per-AHJ turnaround times, rejection rates, volume, and trending analytics.",
    tag: "AHJ",
    section: "Tracking",
  },
  {
    href: "/dashboards/utility-tracker",
    title: "Utility Tracker",
    description: "Per-utility interconnection timelines, PTO tracking, and bottleneck identification.",
    tag: "UTILITY",
    section: "Tracking",
  },
  {
    href: "/dashboards/pi-timeline",
    title: "Timeline & SLA",
    description: "Configurable SLA targets with AHJ/utility benchmarks and on-time distributions.",
    tag: "SLA",
    section: "Analytics",
  },
];

export default async function PermittingInterconnectionSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/permitting-interconnection");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/permitting-interconnection"
      title="Permitting & Interconnection Suite"
      subtitle="Permit tracking, utility management, and SLA monitoring."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-cyan-500/50"
      tagColorClass="bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
    />
  );
}
