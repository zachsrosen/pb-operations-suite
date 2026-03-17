import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/service-overview",
    title: "Service Overview",
    description: "Priority queue command center — see what needs attention now.",
    tag: "OVERVIEW",
    section: "Service",
  },
  {
    href: "/dashboards/service-scheduler",
    title: "Service Schedule",
    description: "Calendar view of Zuper service visit and service revisit jobs.",
    tag: "SCHEDULING",
    section: "Service",
  },
  {
    href: "/dashboards/service-backlog",
    title: "Service Equipment Backlog",
    description: "Service pipeline equipment forecasting by brand, model, and stage.",
    tag: "EQUIPMENT",
    section: "Service",
  },
  {
    href: "/dashboards/service",
    title: "Service Pipeline",
    description: "Service deal tracking with stage progression and metrics.",
    tag: "PIPELINE",
    section: "Service",
  },
];

export default async function ServiceDRSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/service");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/service"
      title="Service Suite"
      subtitle="Service scheduling, equipment tracking, priority queue, and pipelines."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-cyan-500/50"
      tagColorClass="bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
    />
  );
}
