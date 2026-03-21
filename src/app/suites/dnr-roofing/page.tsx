import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/dnr",
    title: "D&R Pipeline",
    description: "Detach & Reset project tracking through pipeline stages.",
    tag: "D&R",
    icon: "🔩",
    section: "D&R",
  },
  {
    href: "/dashboards/dnr-scheduler",
    title: "D&R Scheduler",
    description: "Calendar view of Zuper detach, reset, and D&R inspection jobs.",
    tag: "SCHEDULING",
    icon: "📅",
    section: "D&R",
  },
  {
    href: "/dashboards/roofing",
    title: "Roofing Pipeline",
    description: "Roofing project tracking through pipeline stages.",
    tag: "ROOFING",
    icon: "🏠",
    section: "Roofing",
  },
  {
    href: "/dashboards/roofing-scheduler",
    title: "Roofing Scheduler",
    description: "Calendar view of Zuper roofing jobs.",
    tag: "SCHEDULING",
    icon: "🗓️",
    section: "Roofing",
  },
];

export default async function DNRRoofingSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/dnr-roofing");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/dnr-roofing"
      title="D&R + Roofing Suite"
      subtitle="Detach & reset and roofing scheduling, pipelines, and tracking."
      cards={LINKS}
      role={user.role}
    />
  );
}
