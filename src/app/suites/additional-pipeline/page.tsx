import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/sales",
    title: "Sales Pipeline",
    description: "Active deals, funnel visualization, and proposal tracking.",
    tag: "SALES",
    section: "Pipelines",
  },
  {
    href: "/dashboards/service",
    title: "Service Pipeline",
    description: "Service jobs, scheduling, and work-in-progress tracking.",
    tag: "SERVICE",
    section: "Pipelines",
  },
  {
    href: "/dashboards/dnr",
    title: "D&R Pipeline",
    description: "Detach & Reset projects with phase tracking.",
    tag: "D&R",
    section: "Pipelines",
  },
];

export default async function AdditionalPipelineSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/additional-pipeline");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/additional-pipeline"
      title="Additional Pipeline Suite"
      subtitle="Supplemental pipeline dashboards grouped for a cleaner main page."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-orange-500/50"
      tagColorClass="bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
    />
  );
}
