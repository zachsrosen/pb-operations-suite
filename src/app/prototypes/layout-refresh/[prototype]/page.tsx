import Link from "next/link";
import { notFound } from "next/navigation";
import { JetBrains_Mono, Newsreader, Sora } from "next/font/google";
import { ExtraPrototype, getPrototypeBySlug } from "../catalog";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-proto-sora",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-proto-newsreader",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-proto-mono",
});

const OPS_MODULES = [
  {
    href: "/dashboards/scheduler",
    title: "Master Schedule",
    description: "Drag-and-drop scheduling calendar with crew management.",
    signal: "12 conflicts",
    cluster: "Scheduling",
  },
  {
    href: "/dashboards/site-survey-scheduler",
    title: "Site Survey Schedule",
    description: "Dedicated calendar for site surveys with Zuper integration.",
    signal: "3 same-day requests",
    cluster: "Scheduling",
  },
  {
    href: "/dashboards/construction-scheduler",
    title: "Construction Schedule",
    description: "Construction install scheduling with crew balancing.",
    signal: "8 crews ready",
    cluster: "Scheduling",
  },
  {
    href: "/dashboards/inspection-scheduler",
    title: "Inspection Schedule",
    description: "Inspection planning with AHJ-specific throughput tracking.",
    signal: "4 AHJs pending",
    cluster: "Scheduling",
  },
  {
    href: "/dashboards/service-scheduler",
    title: "Service Schedule",
    description: "Calendar of service and revisit jobs for field teams.",
    signal: "17 revisit jobs",
    cluster: "Service",
  },
  {
    href: "/dashboards/dnr-scheduler",
    title: "D&R Schedule",
    description: "Detach, reset, and D&R inspection scheduling calendar.",
    signal: "2 aging jobs",
    cluster: "Service",
  },
  {
    href: "/dashboards/timeline",
    title: "Timeline View",
    description: "Gantt-style progression view with milestone tracking.",
    signal: "31 delayed milestones",
    cluster: "Planning",
  },
  {
    href: "/dashboards/equipment-backlog",
    title: "Equipment Backlog",
    description: "Forecasting by product line, stage, and location pressure.",
    signal: "5 shortage flags",
    cluster: "Supply",
  },
  {
    href: "/dashboards/inventory",
    title: "Inventory Hub",
    description: "Stock levels, receiving, and demand-supply coverage analysis.",
    signal: "92% in stock",
    cluster: "Supply",
  },
];

const SHIFT_CHECKPOINTS = [
  { time: "07:20", title: "Dispatch standup", note: "Crew and truck verification" },
  { time: "09:35", title: "Permit blocker sync", note: "Escalate overdue submissions" },
  { time: "12:10", title: "Rebalance run", note: "Shift crews toward critical jobs" },
  { time: "15:40", title: "Next-day lock", note: "Freeze schedule and handoffs" },
];

const EXEC_KPIS = [
  { label: "Projected Revenue", value: "$14.7M", delta: "+8.2%" },
  { label: "Backlog Coverage", value: "11.3 weeks", delta: "-0.9 weeks" },
  { label: "Permitting Risk", value: "19 projects", delta: "+3 alerts" },
  { label: "Crew Utilization", value: "87%", delta: "+4 pts" },
];

const EXEC_VIEWS = [
  {
    href: "/dashboards/revenue",
    title: "Revenue",
    detail: "Stage economics, backlog forecasts, and location mix.",
    track: "Finance",
  },
  {
    href: "/dashboards/executive",
    title: "Executive Summary",
    detail: "Pipeline strength and readiness across milestones.",
    track: "Leadership",
  },
  {
    href: "/dashboards/locations",
    title: "Location Comparison",
    detail: "Regional capacity, throughput, and volume spread.",
    track: "Strategy",
  },
  {
    href: "/dashboards/executive-calendar",
    title: "Revenue Calendar",
    detail: "Daily field-service value realization timeline.",
    track: "Finance",
  },
];

