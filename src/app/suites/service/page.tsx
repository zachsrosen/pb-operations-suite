import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
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
  {
    href: "/dashboards/dnr-scheduler",
    title: "D&R Schedule",
    description: "Calendar view of Zuper detach, reset, and D&R inspection jobs.",
    tag: "SCHEDULING",
    section: "D&R",
  },
  {
    href: "/dashboards/dnr",
    title: "D&R Pipeline",
    description: "Detach & Reset projects with phase tracking.",
    tag: "D&R",
    section: "D&R",
  },
];

export default async function ServiceDRSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/service");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/service"
      title="Service + D&R Suite"
      subtitle="Service and detach & reset scheduling, equipment tracking, and pipelines."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-purple-500/50"
      tagColorClass="bg-purple-500/20 text-purple-400 border-purple-500/30"
    />
  );
}
