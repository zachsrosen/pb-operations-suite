import Link from "next/link";
import { Manrope, Fraunces } from "next/font/google";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-dept-manrope",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-dept-fraunces",
});

const LANES = [
  {
    name: "Discovery",
    accent: "from-cyan-500/25 to-blue-500/5",
    items: [
      {
        href: "/dashboards/site-survey",
        title: "Site Survey",
        detail: "Scheduling, status tracking, and completion monitoring.",
      },
      {
        href: "/dashboards/design",
        title: "Design & Engineering",
        detail: "Track design progress, engineering approvals, and plan sets.",
      },
    ],
  },
  {
    name: "Approvals",
    accent: "from-emerald-500/25 to-green-500/5",
    items: [
      {
        href: "/dashboards/permitting",
        title: "Permitting",
        detail: "Permit status, submission timing, and approval monitoring.",
      },
      {
        href: "/dashboards/interconnection",
        title: "Interconnection",
        detail: "Utility applications, approvals, and meter installations.",
      },
      {
        href: "/dashboards/incentives",
        title: "Incentives",
        detail: "Rebate program tracking and incentive submission status.",
      },
    ],
  },
  {
    name: "Delivery",
    accent: "from-amber-500/25 to-orange-500/5",
    items: [
      {
        href: "/dashboards/inspections",
        title: "Inspections",
        detail: "Inspection status, pass rates, and AHJ-level performance.",
      },
      {
        href: "/dashboards/construction",
        title: "Construction",
        detail: "Construction status, scheduling, and progress tracking.",
      },
    ],
  },
];

export default function DepartmentLayoutPrototypePage() {
  return (
    <div
      className={`${manrope.variable} ${fraunces.variable} min-h-screen text-slate-900`}
      style={{
        background:
          "radial-gradient(circle at 10% 3%, rgba(22, 163, 74, 0.12), transparent 32%), radial-gradient(circle at 90% 8%, rgba(14, 165, 233, 0.11), transparent 30%), linear-gradient(165deg, #f7fafb 0%, #ecf4f4 48%, #f7f2eb 100%)",
        fontFamily: "var(--font-dept-manrope), var(--font-geist-sans), sans-serif",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="animate-fadeIn rounded-3xl border border-slate-900/10 bg-white/80 p-6 shadow-xl shadow-slate-900/10 backdrop-blur sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-emerald-700/80">Department Prototype</p>
          <h1
            className="mt-3 text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl"
            style={{ fontFamily: "var(--font-dept-fraunces), serif" }}
          >
            Workflow Atlas Layout
          </h1>
          <p className="mt-4 max-w-3xl text-sm text-slate-600 sm:text-base">
            A process-driven replacement for <span className="text-emerald-700">/suites/department</span>.
            Dashboards are grouped by execution phase to clarify handoffs between teams.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <Link href="/prototypes/layout-refresh" className="rounded-full border border-slate-900/20 px-3 py-1.5 text-slate-700 hover:border-slate-900/40 hover:text-slate-900">
              Back to Prototype Hub
            </Link>
            <Link href="/suites/department" className="rounded-full border border-emerald-700/25 bg-emerald-700/10 px-3 py-1.5 text-emerald-700 hover:bg-emerald-700/20">
              Current View
            </Link>
          </div>
        </header>

        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          {LANES.map((lane, laneIndex) => (
            <article
              key={lane.name}
              className="animate-slideUp rounded-3xl border border-slate-900/10 bg-white/70 p-4 shadow-lg shadow-slate-900/5 backdrop-blur sm:p-5"
              style={{ animationDelay: `${laneIndex * 90}ms` }}
            >
              <div className={`rounded-2xl bg-gradient-to-br ${lane.accent} p-4`}>
                <p className="text-xs uppercase tracking-[0.26em] text-slate-700">{lane.name}</p>
                <p className="mt-2 text-sm text-slate-700">
                  {lane.name === "Discovery" && "Capture feasibility and technical readiness."}
                  {lane.name === "Approvals" && "Move projects through compliance and utility milestones."}
                  {lane.name === "Delivery" && "Execute field delivery and closeout checkpoints."}
                </p>
              </div>
              <div className="mt-3 space-y-3">
                {lane.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group block rounded-2xl border border-slate-900/10 bg-white/85 p-4 transition duration-300 hover:-translate-y-0.5 hover:border-slate-900/25 hover:bg-white"
                  >
                    <h2 className="text-base font-semibold text-slate-900 group-hover:text-emerald-800">
                      {item.title}
                    </h2>
                    <p className="mt-2 text-sm text-slate-600">{item.detail}</p>
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
