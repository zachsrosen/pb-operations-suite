import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/revenue",
    title: "Revenue",
    description: "Revenue by stage, backlog forecasts, location breakdowns, and milestone timelines.",
    tag: "REVENUE",
    tagColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    section: "Executive Views",
  },
  {
    href: "/dashboards/executive",
    title: "Executive Summary",
    description: "High-level pipeline and stage analysis with location and monthly trends.",
    tag: "SUMMARY",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    section: "Executive Views",
  },
  {
    href: "/dashboards/locations",
    title: "Location Comparison",
    description: "Side-by-side location performance, capacity, and pipeline breakdown.",
    tag: "LOCATIONS",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    section: "Executive Views",
  },
  {
    href: "/dashboards/executive-calendar",
    title: "Revenue Calendar",
    description: "Monthly calendar showing daily deal value of scheduled field service work.",
    tag: "REVENUE",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "Executive Views",
  },
];

export default async function ExecutiveSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/executive");
  if (user.role !== "ADMIN" && user.role !== "OWNER") redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/executive"
      title="Executive Suite"
      subtitle="Leadership dashboards, pipeline intelligence, and executive views."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-orange-500/50"
      columnsClassName="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
    />
  );
}
