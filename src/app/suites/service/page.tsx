import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/service-scheduler",
    title: "Service Schedule",
    description: "Calendar view of Zuper service visit and service revisit jobs.",
    tag: "SCHEDULING",
    section: "Scheduling",
  },
  {
    href: "/dashboards/service-backlog",
    title: "Service Equipment Backlog",
    description: "Service pipeline equipment forecasting by brand, model, and stage.",
    tag: "EQUIPMENT",
    section: "Pipeline & Equipment",
  },
  {
    href: "/dashboards/service",
    title: "Service Pipeline",
    description: "Service deal tracking with stage progression and metrics.",
    tag: "PIPELINE",
    section: "Pipeline & Equipment",
  },
];

export default async function ServiceSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/service");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/service"
      title="Service Suite"
      subtitle="Service pipeline scheduling, equipment tracking, and deal management."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-purple-500/50"
      tagColorClass="bg-purple-500/20 text-purple-400 border-purple-500/30"
    />
  );
}
