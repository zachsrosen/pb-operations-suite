import Link from "next/link";
import { Space_Grotesk } from "next/font/google";
import { EXTRA_LAYOUT_PROTOTYPES } from "./catalog";
import { INTERNAL_PAGE_PROTOTYPES } from "./internal/catalog";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-prototype-space",
});

const PROTOTYPES = [
  {
    href: "/prototypes/layout-refresh/operations",
    title: "Operations: Mission Control",
    replaces: "/suites/operations",
    description:
      "Priority-first command layout with shift timeline, hot modules, and stronger visual hierarchy.",
    accent: "from-cyan-400/30 via-sky-400/20 to-transparent",
  },
  {
    href: "/prototypes/layout-refresh/department",
    title: "Department: Workflow Atlas",
    replaces: "/suites/department",
    description:
      "Process-oriented board that groups dashboards by pipeline phase instead of a flat list.",
    accent: "from-emerald-400/30 via-teal-400/15 to-transparent",
  },
  {
    href: "/prototypes/layout-refresh/executive",
    title: "Executive: Signal Board",
    replaces: "/suites/executive",
    description:
      "Narrative leadership view with KPI rails, risk strip, and high-clarity route cards.",
    accent: "from-amber-400/35 via-orange-400/15 to-transparent",
  },
];

const EXTRA_PROTO_GROUPS = [
  {
    title: "Operations Variants",
    family: "operations",
  },
  {
    title: "Executive Variants",
    family: "executive",
  },
];

const REVIEW_POINTS = [
  "All current suite views share nearly identical composition, so every page has the same visual priority.",
  "Primary actions are mixed with secondary modules, which slows scanning when users are triaging work.",
  "The existing card-only approach does not communicate urgency, sequence, or ownership at first glance.",
];

export default function LayoutRefreshPrototypeHubPage() {
  return (
    <div
      className={`${spaceGrotesk.variable} min-h-screen text-slate-100`}
      style={{
        background:
          "radial-gradient(circle at 15% 10%, rgba(34, 211, 238, 0.18), transparent 38%), radial-gradient(circle at 82% 4%, rgba(251, 191, 36, 0.15), transparent 35%), linear-gradient(160deg, #07111f 0%, #0b1220 50%, #101827 100%)",
        fontFamily: "var(--font-prototype-space), var(--font-geist-sans), sans-serif",
      }}
    >
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        <header className="rounded-3xl border border-white/10 bg-slate-950/35 p-6 shadow-2xl shadow-slate-950/40 backdrop-blur-sm sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/85">Layout Review</p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">
            Suite Layout Replacement Prototypes
          </h1>
          <p className="mt-4 max-w-3xl text-sm text-slate-300 sm:text-base">
            Three high-fidelity alternatives are ready for direct comparison, each aimed at replacing one
            suite entry view without changing your route destinations.
          </p>
          <ul className="mt-6 grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
            {REVIEW_POINTS.map((point) => (
              <li key={point} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                {point}
              </li>
            ))}
          </ul>
        </header>

        <section className="mt-8 grid gap-5 md:grid-cols-3">
          {PROTOTYPES.map((prototype) => (
            <Link
              key={prototype.href}
              href={prototype.href}
              className="group rounded-3xl border border-white/10 bg-slate-950/30 p-6 transition duration-300 hover:-translate-y-1 hover:border-white/30 hover:bg-slate-900/45"
            >
              <div className={`h-24 rounded-2xl bg-gradient-to-br ${prototype.accent} to-transparent`} />
              <h2 className="mt-5 text-lg font-semibold text-white">{prototype.title}</h2>
              <p className="mt-3 text-sm text-slate-300">{prototype.description}</p>
              <p className="mt-4 text-xs uppercase tracking-[0.2em] text-slate-400">
                Replaces <span className="text-slate-200">{prototype.replaces}</span>
              </p>
              <p className="mt-3 text-sm font-medium text-cyan-200 group-hover:text-white">
                Open prototype
              </p>
            </Link>
          ))}
        </section>

        <section className="mt-8">
          <Link
            href="/prototypes/layout-refresh/internal"
            className="group block rounded-3xl border border-cyan-200/20 bg-cyan-950/25 p-6 transition duration-300 hover:-translate-y-1 hover:border-cyan-200/40 hover:bg-cyan-950/40"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-100/80">Full Internal Coverage</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Prototype Every Suite-Linked Page</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              Open a complete catalog of page-level prototypes for all dashboards and admin pages linked
              inside your suites.
            </p>
            <p className="mt-3 text-sm font-medium text-cyan-100">
              Browse {INTERNAL_PAGE_PROTOTYPES.length} internal page prototypes
            </p>
          </Link>
        </section>

        <section className="mt-10 space-y-8">
          {EXTRA_PROTO_GROUPS.map((group) => (
            <div key={group.title}>
              <h2 className="text-xl font-semibold text-white">{group.title}</h2>
              <p className="mt-2 text-sm text-slate-300">
                5 additional concepts focused on {group.family} navigation and hierarchy.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {EXTRA_LAYOUT_PROTOTYPES.filter((prototype) => prototype.family === group.family).map((prototype) => (
                  <Link
                    key={prototype.slug}
                    href={`/prototypes/layout-refresh/${prototype.slug}`}
                    className="group rounded-3xl border border-white/10 bg-slate-950/25 p-5 transition duration-300 hover:-translate-y-1 hover:border-white/30 hover:bg-slate-900/45"
                  >
                    <div className={`h-20 rounded-2xl bg-gradient-to-br ${prototype.accent} to-transparent`} />
                    <h3 className="mt-4 text-base font-semibold text-white">{prototype.title}</h3>
                    <p className="mt-2 text-sm text-slate-300">{prototype.description}</p>
                    <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-400">
                      Replaces <span className="text-slate-200">{prototype.replaces}</span>
                    </p>
                    <p className="mt-3 text-sm font-medium text-cyan-200 group-hover:text-white">
                      Open prototype
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>

        <div className="mt-8">
          <Link href="/" className="text-sm text-slate-300 hover:text-white">
            Back to Home
          </Link>
        </div>
      </main>
    </div>
  );
}
