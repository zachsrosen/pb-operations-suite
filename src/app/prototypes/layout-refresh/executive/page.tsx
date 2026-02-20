import Link from "next/link";
import { DM_Sans, Libre_Baskerville } from "next/font/google";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-exec-sans",
});

const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-exec-serif",
});

const KPIS = [
  { label: "Projected Revenue", value: "$14.7M", delta: "+8.2%" },
  { label: "Backlog Coverage", value: "11.3 weeks", delta: "-0.9 weeks" },
  { label: "Permitting Risk", value: "19 projects", delta: "+3 alerts" },
];

const VIEWS = [
  {
    href: "/dashboards/revenue",
    title: "Revenue",
    detail: "Stage economics, location mix, and backlog forecast trends.",
    prompt: "Finance and forecasting",
  },
  {
    href: "/dashboards/executive",
    title: "Executive Summary",
    detail: "Leadership snapshot of pipeline strength and readiness by stage.",
    prompt: "Daily leadership pulse",
  },
  {
    href: "/dashboards/locations",
    title: "Location Comparison",
    detail: "Regional output, capacity exposure, and utilization spread.",
    prompt: "Regional strategy",
  },
  {
    href: "/dashboards/executive-calendar",
    title: "Revenue Calendar",
    detail: "Daily view of scheduled field-service deal value realization.",
    prompt: "Cash-flow timing",
  },
];

export default function ExecutiveLayoutPrototypePage() {
  return (
    <div
      className={`${dmSans.variable} ${libreBaskerville.variable} min-h-screen text-[#f5f1ea]`}
      style={{
        background:
          "radial-gradient(circle at 78% 0%, rgba(245, 158, 11, 0.28), transparent 38%), radial-gradient(circle at 15% 16%, rgba(30, 64, 175, 0.24), transparent 35%), linear-gradient(150deg, #120f12 0%, #17131d 50%, #1f1620 100%)",
        fontFamily: "var(--font-exec-sans), var(--font-geist-sans), sans-serif",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="animate-fadeIn rounded-3xl border border-amber-200/20 bg-black/25 p-6 shadow-2xl shadow-black/35 backdrop-blur-sm sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-amber-100/75">Executive Prototype</p>
          <h1
            className="mt-3 text-3xl font-bold leading-tight text-[#fff7ea] sm:text-4xl"
            style={{ fontFamily: "var(--font-exec-serif), serif" }}
          >
            Signal Board Layout
          </h1>
          <p className="mt-4 max-w-3xl text-sm text-[#efe4d2]/90 sm:text-base">
            A narrative leadership replacement for <span className="text-amber-200">/suites/executive</span>.
            KPIs and routing decisions are visible before drilling into individual dashboards.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <Link href="/prototypes/layout-refresh" className="rounded-full border border-white/25 px-3 py-1.5 text-[#efe4d2] hover:border-white/45 hover:text-white">
              Back to Prototype Hub
            </Link>
            <Link href="/suites/executive" className="rounded-full border border-amber-100/40 bg-amber-200/10 px-3 py-1.5 text-amber-100 hover:bg-amber-200/20">
              Current View
            </Link>
          </div>
        </header>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          {KPIS.map((kpi, index) => (
            <article
              key={kpi.label}
              className="animate-slideUp rounded-2xl border border-white/12 bg-white/5 p-5 backdrop-blur-sm"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <p className="text-xs uppercase tracking-[0.24em] text-[#ddcfbb]">{kpi.label}</p>
              <p
                className="mt-3 text-3xl font-bold text-[#fff6e6]"
                style={{ fontFamily: "var(--font-exec-serif), serif" }}
              >
                {kpi.value}
              </p>
              <p className="mt-2 text-sm text-amber-100/90">{kpi.delta}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          {VIEWS.map((view, index) => (
            <Link
              key={view.href}
              href={view.href}
              className="animate-slideUp rounded-3xl border border-white/10 bg-black/25 p-5 transition duration-300 hover:-translate-y-1 hover:border-amber-100/35 hover:bg-black/40"
              style={{ animationDelay: `${index * 65}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <h2
                  className="text-2xl font-bold text-[#fff6e6]"
                  style={{ fontFamily: "var(--font-exec-serif), serif" }}
                >
                  {view.title}
                </h2>
                <span className="rounded-full border border-amber-100/35 bg-amber-200/12 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-100">
                  {view.prompt}
                </span>
              </div>
              <p className="mt-3 text-sm text-[#efe4d2]/90">{view.detail}</p>
              <p className="mt-5 text-sm font-semibold text-amber-100">Open dashboard</p>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
