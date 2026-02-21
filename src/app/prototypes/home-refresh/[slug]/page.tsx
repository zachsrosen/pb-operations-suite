import Link from "next/link";
import { notFound } from "next/navigation";
import { Bebas_Neue, IBM_Plex_Mono, Newsreader, Space_Grotesk } from "next/font/google";
import { HOME_METRICS, HOME_PROTOTYPES, HOME_SUITES, getHomePrototypeBySlug } from "../catalog";
import FilterToggles from "../FilterToggles";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-home-space",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-home-news",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-home-mono",
  weight: ["400", "500", "600"],
});

const bebasNeue = Bebas_Neue({
  subsets: ["latin"],
  variable: "--font-home-bebas",
  weight: "400",
});

const PRIORITY_ALERTS = [
  "Permitting queue is +11% week-over-week",
  "2 crews under-utilized in North County",
  "17 same-week service revisits still open",
  "Inspection approvals dipping in SD South",
];

const MORNING_CHECKLIST = [
  "07:20 Dispatch standup",
  "09:15 Permitting escalation sweep",
  "12:00 Midday balance review",
  "15:45 Tomorrow lock and route sync",
];

const QUICK_COMMANDS = [
  "open operations --priority",
  "open executive --risk-strip",
  "open service --revisits",
  "open admin --security",
];

function UtilityLinks({ dark }: { dark: boolean }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.15em]">
      <Link
        href="/prototypes/home-refresh"
        className={`rounded-full border px-3 py-1.5 transition ${
          dark
            ? "border-white/30 bg-white/10 text-slate-100 hover:bg-white/20"
            : "border-slate-900/25 bg-white text-slate-800 hover:bg-slate-100"
        }`}
      >
        All prototypes
      </Link>
      <Link
        href="/"
        className={`rounded-full border px-3 py-1.5 transition ${
          dark
            ? "border-cyan-200/40 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
            : "border-slate-900/20 bg-slate-900/5 text-slate-800 hover:bg-slate-900/10"
        }`}
      >
        Current homepage
      </Link>
    </div>
  );
}

