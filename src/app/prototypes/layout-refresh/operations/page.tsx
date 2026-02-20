import Link from "next/link";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-ops-space",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-ops-mono",
});

const MODULES = [
  {
    href: "/dashboards/scheduler",
    title: "Master Schedule",
    description: "Drag-and-drop scheduling calendar with crew management.",
    tag: "CORE",
    signal: "12 conflicts detected",
  },
  {
    href: "/dashboards/site-survey-scheduler",
    title: "Site Survey Schedule",
    description: "Dedicated calendar for scheduling site surveys with Zuper integration.",
    tag: "FIELD",
    signal: "3 same-day requests",
  },
  {
    href: "/dashboards/construction-scheduler",
    title: "Construction Schedule",
    description: "Dedicated calendar for scheduling construction installs with Zuper integration.",
    tag: "FIELD",
    signal: "8 crews available",
  },
  {
    href: "/dashboards/inspection-scheduler",
    title: "Inspection Schedule",
    description: "Dedicated calendar for scheduling inspections with Zuper integration.",
    tag: "FIELD",
    signal: "4 AHJs pending",
  },
  {
    href: "/dashboards/service-scheduler",
    title: "Service Schedule",
    description: "Calendar view of Zuper service visit and service revisit jobs.",
    tag: "SERVICE",
    signal: "17 revisit jobs",
  },
  {
    href: "/dashboards/dnr-scheduler",
    title: "D&R Schedule",
    description: "Calendar view of Zuper detach, reset, and D&R inspection jobs.",
    tag: "SERVICE",
    signal: "2 aging jobs",
  },
  {
    href: "/dashboards/timeline",
    title: "Timeline View",
    description: "Gantt-style timeline showing project progression and milestones.",
    tag: "PLANNING",
    signal: "31 delayed milestones",
  },
  {
    href: "/dashboards/equipment-backlog",
    title: "Equipment Backlog",
    description: "Equipment forecasting by brand, model, and stage with location filtering.",
    tag: "MATERIAL",
    signal: "5 shortage flags",
  },
  {
    href: "/dashboards/inventory",
    title: "Inventory Hub",
    description: "Warehouse stock levels, receiving, and demand vs. supply gap analysis.",
    tag: "MATERIAL",
    signal: "92% in-stock",
  },
];

const SHIFT_PANEL = [
  { hour: "07:15", event: "Crew standup", detail: "Dispatch + survey check-ins" },
  { hour: "09:40", event: "Permit blocker sync", detail: "Escalate overdue submittals" },
  { hour: "12:05", event: "Midday rebalance", detail: "Shift 3 crews to urgent jobs" },
  { hour: "15:30", event: "Tomorrow lock-in", detail: "Freeze priorities for next day" },
];

export default function OperationsLayoutPrototypePage() {
  return (
    <div
      className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} min-h-screen text-slate-100`}
      style={{
        background:
          "radial-gradient(circle at 20% -8%, rgba(14, 165, 233, 0.25), transparent 36%), radial-gradient(circle at 87% 12%, rgba(45, 212, 191, 0.18), transparent 38%), linear-gradient(165deg, #031626 0%, #061426 45%, #0b1f2f 100%)",
        fontFamily: "var(--font-ops-space), var(--font-geist-sans), sans-serif",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="animate-fadeIn rounded-3xl border border-cyan-200/20 bg-slate-950/45 p-5 shadow-2xl shadow-slate-950/50 backdrop-blur sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">Operations Prototype</p>
              <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Mission Control Layout</h1>
              <p className="mt-3 max-w-2xl text-sm text-slate-300 sm:text-base">
                A priority-first replacement for <span className="text-cyan-200">/suites/operations</span>.
                It surfaces urgency before users select a dashboard.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Link href="/prototypes/layout-refresh" className="rounded-full border border-white/20 px-3 py-1.5 text-slate-200 hover:border-white/40 hover:text-white">
                Back to Prototype Hub
              </Link>
              <Link href="/suites/operations" className="rounded-full border border-cyan-200/40 bg-cyan-300/10 px-3 py-1.5 text-cyan-100 hover:bg-cyan-300/20">
                Current View
              </Link>
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_2fr]">
          <aside className="animate-slideUp rounded-3xl border border-white/10 bg-slate-950/40 p-5 backdrop-blur sm:p-6">
            <p
              className="text-xs uppercase tracking-[0.3em] text-slate-300"
              style={{ fontFamily: "var(--font-ops-mono), monospace" }}
            >
              Shift Pulse
            </p>
            <div className="mt-4 space-y-3">
              {SHIFT_PANEL.map((item, index) => (
                <div
                  key={item.hour}
                  className="rounded-2xl border border-cyan-200/15 bg-cyan-950/20 p-4"
                  style={{ animationDelay: `${index * 80}ms` }}
                >
                  <p
                    className="text-xs text-cyan-100/85"
                    style={{ fontFamily: "var(--font-ops-mono), monospace" }}
                  >
                    {item.hour}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{item.event}</p>
                  <p className="mt-1 text-xs text-slate-300">{item.detail}</p>
                </div>
              ))}
            </div>
          </aside>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {MODULES.map((module, index) => (
              <Link
                key={module.href}
                href={module.href}
                className="animate-slideUp rounded-3xl border border-white/10 bg-slate-950/35 p-5 transition duration-300 hover:-translate-y-1 hover:border-cyan-200/45 hover:bg-slate-900/60"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-white">{module.title}</h2>
                  <span
                    className="rounded-full border border-cyan-200/35 bg-cyan-200/10 px-2 py-1 text-[10px] tracking-[0.12em] text-cyan-100"
                    style={{ fontFamily: "var(--font-ops-mono), monospace" }}
                  >
                    {module.tag}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-300">{module.description}</p>
                <p
                  className="mt-5 text-xs uppercase tracking-[0.16em] text-teal-200/90"
                  style={{ fontFamily: "var(--font-ops-mono), monospace" }}
                >
                  {module.signal}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