const EXEC_RISKS = [
  { risk: "Permitting backlog rising in SD", action: "Open Executive Summary", href: "/dashboards/executive" },
  { risk: "Revenue concentration in one location", action: "Open Location Comparison", href: "/dashboards/locations" },
  { risk: "Near-term install value dipping", action: "Open Revenue Calendar", href: "/dashboards/executive-calendar" },
];

function getToneClasses(tone: ExtraPrototype["tone"]) {
  if (tone === "dawn") {
    return {
      background:
        "radial-gradient(circle at 8% 3%, rgba(56, 189, 248, 0.16), transparent 35%), radial-gradient(circle at 92% 7%, rgba(251, 191, 36, 0.18), transparent 38%), linear-gradient(160deg, #f8fbfc 0%, #ecf4f6 52%, #f8f1e8 100%)",
      baseText: "text-slate-900",
      panel: "bg-white/78 border-slate-900/10",
      card: "bg-white/88 border-slate-900/10 hover:border-slate-900/25",
      chip: "bg-slate-900/5 border-slate-900/20 text-slate-700",
      muted: "text-slate-600",
      heading: "text-slate-900",
      accent: "text-emerald-700",
      action: "text-slate-700 hover:text-slate-900",
      shadow: "shadow-slate-900/10",
    };
  }

  if (tone === "ember") {
    return {
      background:
        "radial-gradient(circle at 78% 0%, rgba(251, 146, 60, 0.28), transparent 40%), radial-gradient(circle at 15% 12%, rgba(239, 68, 68, 0.22), transparent 34%), linear-gradient(155deg, #190f12 0%, #1d141a 45%, #23141b 100%)",
      baseText: "text-amber-50",
      panel: "bg-black/30 border-amber-200/20",
      card: "bg-black/28 border-white/15 hover:border-amber-200/35",
      chip: "bg-amber-100/12 border-amber-100/35 text-amber-100",
      muted: "text-amber-100/80",
      heading: "text-amber-50",
      accent: "text-orange-200",
      action: "text-amber-100 hover:text-white",
      shadow: "shadow-black/35",
    };
  }

  if (tone === "slate") {
    return {
      background:
        "radial-gradient(circle at 11% 8%, rgba(45, 212, 191, 0.18), transparent 32%), radial-gradient(circle at 86% 6%, rgba(148, 163, 184, 0.2), transparent 35%), linear-gradient(160deg, #0b1220 0%, #111a2a 55%, #141d2f 100%)",
      baseText: "text-slate-100",
      panel: "bg-slate-950/42 border-white/14",
      card: "bg-slate-950/35 border-white/12 hover:border-cyan-200/35",
      chip: "bg-slate-200/10 border-slate-200/25 text-slate-100",
      muted: "text-slate-300",
      heading: "text-white",
      accent: "text-cyan-200",
      action: "text-slate-200 hover:text-white",
      shadow: "shadow-slate-950/45",
    };
  }

  if (tone === "ocean") {
    return {
      background:
        "radial-gradient(circle at 20% -7%, rgba(14, 165, 233, 0.24), transparent 36%), radial-gradient(circle at 87% 12%, rgba(45, 212, 191, 0.18), transparent 36%), linear-gradient(165deg, #031626 0%, #06172a 50%, #0a2033 100%)",
      baseText: "text-cyan-50",
      panel: "bg-slate-950/45 border-cyan-200/22",
      card: "bg-slate-950/38 border-white/14 hover:border-cyan-200/45",
      chip: "bg-cyan-100/12 border-cyan-100/30 text-cyan-100",
      muted: "text-cyan-100/78",
      heading: "text-white",
      accent: "text-cyan-200",
      action: "text-cyan-100 hover:text-white",
      shadow: "shadow-slate-950/50",
    };
  }

  return {
    background:
      "radial-gradient(circle at 16% 2%, rgba(59, 130, 246, 0.24), transparent 35%), radial-gradient(circle at 83% 6%, rgba(217, 70, 239, 0.18), transparent 34%), linear-gradient(160deg, #070f1f 0%, #0b1324 50%, #11182b 100%)",
    baseText: "text-slate-100",
    panel: "bg-slate-950/42 border-white/12",
    card: "bg-slate-950/32 border-white/12 hover:border-sky-200/38",
    chip: "bg-slate-200/10 border-slate-200/25 text-slate-100",
    muted: "text-slate-300",
    heading: "text-white",
    accent: "text-sky-200",
    action: "text-slate-200 hover:text-white",
    shadow: "shadow-slate-950/45",
  };
}

