import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

/**
 * PE & Compliance Suite — consolidates everything a PM, Ops Manager, or
 * Accounting team member needs to run a Participate Energy submission
 * end-to-end: queue → audit → submit, plus incentive tracking and the
 * downstream compliance surfaces (utility, AHJ, Zuper drift).
 *
 * Consolidates 6 historical PE pages (pe-deals, pe-submission-gap, pe-prep,
 * pe-docs, pe-report, pe-pipeline) under one navigation home without
 * removing any of them (per user's "move to admin, don't delete" rule).
 */
const LINKS: SuitePageCard[] = [
  // ─────────────────────────────────────────────────────────────
  // PE Audit & Submission — the core PE Prep workflow
  // ─────────────────────────────────────────────────────────────
  {
    href: "/dashboards/pe-prep",
    title: "PE Prep Queue",
    description: "All active PE deals with audit readiness, last-run timestamps, and per-deal audit launcher.",
    tag: "PE PREP",
    icon: "🎯",
    tagColor: "orange",
    section: "PE Audit & Submission",
  },
  {
    href: "/dashboards/pe-deals",
    title: "PE Deals & Payments",
    description: "All PE-tagged deals with auto-calculated EPC, lease factor, milestone status, and payment splits.",
    tag: "PE",
    icon: "⚡",
    section: "PE Audit & Submission",
  },
  {
    href: "/dashboards/pe-pipeline",
    title: "PE Pipeline Tracker",
    description: "PE deals in construction & inspection — sorted by days in stage to push Ops forward.",
    tag: "PE",
    icon: "🚧",
    section: "PE Audit & Submission",
  },
  {
    href: "/dashboards/pe-submission-gap",
    title: "PE Submission Gap",
    description: "Projects past CC that aren't fully submitted — M1 and M2 blockers with inspection and PTO status.",
    tag: "PE",
    icon: "🔍",
    section: "PE Audit & Submission",
  },

  // ─────────────────────────────────────────────────────────────
  // Incentives
  // ─────────────────────────────────────────────────────────────
  {
    href: "/dashboards/incentives",
    title: "Incentives Dashboard",
    description: "Active incentive programs (3CE, Xcel, SGIP) — application status, expected payouts, and missing forms.",
    tag: "INCENTIVES",
    icon: "💰",
    tagColor: "emerald",
    section: "Incentives",
  },

  // ─────────────────────────────────────────────────────────────
  // Compliance
  // ─────────────────────────────────────────────────────────────
  {
    href: "/dashboards/zuper-compliance",
    title: "Zuper Compliance",
    description: "Job-status drift between Zuper and HubSpot — surfaces deals where field activity doesn't match the deal stage.",
    tag: "COMPLIANCE",
    icon: "🛡️",
    tagColor: "blue",
    section: "Compliance",
  },
  {
    href: "/dashboards/ahj-tracker",
    title: "AHJ Tracker",
    description: "Per-jurisdiction permit and inspection requirements — sorted by deals waiting on action.",
    tag: "COMPLIANCE",
    icon: "🏛️",
    tagColor: "blue",
    section: "Compliance",
  },
  {
    href: "/dashboards/ahj-requirements",
    title: "AHJ Requirements",
    description: "Reference: per-AHJ rules, plan-set requirements, and submission notes.",
    tag: "REFERENCE",
    icon: "📚",
    tagColor: "purple",
    section: "Compliance",
  },
  {
    href: "/dashboards/utility-tracker",
    title: "Utility Tracker",
    description: "Per-utility interconnection requirements, application timelines, and active deals.",
    tag: "COMPLIANCE",
    icon: "🔌",
    tagColor: "blue",
    section: "Compliance",
  },

  // ─────────────────────────────────────────────────────────────
  // Legacy PE Reporting (kept for visibility; superseded by PE Prep + PE Deals)
  // ─────────────────────────────────────────────────────────────
  {
    href: "/dashboards/pe-docs",
    title: "PE Document Tracker",
    description: "Per-deal document checklist — what's uploaded, rejected, approved. (Largely replaced by PE Prep audit.)",
    tag: "PE LEGACY",
    icon: "📝",
    tagColor: "purple",
    section: "Legacy PE Reporting",
  },
  {
    href: "/dashboards/pe-report",
    title: "PE Program Report",
    description: "Shareable PE program overview — pipeline status, document progress, blockers. (Mostly subsumed by PE Deals.)",
    tag: "PE LEGACY",
    icon: "📋",
    tagColor: "purple",
    section: "Legacy PE Reporting",
  },
  {
    href: "/dashboards/pe",
    title: "PE Milestone Tracker",
    description: "Project milestone tracking and PE portal links. (Mostly subsumed by PE Prep + PE Deals.)",
    tag: "PE LEGACY",
    icon: "📊",
    tagColor: "purple",
    section: "Legacy PE Reporting",
  },
];

export default async function PeCompliancePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/pe-compliance");
  const allowed = ["ADMIN", "OWNER", "PROJECT_MANAGER", "OPERATIONS_MANAGER", "ACCOUNTING"];
  if (!user.roles.some((r) => allowed.includes(r))) redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/pe-compliance"
      title="PE & Compliance Suite"
      subtitle="Participate Energy submission workflow, incentive tracking, and compliance surfaces."
      cards={LINKS}
      roles={user.roles}
    />
  );
}