function CommandDeckPrototype() {
  return (
    <div
      className="min-h-screen text-slate-100"
      style={{
        background:
          "radial-gradient(circle at 11% 0%, rgba(56, 189, 248, 0.28), transparent 33%), radial-gradient(circle at 91% 10%, rgba(251, 191, 36, 0.2), transparent 34%), linear-gradient(165deg, #050c1a 0%, #0a1528 45%, #111f36 100%)",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="rounded-3xl border border-white/15 bg-slate-950/45 p-6 shadow-2xl shadow-black/40 backdrop-blur-sm sm:p-8">
          <p className="text-xs uppercase tracking-[0.34em] text-cyan-100/90">Prototype 01</p>
          <h1 className="mt-4 text-3xl font-semibold sm:text-5xl">PB Operations Command Deck</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-200 sm:text-base">
            A high-contrast control-room shell that puts alerts and primary suite launch targets above everything
            else.
          </p>
          <UtilityLinks dark />
        </header>

        <div className="mt-5">
          <FilterToggles dark />
        </div>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {HOME_METRICS.map((metric, index) => (
            <article
              key={metric.label}
              className="animate-slideUp rounded-2xl border border-cyan-200/25 bg-slate-950/45 p-4"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/85">{metric.label}</p>
              <p className="mt-2 text-3xl font-semibold text-white">{metric.value}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[1.3fr_1fr]">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {HOME_SUITES.map((suite, index) => (
              <Link
                key={suite.href}
                href={suite.href}
                className="animate-slideUp rounded-3xl border border-white/12 bg-slate-950/38 p-5 transition hover:-translate-y-1 hover:border-cyan-200/50 hover:bg-slate-900/55"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <span className="rounded-full border border-white/25 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-200">
                  {suite.tag}
                </span>
                <h2 className="mt-4 text-xl font-semibold text-white">{suite.title}</h2>
                <p className="mt-2 text-sm text-slate-300">{suite.description}</p>
              </Link>
            ))}
          </div>

          <aside className="rounded-3xl border border-cyan-200/25 bg-cyan-950/30 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-100/85">Priority Alerts</p>
            <div className="mt-4 space-y-3">
              {PRIORITY_ALERTS.map((alert) => (
                <p key={alert} className="rounded-2xl border border-white/12 bg-slate-950/45 px-4 py-3 text-sm text-slate-100">
                  {alert}
                </p>
              ))}
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

function SunriseBriefingPrototype() {
  return (
    <div
      className="min-h-screen text-slate-900"
      style={{
        background:
          "radial-gradient(circle at 6% -8%, rgba(56, 189, 248, 0.18), transparent 34%), radial-gradient(circle at 93% 4%, rgba(251, 191, 36, 0.2), transparent 36%), linear-gradient(170deg, #f8fbfd 0%, #eff5f6 55%, #fdf5e7 100%)",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="rounded-3xl border border-slate-900/12 bg-white/85 p-6 shadow-xl shadow-slate-900/10 backdrop-blur-sm sm:p-8">
          <p className="text-xs uppercase tracking-[0.32em] text-slate-600">Prototype 02</p>
          <h1 className="mt-4 text-3xl font-semibold sm:text-5xl" style={{ fontFamily: "var(--font-home-news), serif" }}>
            Sunrise Briefing
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-700 sm:text-base">
            A calm morning brief with a clear sequence: schedule checkpoints first, then suite launch cards.
          </p>
          <UtilityLinks dark={false} />
        </header>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_2fr]">
          <aside className="rounded-3xl border border-slate-900/12 bg-white/80 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-600">Morning Checklist</p>
            <ol className="mt-4 space-y-3 text-sm text-slate-800">
              {MORNING_CHECKLIST.map((item) => (
                <li key={item} className="rounded-2xl border border-slate-900/10 bg-slate-50 px-4 py-3">
                  {item}
                </li>
              ))}
            </ol>
          </aside>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {HOME_SUITES.map((suite, index) => (
              <Link
                key={suite.href}
                href={suite.href}
                className="animate-slideUp rounded-3xl border border-slate-900/10 bg-white/90 p-5 transition hover:-translate-y-1 hover:border-slate-900/30"
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{suite.tag}</p>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">{suite.title}</h2>
                <p className="mt-2 text-sm text-slate-700">{suite.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function LedgerPaperPrototype() {
  return (
    <div className="min-h-screen bg-[#f3efe6] text-[#151515]">
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="border-y-2 border-[#151515] py-6">
          <p className="text-xs uppercase tracking-[0.3em] text-[#444]">Prototype 03</p>
          <h1 className="mt-2 text-4xl leading-tight sm:text-6xl" style={{ fontFamily: "var(--font-home-news), serif" }}>
            The Pipeline Ledger
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-[#2c2c2c] sm:text-base">
            Newspaper-style homepage prioritizing scan speed and dense operational context.
          </p>
          <UtilityLinks dark={false} />
        </header>

        <section className="mt-6 grid gap-5 lg:grid-cols-[2fr_1fr]">
          <article className="rounded-3xl border-2 border-[#151515] bg-[#faf7f0] p-5">
            <h2 className="text-xs uppercase tracking-[0.2em] text-[#555]">Front page routes</h2>
            <div className="mt-4 divide-y divide-[#151515] border-y border-[#151515]">
              {HOME_SUITES.map((suite) => (
                <Link key={suite.href} href={suite.href} className="block py-4 transition hover:bg-black/5">
                  <p className="text-xs uppercase tracking-[0.2em] text-[#666]">{suite.tag}</p>
                  <p className="mt-1 text-2xl leading-tight" style={{ fontFamily: "var(--font-home-news), serif" }}>
                    {suite.title}
                  </p>
                  <p className="mt-2 text-sm text-[#2d2d2d]">{suite.description}</p>
                </Link>
              ))}
            </div>
          </article>

          <aside className="space-y-4">
            {HOME_METRICS.map((metric) => (
              <div key={metric.label} className="rounded-3xl border-2 border-[#151515] bg-[#faf7f0] p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#666]">{metric.label}</p>
                <p className="mt-1 text-3xl" style={{ fontFamily: "var(--font-home-news), serif" }}>
                  {metric.value}
                </p>
              </div>
            ))}
          </aside>
        </section>
      </main>
    </div>
  );
}

function FieldRadarPrototype() {
  return (
    <div
      className="min-h-screen text-slate-100"
      style={{
        background:
          "linear-gradient(160deg, #06151c 0%, #0c1f2a 55%, #142737 100%), repeating-linear-gradient(0deg, rgba(148,163,184,0.08) 0, rgba(148,163,184,0.08) 1px, transparent 1px, transparent 34px), repeating-linear-gradient(90deg, rgba(148,163,184,0.07) 0, rgba(148,163,184,0.07) 1px, transparent 1px, transparent 34px)",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="rounded-3xl border border-white/15 bg-black/30 p-6 backdrop-blur-sm sm:p-8">
          <p className="text-xs uppercase tracking-[0.3em] text-emerald-100/85">Prototype 04</p>
          <h1 className="mt-3 text-3xl font-semibold sm:text-5xl">Field Radar</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-300 sm:text-base">
            Dispatch-centered homepage that balances urgency signals with module access.
          </p>
          <UtilityLinks dark />
        </header>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div className="grid gap-4 sm:grid-cols-2">
            {HOME_SUITES.map((suite) => (
              <Link
                key={suite.href}
                href={suite.href}
                className="rounded-3xl border border-white/12 bg-slate-950/45 p-5 transition hover:border-emerald-200/40 hover:bg-slate-900/55"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-emerald-100/80">{suite.tag}</p>
                <h2 className="mt-2 text-xl font-semibold">{suite.title}</h2>
                <p className="mt-2 text-sm text-slate-300">{suite.description}</p>
              </Link>
            ))}
          </div>

          <aside className="rounded-3xl border border-emerald-200/30 bg-emerald-950/30 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-100/90">Signal stack</p>
            <div className="mt-4 space-y-3">
              {PRIORITY_ALERTS.map((alert) => (
                <p key={alert} className="rounded-2xl border border-white/12 bg-black/30 px-4 py-3 text-sm text-slate-200">
                  {alert}
                </p>
              ))}
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

function SplitStudioPrototype() {
  return (
    <div
      className="min-h-screen text-[#1f1d1a]"
      style={{
        background:
          "radial-gradient(circle at 10% 0%, rgba(251, 191, 36, 0.22), transparent 34%), radial-gradient(circle at 95% 5%, rgba(251, 146, 60, 0.2), transparent 36%), linear-gradient(170deg, #f8f2e8 0%, #f3e9dd 56%, #efe4d4 100%)",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <section className="grid gap-4 lg:grid-cols-[1.1fr_1.4fr]">
          <article className="rounded-3xl border border-[#2f2a24]/15 bg-white/70 p-7 shadow-xl shadow-[#2f2a24]/10 backdrop-blur-sm">
            <p className="text-xs uppercase tracking-[0.3em] text-[#6a5b46]">Prototype 05</p>
            <h1 className="mt-3 text-4xl leading-tight sm:text-5xl" style={{ fontFamily: "var(--font-home-news), serif" }}>
              Split Studio Home
            </h1>
            <p className="mt-3 text-sm text-[#4e4231] sm:text-base">
              Left side focuses intention and urgency. Right side becomes a clean launcher wall.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {HOME_METRICS.slice(0, 4).map((metric) => (
                <div key={metric.label} className="rounded-2xl border border-[#2f2a24]/10 bg-white/80 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#6a5b46]">{metric.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-[#2a241d]">{metric.value}</p>
                </div>
              ))}
            </div>
            <UtilityLinks dark={false} />
          </article>

          <div className="grid gap-4 sm:grid-cols-2">
            {HOME_SUITES.map((suite, index) => (
              <Link
                key={suite.href}
                href={suite.href}
                className="animate-slideUp rounded-3xl border border-[#2f2a24]/12 bg-white/85 p-5 transition hover:-translate-y-1 hover:border-[#2f2a24]/30"
                style={{ animationDelay: `${index * 55}ms` }}
              >
                <p className="text-xs uppercase tracking-[0.2em] text-[#6a5b46]">{suite.tag}</p>
                <h2 className="mt-2 text-lg font-semibold text-[#211d18]">{suite.title}</h2>
                <p className="mt-2 text-sm text-[#504535]">{suite.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function MetroBlocksPrototype() {
  const blockClasses = [
    "bg-[#0f766e] text-teal-50",
    "bg-[#dc2626] text-red-50",
    "bg-[#0f172a] text-slate-50",
    "bg-[#c2410c] text-orange-50",
    "bg-[#1d4ed8] text-blue-50",
    "bg-[#166534] text-green-50",
  ];

  return (
    <div className="min-h-screen bg-[#f6f4ef] text-slate-900">
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="rounded-3xl border-2 border-slate-900 bg-white p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.32em] text-slate-600">Prototype 06</p>
          <h1 className="mt-2 text-6xl leading-none sm:text-7xl" style={{ fontFamily: "var(--font-home-bebas), sans-serif" }}>
            METRO BLOCKS
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-700 sm:text-base">
            A bold geometric launcher where each suite gets a unique visual zone.
          </p>
          <UtilityLinks dark={false} />
        </header>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {HOME_SUITES.map((suite, index) => (
            <Link
              key={suite.href}
              href={suite.href}
              className={`rounded-3xl border-2 border-slate-900 p-5 transition hover:-translate-y-1 ${blockClasses[index % blockClasses.length]}`}
            >
              <p className="text-xs uppercase tracking-[0.2em] opacity-85">{suite.tag}</p>
              <h2 className="mt-2 text-4xl leading-none" style={{ fontFamily: "var(--font-home-bebas), sans-serif" }}>
                {suite.title.replace(" Suite", "")}
              </h2>
              <p className="mt-3 text-sm opacity-90">{suite.description}</p>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}

function TerminalFlowPrototype() {
  return (
    <div className="min-h-screen bg-[#060f08] text-emerald-100">
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10" style={{ fontFamily: "var(--font-home-mono), monospace" }}>
        <header className="rounded-3xl border border-emerald-200/35 bg-black/45 p-6 shadow-2xl shadow-black/40 sm:p-8">
          <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-300/85">Prototype 07</p>
          <h1 className="mt-3 text-2xl sm:text-4xl">Terminal Flow // Home Route</h1>
          <p className="mt-2 max-w-3xl text-sm text-emerald-100/80">
            Fast-access terminal look for users who live in shortcuts and status logs.
          </p>
          <UtilityLinks dark />
        </header>

        <section className="mt-6 rounded-3xl border border-emerald-200/30 bg-black/45 p-5">
          <p className="text-xs text-emerald-300/80">$ quick-commands</p>
          <div className="mt-3 space-y-2 text-sm">
            {QUICK_COMMANDS.map((command) => (
              <p key={command} className="rounded-xl border border-emerald-200/20 bg-emerald-300/5 px-3 py-2">
                &gt; {command}
              </p>
            ))}
          </div>
        </section>

        <section className="mt-6 grid gap-3">
          {HOME_SUITES.map((suite) => (
            <Link
              key={suite.href}
              href={suite.href}
              className="rounded-2xl border border-emerald-200/25 bg-black/45 px-4 py-3 transition hover:border-emerald-200/45 hover:bg-emerald-300/10"
            >
              <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300/80">[{suite.tag}]</p>
              <p className="mt-1 text-base font-medium text-emerald-50">./{suite.title.toLowerCase().replace(/\s+/g, "-")}</p>
              <p className="mt-1 text-sm text-emerald-100/75">{suite.description}</p>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}

function StoryScrollPrototype() {
  return (
    <div className="min-h-screen bg-[#f4f7fa] text-slate-900">
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="rounded-3xl bg-white p-7 shadow-xl shadow-slate-900/10">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Prototype 08</p>
          <h1 className="mt-3 text-3xl font-semibold sm:text-5xl">Story Scroll</h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-700 sm:text-base">
            Narrative flow designed for context-first onboarding before action.
          </p>
          <UtilityLinks dark={false} />
        </header>

        <div className="mt-5">
          <FilterToggles dark={false} />
        </div>

        <section className="mt-6 rounded-3xl border border-slate-900/10 bg-white p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Chapter 1: System health</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOME_METRICS.map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-slate-900/10 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{metric.label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{metric.value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5 rounded-3xl border border-slate-900/10 bg-white p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Chapter 2: Top signals</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PRIORITY_ALERTS.map((alert) => (
              <p key={alert} className="rounded-2xl border border-slate-900/10 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                {alert}
              </p>
            ))}
          </div>
        </section>

        <section className="mt-5 rounded-3xl border border-slate-900/10 bg-white p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Chapter 3: Route into work</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {HOME_SUITES.map((suite) => (
              <Link key={suite.href} href={suite.href} className="rounded-2xl border border-slate-900/10 bg-slate-50 p-4 transition hover:bg-slate-100">
                <h2 className="text-lg font-semibold text-slate-900">{suite.title}</h2>
                <p className="mt-2 text-sm text-slate-700">{suite.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function SignalOrbitPrototype() {
  return (
    <div
      className="min-h-screen text-slate-100"
      style={{
        background:
          "radial-gradient(circle at 50% 45%, rgba(34, 211, 238, 0.2), transparent 28%), radial-gradient(circle at 50% 45%, rgba(251, 146, 60, 0.16), transparent 48%), linear-gradient(170deg, #030712 0%, #0b1320 55%, #111827 100%)",
      }}
    >
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-100/80">Prototype 09</p>
          <h1 className="mt-3 text-3xl font-semibold sm:text-5xl">Signal Orbit</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-300 sm:text-base">
            Radial navigation concept where suites orbit a central system status core.
          </p>
          <div className="mt-4 flex justify-center">
            <UtilityLinks dark />
          </div>
        </header>

        <section className="mt-10 hidden gap-6 lg:grid lg:grid-cols-[1fr_280px] lg:items-center">
          <div className="relative mx-auto flex h-[480px] w-full max-w-[520px] items-center justify-center rounded-full border border-cyan-200/25 bg-slate-950/40">
            <div className="absolute h-56 w-56 rounded-full border border-white/25 bg-cyan-300/10 p-6 text-center backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/80">System core</p>
              <p className="mt-3 text-4xl font-semibold text-white">87%</p>
              <p className="mt-1 text-sm text-slate-200">Crew utilization</p>
            </div>

            {HOME_SUITES.map((suite, index) => {
              const angle = (index / HOME_SUITES.length) * Math.PI * 2;
              const x = Math.cos(angle) * 180;
              const y = Math.sin(angle) * 180;
              return (
                <Link
                  key={suite.href}
                  href={suite.href}
                  className="absolute w-40 rounded-2xl border border-white/18 bg-slate-950/65 px-3 py-2 text-center text-xs text-slate-100 transition hover:border-cyan-200/50 hover:bg-slate-900"
                  style={{ transform: `translate(${x}px, ${y}px)` }}
                >
                  <p className="uppercase tracking-[0.18em] text-cyan-100/70">{suite.tag}</p>
                  <p className="mt-1 text-sm font-medium text-white">{suite.title.replace(" Suite", "")}</p>
                </Link>
              );
            })}
          </div>

          <aside className="space-y-3 rounded-3xl border border-white/15 bg-slate-950/45 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/80">Orbit notes</p>
            {PRIORITY_ALERTS.slice(0, 3).map((alert) => (
              <p key={alert} className="rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-slate-200">
                {alert}
              </p>
            ))}
          </aside>
        </section>

        <section className="mt-8 space-y-4 lg:hidden">
          <aside className="space-y-3 rounded-3xl border border-white/15 bg-slate-950/45 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/80">Orbit notes</p>
            {PRIORITY_ALERTS.slice(0, 3).map((alert) => (
              <p key={alert} className="rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-slate-200">
                {alert}
              </p>
            ))}
          </aside>
          <div className="grid gap-3">
          {HOME_SUITES.map((suite) => (
            <Link key={suite.href} href={suite.href} className="rounded-2xl border border-white/15 bg-slate-950/55 px-4 py-3 text-sm">
              {suite.title}
            </Link>
          ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function CompactTacticalPrototype() {
  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="rounded-2xl border border-white/12 bg-slate-900/75 px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Prototype 10</p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Compact Tactical</h1>
          <p className="mt-1 text-sm text-slate-300">High-density board optimized for speed and reduced scrolling.</p>
          <UtilityLinks dark />
        </header>

        <section className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {HOME_METRICS.map((metric) => (
            <div key={metric.label} className="rounded-xl border border-white/12 bg-slate-900/65 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{metric.label}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{metric.value}</p>
            </div>
          ))}
        </section>

        <section className="mt-4 overflow-x-auto rounded-2xl border border-white/12 bg-slate-900/75">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/12 text-xs uppercase tracking-[0.2em] text-slate-400">
                <th className="px-4 py-3">Suite</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Tag</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {HOME_SUITES.map((suite, index) => (
                <tr key={suite.href} className={index % 2 ? "bg-white/0" : "bg-white/[0.03]"}>
                  <td className="px-4 py-3 font-medium text-white">{suite.title}</td>
                  <td className="px-4 py-3 text-slate-300">{suite.description}</td>
                  <td className="px-4 py-3 text-slate-400">{suite.tag}</td>
                  <td className="px-4 py-3">
                    <Link href={suite.href} className="rounded-lg border border-cyan-200/40 px-3 py-1.5 text-xs uppercase tracking-[0.16em] text-cyan-100 hover:bg-cyan-300/10">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

function TealSteelBriefingPrototype() {
  return (
    <div
      className="min-h-screen text-slate-100"
      style={{
        background:
          "radial-gradient(circle at 12% 0%, rgba(45, 212, 191, 0.24), transparent 34%), radial-gradient(circle at 88% 8%, rgba(148, 163, 184, 0.2), transparent 36%), linear-gradient(165deg, #06121d 0%, #0b1926 52%, #132433 100%)",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="rounded-3xl border border-cyan-100/20 bg-slate-950/40 p-6 shadow-2xl shadow-black/35 backdrop-blur-sm sm:p-8">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-100/85">Focused Option 01</p>
          <h1 className="mt-3 text-3xl font-semibold sm:text-5xl" style={{ fontFamily: "var(--font-home-news), serif" }}>
            Teal Steel Briefing
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-300 sm:text-base">
            Story Scroll structure with Command Deck urgency. Density is intentionally in-between compact and airy.
          </p>
          <UtilityLinks dark />
        </header>

        <div className="mt-5">
          <FilterToggles dark />
        </div>

        <section className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <article className="rounded-3xl border border-white/14 bg-slate-950/40 p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/75">Chapter 1: System snapshot</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {HOME_METRICS.map((metric) => (
                <div key={metric.label} className="rounded-2xl border border-white/14 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{metric.value}</p>
                </div>
              ))}
            </div>
          </article>
          <aside className="rounded-3xl border border-cyan-100/25 bg-cyan-950/25 p-5">
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-100/85">Priority strip</p>
            <div className="mt-3 space-y-2">
              {PRIORITY_ALERTS.slice(0, 3).map((alert) => (
                <p key={alert} className="rounded-xl border border-white/14 bg-black/25 px-3 py-2 text-sm text-slate-200">
                  {alert}
                </p>
              ))}
            </div>
          </aside>
        </section>

        <section className="mt-5 rounded-3xl border border-white/14 bg-slate-950/40 p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/75">Chapter 2: Route into work</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {HOME_SUITES.map((suite) => (
              <Link
                key={suite.href}
                href={suite.href}
                className="rounded-2xl border border-white/14 bg-white/[0.02] p-4 transition hover:-translate-y-0.5 hover:border-cyan-200/45 hover:bg-cyan-300/[0.08]"
              >
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/75">{suite.tag}</p>
                <h2 className="mt-2 text-lg font-semibold text-white">{suite.title}</h2>
                <p className="mt-2 text-sm text-slate-300">{suite.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function TealSteelCommandGridPrototype() {
  return (
    <div
      className="min-h-screen text-slate-100"
      style={{
        background:
          "radial-gradient(circle at 9% -8%, rgba(56, 189, 248, 0.2), transparent 34%), radial-gradient(circle at 92% 4%, rgba(20, 184, 166, 0.24), transparent 34%), linear-gradient(166deg, #07111d 0%, #0b1725 55%, #132234 100%)",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="rounded-3xl border border-white/14 bg-slate-950/45 p-6 backdrop-blur-sm sm:p-8">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-300">Focused Option 02</p>
          <h1 className="mt-3 text-3xl font-semibold sm:text-5xl">Teal Steel Command Grid</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-300 sm:text-base">
            A premium-serious command layout with cleaner spacing and less visual noise than the original Command Deck.
          </p>
          <UtilityLinks dark />
        </header>

        <div className="mt-5">
          <FilterToggles dark />
        </div>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {HOME_METRICS.map((metric) => (
            <article key={metric.label} className="rounded-2xl border border-white/14 bg-slate-950/50 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">{metric.label}</p>
              <p className="mt-2 text-3xl font-semibold text-white">{metric.value}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[1.45fr_1fr]">
          <div className="grid gap-4 md:grid-cols-2">
            {HOME_SUITES.map((suite, index) => (
              <Link
                key={suite.href}
                href={suite.href}
                className="animate-slideUp rounded-3xl border border-white/14 bg-slate-950/45 p-5 transition hover:-translate-y-0.5 hover:border-cyan-200/45 hover:bg-slate-900/55"
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/80">{suite.tag}</p>
                <h2 className="mt-2 text-xl font-semibold text-white">{suite.title}</h2>
                <p className="mt-2 text-sm text-slate-300">{suite.description}</p>
              </Link>
            ))}
          </div>
          <aside className="rounded-3xl border border-cyan-100/25 bg-cyan-950/25 p-5">
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-100/85">Decision queue</p>
            <div className="mt-4 space-y-3">
              {PRIORITY_ALERTS.map((alert) => (
                <p key={alert} className="rounded-2xl border border-white/14 bg-slate-950/45 px-4 py-3 text-sm text-slate-200">
                  {alert}
                </p>
              ))}
            </div>
            <p className="mt-4 text-xs uppercase tracking-[0.18em] text-slate-300">Morning cadence</p>
            <div className="mt-2 grid gap-2">
              {MORNING_CHECKLIST.slice(0, 3).map((item) => (
                <p key={item} className="rounded-xl border border-white/12 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
                  {item}
                </p>
              ))}
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

function TealSteelNarrativeOpsPrototype() {
  return (
    <div
      className="min-h-screen text-slate-100"
      style={{
        background:
          "radial-gradient(circle at 14% -10%, rgba(20, 184, 166, 0.2), transparent 35%), radial-gradient(circle at 95% 6%, rgba(125, 211, 252, 0.16), transparent 34%), linear-gradient(170deg, #08121e 0%, #0d1b2a 58%, #152536 100%)",
      }}
    >
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="rounded-3xl border border-white/14 bg-slate-950/45 p-7 shadow-xl shadow-black/35">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-100/85">Focused Option 03</p>
          <h1 className="mt-3 text-3xl font-semibold sm:text-5xl" style={{ fontFamily: "var(--font-home-news), serif" }}>
            Teal Steel Narrative Ops
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-300 sm:text-base">
            Narrative chaptering with tighter operational rails, targeting a premium-serious mid-density experience.
          </p>
          <UtilityLinks dark />
        </header>

        <div className="mt-5">
          <FilterToggles dark />
        </div>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
          <article className="rounded-3xl border border-white/14 bg-slate-950/40 p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/80">Narrative rail</p>
            <div className="mt-4 space-y-3">
              {HOME_METRICS.map((metric) => (
                <div key={metric.label} className="rounded-2xl border border-white/14 bg-white/[0.03] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">{metric.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{metric.value}</p>
                </div>
              ))}
            </div>
          </article>
          <article className="rounded-3xl border border-cyan-100/24 bg-cyan-950/20 p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/85">Command priorities</p>
            <div className="mt-4 space-y-3">
              {PRIORITY_ALERTS.map((alert) => (
                <p key={alert} className="rounded-2xl border border-white/14 bg-slate-950/45 px-4 py-3 text-sm text-slate-200">
                  {alert}
                </p>
              ))}
            </div>
          </article>
        </section>

        <section className="mt-5 rounded-3xl border border-white/14 bg-slate-950/40 p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/80">Execution routes</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {HOME_SUITES.map((suite) => (
              <Link
                key={suite.href}
                href={suite.href}
                className="rounded-2xl border border-white/14 bg-white/[0.02] p-4 transition hover:border-cyan-200/45 hover:bg-cyan-300/[0.07]"
              >
                <h2 className="text-lg font-semibold text-white">{suite.title}</h2>
                <p className="mt-2 text-sm text-slate-300">{suite.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export async function generateStaticParams() {
  return HOME_PROTOTYPES.map((prototype) => ({ slug: prototype.slug }));
}

export default async function HomeRefreshPrototypePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const prototype = getHomePrototypeBySlug(slug);

  if (!prototype) {
    notFound();
  }

  return (
    <div
      className={`${spaceGrotesk.variable} ${newsreader.variable} ${plexMono.variable} ${bebasNeue.variable}`}
      style={{ fontFamily: "var(--font-home-space), var(--font-geist-sans), sans-serif" }}
    >
      {prototype.slug === "teal-steel-briefing" && <TealSteelBriefingPrototype />}
      {prototype.slug === "teal-steel-command-grid" && <TealSteelCommandGridPrototype />}
      {prototype.slug === "teal-steel-narrative-ops" && <TealSteelNarrativeOpsPrototype />}
      {prototype.slug === "command-deck" && <CommandDeckPrototype />}
      {prototype.slug === "sunrise-briefing" && <SunriseBriefingPrototype />}
      {prototype.slug === "ledger-paper" && <LedgerPaperPrototype />}
      {prototype.slug === "field-radar" && <FieldRadarPrototype />}
      {prototype.slug === "split-studio" && <SplitStudioPrototype />}
      {prototype.slug === "metro-blocks" && <MetroBlocksPrototype />}
      {prototype.slug === "terminal-flow" && <TerminalFlowPrototype />}
      {prototype.slug === "story-scroll" && <StoryScrollPrototype />}
      {prototype.slug === "signal-orbit" && <SignalOrbitPrototype />}
      {prototype.slug === "compact-tactical" && <CompactTacticalPrototype />}
    </div>
  );
}