function renderOperationsBody(slug: string, tone: ReturnType<typeof getToneClasses>) {
  if (slug === "operations-flightdeck") {
    const grouped = {
      Scheduling: OPS_MODULES.filter((module) => module.cluster === "Scheduling"),
      Service: OPS_MODULES.filter((module) => module.cluster === "Service"),
      Planning: OPS_MODULES.filter((module) => module.cluster === "Planning" || module.cluster === "Supply"),
    };

    return (
      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        {Object.entries(grouped).map(([cluster, modules], columnIndex) => (
          <article
            key={cluster}
            className={`animate-slideUp rounded-3xl border p-5 backdrop-blur ${tone.panel}`}
            style={{ animationDelay: `${columnIndex * 80}ms` }}
          >
            <p className={`text-xs uppercase tracking-[0.22em] ${tone.muted}`}>{cluster}</p>
            <div className="mt-4 space-y-3">
              {modules.map((module) => (
                <Link key={module.href} href={module.href} className={`block rounded-2xl border p-4 transition ${tone.card}`}>
                  <h2 className={`text-base font-semibold ${tone.heading}`}>{module.title}</h2>
                  <p className={`mt-1 text-sm ${tone.muted}`}>{module.description}</p>
                  <p className={`mt-3 text-xs ${tone.accent}`} style={{ fontFamily: "var(--font-proto-mono), monospace" }}>
                    {module.signal}
                  </p>
                </Link>
              ))}
            </div>
          </article>
        ))}
      </section>
    );
  }

  if (slug === "operations-queue-wall") {
    const ranked = OPS_MODULES.map((module, index) => ({ ...module, rank: index + 1 }));
    return (
      <section className={`mt-6 animate-slideUp rounded-3xl border p-4 backdrop-blur sm:p-6 ${tone.panel}`}>
        <div className="grid gap-3">
          {ranked.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`grid items-center gap-3 rounded-2xl border p-4 transition sm:grid-cols-[80px_1.3fr_2fr_140px] ${tone.card}`}
            >
              <p className={`text-xs uppercase tracking-[0.2em] ${tone.muted}`}>Rank {item.rank}</p>
              <p className={`text-sm font-semibold ${tone.heading}`}>{item.title}</p>
              <p className={`text-sm ${tone.muted}`}>{item.description}</p>
              <p className={`text-xs ${tone.accent}`} style={{ fontFamily: "var(--font-proto-mono), monospace" }}>
                {item.signal}
              </p>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  if (slug === "operations-shift-board") {
    return (
      <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.8fr]">
        <aside className={`animate-slideUp rounded-3xl border p-5 backdrop-blur ${tone.panel}`}>
          <p className={`text-xs uppercase tracking-[0.24em] ${tone.muted}`}>Shift Timeline</p>
          <div className="mt-4 space-y-3">
            {SHIFT_CHECKPOINTS.map((checkpoint) => (
              <div key={checkpoint.time} className={`rounded-2xl border p-4 ${tone.card}`}>
                <p className={`text-xs ${tone.accent}`} style={{ fontFamily: "var(--font-proto-mono), monospace" }}>
                  {checkpoint.time}
                </p>
                <p className={`mt-1 text-sm font-semibold ${tone.heading}`}>{checkpoint.title}</p>
                <p className={`mt-1 text-xs ${tone.muted}`}>{checkpoint.note}</p>
              </div>
            ))}
          </div>
        </aside>
        <div className="grid gap-4 sm:grid-cols-2">
          {OPS_MODULES.map((module, index) => (
            <Link
              key={module.href}
              href={module.href}
              className={`animate-slideUp rounded-3xl border p-5 transition ${tone.card}`}
              style={{ animationDelay: `${index * 45}ms` }}
            >
              <p className={`text-xs uppercase tracking-[0.2em] ${tone.muted}`}>{module.cluster}</p>
              <h2 className={`mt-2 text-lg font-semibold ${tone.heading}`}>{module.title}</h2>
              <p className={`mt-2 text-sm ${tone.muted}`}>{module.description}</p>
              <p className={`mt-4 text-xs ${tone.accent}`} style={{ fontFamily: "var(--font-proto-mono), monospace" }}>
                {module.signal}
              </p>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  if (slug === "operations-priority-map") {
    const quadrants = [
      {
        label: "High Impact / High Urgency",
        items: OPS_MODULES.filter((module) => module.href.includes("scheduler") || module.href.includes("timeline")),
      },
      {
        label: "High Impact / Lower Urgency",
        items: OPS_MODULES.filter((module) => module.href.includes("inventory") || module.href.includes("equipment")),
      },
      {
        label: "Lower Impact / High Urgency",
        items: OPS_MODULES.filter((module) => module.href.includes("service") || module.href.includes("dnr")),
      },
      {
        label: "Lower Impact / Lower Urgency",
        items: OPS_MODULES.filter((module) => module.href.includes("site-survey") || module.href.includes("inspection")),
      },
    ];

    return (
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        {quadrants.map((quadrant, index) => (
          <article
            key={quadrant.label}
            className={`animate-slideUp rounded-3xl border p-5 backdrop-blur ${tone.panel}`}
            style={{ animationDelay: `${index * 90}ms` }}
          >
            <p className={`text-xs uppercase tracking-[0.2em] ${tone.muted}`}>{quadrant.label}</p>
            <div className="mt-4 space-y-3">
              {quadrant.items.map((item) => (
                <Link key={item.href} href={item.href} className={`block rounded-2xl border p-4 transition ${tone.card}`}>
                  <p className={`text-sm font-semibold ${tone.heading}`}>{item.title}</p>
                  <p className={`mt-1 text-xs ${tone.muted}`}>{item.signal}</p>
                </Link>
              ))}
            </div>
          </article>
        ))}
      </section>
    );
  }

  return (
    <section className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_2fr]">
      <aside className={`animate-slideUp rounded-3xl border p-5 backdrop-blur ${tone.panel}`}>
        <p className={`text-xs uppercase tracking-[0.25em] ${tone.muted}`}>Dispatch Radar</p>
        <div className="mt-4 space-y-3">
          {SHIFT_CHECKPOINTS.map((checkpoint) => (
            <div key={checkpoint.time} className={`rounded-2xl border p-4 ${tone.card}`}>
              <p className={`text-xs ${tone.accent}`} style={{ fontFamily: "var(--font-proto-mono), monospace" }}>
                {checkpoint.time}
              </p>
              <p className={`mt-1 text-sm font-semibold ${tone.heading}`}>{checkpoint.title}</p>
              <p className={`mt-1 text-xs ${tone.muted}`}>{checkpoint.note}</p>
            </div>
          ))}
        </div>
      </aside>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {OPS_MODULES.map((module, index) => (
          <Link
            key={module.href}
            href={module.href}
            className={`animate-slideUp rounded-3xl border p-5 transition ${tone.card}`}
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className={`text-base font-semibold ${tone.heading}`}>{module.title}</h2>
              <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${tone.chip}`}>
                {module.cluster}
              </span>
            </div>
            <p className={`mt-3 text-sm ${tone.muted}`}>{module.description}</p>
            <p className={`mt-4 text-xs ${tone.accent}`} style={{ fontFamily: "var(--font-proto-mono), monospace" }}>
              {module.signal}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function renderExecutiveBody(slug: string, tone: ReturnType<typeof getToneClasses>) {
  if (slug === "executive-ledger") {
    return (
      <section className={`mt-6 animate-slideUp rounded-3xl border p-4 backdrop-blur sm:p-6 ${tone.panel}`}>
        <div className="grid gap-3">
          {EXEC_VIEWS.map((view) => (
            <Link
              key={view.href}
              href={view.href}
              className={`grid items-center gap-3 rounded-2xl border p-4 transition sm:grid-cols-[180px_1fr_140px] ${tone.card}`}
            >
              <p className={`text-sm font-semibold ${tone.heading}`}>{view.title}</p>
              <p className={`text-sm ${tone.muted}`}>{view.detail}</p>
              <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${tone.chip}`}>
                {view.track}
              </span>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  if (slug === "executive-compass") {
    const quadrants = [
      { label: "Value Expansion", views: EXEC_VIEWS.filter((view) => view.track === "Finance") },
      { label: "Execution Control", views: EXEC_VIEWS.filter((view) => view.track === "Leadership") },
      { label: "Regional Position", views: EXEC_VIEWS.filter((view) => view.track === "Strategy") },
      { label: "Timing Precision", views: EXEC_VIEWS.filter((view) => view.href.includes("calendar")) },
    ];
    return (
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        {quadrants.map((quadrant, index) => (
          <article
            key={quadrant.label}
            className={`animate-slideUp rounded-3xl border p-5 backdrop-blur ${tone.panel}`}
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <p className={`text-xs uppercase tracking-[0.2em] ${tone.muted}`}>{quadrant.label}</p>
            <div className="mt-4 space-y-3">
              {quadrant.views.map((view) => (
                <Link key={view.href} href={view.href} className={`block rounded-2xl border p-4 transition ${tone.card}`}>
                  <p className={`text-base font-semibold ${tone.heading}`}>{view.title}</p>
                  <p className={`mt-1 text-sm ${tone.muted}`}>{view.detail}</p>
                </Link>
              ))}
            </div>
          </article>
        ))}
      </section>
    );
  }

  if (slug === "executive-portfolio") {
    return (
      <section className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <article className={`animate-slideUp rounded-3xl border p-6 backdrop-blur ${tone.panel}`}>
          <p className={`text-xs uppercase tracking-[0.24em] ${tone.muted}`}>Portfolio Narrative</p>
          <p className={`mt-4 text-xl leading-relaxed ${tone.heading}`} style={{ fontFamily: "var(--font-proto-newsreader), serif" }}>
            Revenue momentum remains positive, but concentration risk and permitting drift require tighter
            weekly steering. Use the linked executive dashboards for targeted corrective action.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {EXEC_VIEWS.map((view) => (
              <Link key={view.href} href={view.href} className={`rounded-2xl border p-4 transition ${tone.card}`}>
                <p className={`text-sm font-semibold ${tone.heading}`}>{view.title}</p>
                <p className={`mt-1 text-xs ${tone.muted}`}>{view.detail}</p>
              </Link>
            ))}
          </div>
        </article>
        <aside className={`animate-slideUp rounded-3xl border p-5 backdrop-blur ${tone.panel}`}>
          <p className={`text-xs uppercase tracking-[0.24em] ${tone.muted}`}>Risk Strip</p>
          <div className="mt-4 space-y-3">
            {EXEC_RISKS.map((risk) => (
              <Link key={risk.risk} href={risk.href} className={`block rounded-2xl border p-4 transition ${tone.card}`}>
                <p className={`text-sm font-semibold ${tone.heading}`}>{risk.risk}</p>
                <p className={`mt-1 text-xs ${tone.accent}`}>{risk.action}</p>
              </Link>
            ))}
          </div>
        </aside>
      </section>
    );
  }

  if (slug === "executive-risk-wall") {
    return (
      <section className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <article className={`animate-slideUp rounded-3xl border p-5 backdrop-blur ${tone.panel}`}>
          <p className={`text-xs uppercase tracking-[0.24em] ${tone.muted}`}>Current Risk Wall</p>
          <div className="mt-4 space-y-3">
            {EXEC_RISKS.map((risk, index) => (
              <Link
                key={risk.risk}
                href={risk.href}
                className={`block rounded-2xl border p-4 transition ${tone.card}`}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <p className={`text-sm font-semibold ${tone.heading}`}>{risk.risk}</p>
                <p className={`mt-1 text-xs ${tone.muted}`}>Recommended route: {risk.action}</p>
              </Link>
            ))}
          </div>
        </article>
        <aside className={`animate-slideUp rounded-3xl border p-5 backdrop-blur ${tone.panel}`}>
          <p className={`text-xs uppercase tracking-[0.24em] ${tone.muted}`}>Executive Routes</p>
          <div className="mt-4 space-y-3">
            {EXEC_VIEWS.map((view) => (
              <Link key={view.href} href={view.href} className={`block rounded-2xl border p-4 transition ${tone.card}`}>
                <p className={`text-sm font-semibold ${tone.heading}`}>{view.title}</p>
                <p className={`mt-1 text-xs ${tone.muted}`}>{view.track}</p>
              </Link>
            ))}
          </div>
        </aside>
      </section>
    );
  }

  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-2">
      {EXEC_VIEWS.map((view, index) => (
        <Link
          key={view.href}
          href={view.href}
          className={`animate-slideUp rounded-3xl border p-5 transition ${tone.card}`}
          style={{ animationDelay: `${index * 65}ms` }}
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className={`text-2xl font-bold ${tone.heading}`} style={{ fontFamily: "var(--font-proto-newsreader), serif" }}>
              {view.title}
            </h2>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${tone.chip}`}>
              {view.track}
            </span>
          </div>
          <p className={`mt-3 text-sm ${tone.muted}`}>{view.detail}</p>
        </Link>
      ))}
    </section>
  );
}

export default async function ExtraLayoutPrototypePage({
  params,
}: {
  params: Promise<{ prototype: string }>;
}) {
  const { prototype: slug } = await params;
  const config = getPrototypeBySlug(slug);
  if (!config) notFound();

  const tone = getToneClasses(config.tone);

  return (
    <div
      className={`${sora.variable} ${newsreader.variable} ${jetbrainsMono.variable} min-h-screen ${tone.baseText}`}
      style={{
        background: tone.background,
        fontFamily: "var(--font-proto-sora), var(--font-geist-sans), sans-serif",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <header className={`rounded-3xl border p-6 shadow-2xl backdrop-blur-sm sm:p-8 ${tone.panel} ${tone.shadow}`}>
          <p className={`text-xs uppercase tracking-[0.3em] ${tone.muted}`}>
            {config.family === "operations" ? "Operations Variant" : "Executive Variant"}
          </p>
          <h1 className={`mt-3 text-3xl font-semibold leading-tight sm:text-4xl ${tone.heading}`}>
            {config.title}
          </h1>
          <p className={`mt-4 max-w-3xl text-sm sm:text-base ${tone.muted}`}>{config.description}</p>
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <Link href="/prototypes/layout-refresh" className={`rounded-full border px-3 py-1.5 transition ${tone.card} ${tone.action}`}>
              Back to Prototype Hub
            </Link>
            <Link href={config.replaces} className={`rounded-full border px-3 py-1.5 transition ${tone.chip}`}>
              Current View
            </Link>
          </div>
        </header>

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          {EXEC_KPIS.slice(0, config.family === "operations" ? 3 : 4).map((kpi, index) => (
            <article
              key={kpi.label}
              className={`animate-slideUp rounded-2xl border p-4 backdrop-blur ${tone.panel}`}
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <p className={`text-xs uppercase tracking-[0.2em] ${tone.muted}`}>{kpi.label}</p>
              <p className={`mt-2 text-2xl font-bold ${tone.heading}`} style={{ fontFamily: "var(--font-proto-newsreader), serif" }}>
                {kpi.value}
              </p>
              <p className={`mt-1 text-sm ${tone.accent}`}>{kpi.delta}</p>
            </article>
          ))}
        </section>

        {config.family === "operations" ? renderOperationsBody(config.slug, tone) : renderExecutiveBody(config.slug, tone)}
      </main>
    </div>
  );
}
