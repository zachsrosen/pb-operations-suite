import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  // ── Tools ──
  {
    href: "/dashboards/pricing-calculator",
    title: "Pricing Calculator",
    description: "Price solar + battery systems with PE lease value calculator and COGS breakdown.",
    tag: "PRICING",
    icon: "💲",
    section: "Tools",
  },

  // ── Participate Energy ──
  {
    href: "/dashboards/pe-deals",
    title: "PE Deals & Payments",
    description: "All PE-tagged deals with auto-calculated EPC, lease factor, and payment splits.",
    tag: "PE",
    icon: "⚡",
    section: "Participate Energy",
  },
  {
    href: "/dashboards/pe",
    title: "PE Dashboard",
    description: "Participate Energy milestone tracking and compliance monitoring.",
    tag: "PE",
    icon: "📊",
    section: "Participate Energy",
  },
];

export default async function AccountingSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/accounting");
  const allowed = ["ADMIN", "EXECUTIVE"];
  if (!user.roles.some(r => allowed.includes(r))) redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/accounting"
      title="Accounting Suite"
      subtitle="PE deal payments, pricing tools, and financial tracking."
      cards={LINKS}
      roles={user.roles}
    />
  );
}
