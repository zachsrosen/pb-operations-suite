import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  // ── Tools ──
  {
    href: "/dashboards/payment-action-queue",
    title: "Payment Action Queue",
    description: "Rejected invoices, overdue payments, and ready-to-invoice work milestones.",
    tag: "ACCOUNTING",
    icon: "🚨",
    section: "Tools",
  },
  {
    href: "/dashboards/payment-tracking",
    title: "Payment Tracking",
    description: "Per-project payment status: not yet paid, partially paid, fully paid.",
    tag: "ACCOUNTING",
    icon: "💵",
    section: "Tools",
  },
  {
    href: "/dashboards/ready-to-invoice",
    title: "Ready to Invoice",
    description: "Work milestones hit but no invoice created yet — grouped by milestone.",
    tag: "ACCOUNTING",
    icon: "🧾",
    section: "Tools",
  },
  {
    href: "/dashboards/accounts-receivable",
    title: "Accounts Receivable",
    description: "Invoices sent but unpaid, grouped by aging bucket (0-30 / 31-60 / 61-90 / 90+).",
    tag: "ACCOUNTING",
    icon: "⏳",
    section: "Tools",
  },
  {
    href: "/dashboards/payment-timeline",
    title: "Payment Timeline",
    description: "Received and outstanding payments by date — see what came in and what's still owed.",
    tag: "ACCOUNTING",
    icon: "📅",
    section: "Tools",
  },

  // ── Participate Energy ──
  {
    href: "/dashboards/pe-docs",
    title: "PE Document Tracker",
    description: "Live document checklist — see what needs uploading, what's rejected, and what's approved per deal.",
    tag: "PE",
    icon: "📝",
    section: "Participate Energy",
  },
  {
    href: "/dashboards/pe-report",
    title: "PE Program Report",
    description: "Shareable PE program overview — pipeline status, document progress, blockers, and action items.",
    tag: "PE",
    icon: "📋",
    section: "Participate Energy",
  },
  {
    href: "/dashboards/pipeline-tracker",
    title: "Pipeline Tracker",
    description: "All deals in construction and inspection — sorted by days in stage.",
    tag: "OPS",
    icon: "📊",
    section: "Participate Energy",
  },
  {
    href: "/dashboards/pe-pipeline",
    title: "PE Pipeline Tracker",
    description: "PE deals stuck in construction and inspection — sorted by days in stage to push Ops forward.",
    tag: "PE",
    icon: "🚧",
    section: "Participate Energy",
  },
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
  const allowed = ["ADMIN", "EXECUTIVE", "ACCOUNTING"];
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
