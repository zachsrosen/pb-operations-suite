import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/site-survey",
    title: "Site Survey",
    description: "Site survey scheduling, status tracking, and completion monitoring.",
    tag: "SURVEY",
    section: "Execution",
  },
  {
    href: "/dashboards/design",
    title: "Design & Engineering",
    description: "Track design progress, engineering approvals, and plan sets.",
    tag: "DESIGN",
    section: "Execution",
  },
  {
    href: "/dashboards/permitting",
    title: "Permitting",
    description: "Permit status tracking, submission dates, and approval monitoring.",
    tag: "PERMITTING",
    section: "Execution",
  },
  {
    href: "/dashboards/inspections",
    title: "Inspections",
    description: "Inspection scheduling, status tracking, pass rates, and AHJ analysis.",
    tag: "INSPECTIONS",
    section: "Execution",
  },
  {
    href: "/dashboards/interconnection",
    title: "Interconnection",
    description: "Utility interconnection applications, approvals, and meter installations.",
    tag: "UTILITY",
    section: "Execution",
  },
  {
    href: "/dashboards/construction",
    title: "Construction",
    description: "Construction status, scheduling, and progress tracking.",
    tag: "CONSTRUCTION",
    section: "Execution",
  },
  {
    href: "/dashboards/incentives",
    title: "Incentives",
    description: "Rebate and incentive program tracking and application status.",
    tag: "INCENTIVES",
    section: "Execution",
  },
];

export default async function DepartmentSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/department");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/department"
      title="Department Suite"
      subtitle="Department-level dashboards grouped in one place."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-orange-500/50"
      tagColorClass="bg-green-500/20 text-green-400 border-green-500/30"
    />
  );
}
