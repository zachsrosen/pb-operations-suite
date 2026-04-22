import Link from "next/link";

export const dynamic = "force-dynamic";

type Tile = {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  accent: string; // tailwind gradient / ring accent
  tagline: string;
};

// Small inline SVG icon set — keeps us free of icon packages while still
// looking hand-drawn / polished.
const SunIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
    <circle cx="12" cy="12" r="4" />
    <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);
const BoltIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
  </svg>
);
const BatteryIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
    <rect x="2" y="7" width="17" height="10" rx="2" />
    <rect x="5" y="10" width="5" height="4" fill="currentColor" />
    <path d="M21 10v4" strokeLinecap="round" />
  </svg>
);
const PlusSquaresIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path strokeLinecap="round" d="M17.5 14v7M14 17.5h7" />
  </svg>
);
const MoveIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4" />
  </svg>
);

const TILES: Tile[] = [
  {
    href: "/estimator/new-install?step=address",
    title: "New Installation",
    tagline: "Most popular",
    description: "Size a complete solar system for your home — panels, inverter, and everything in between.",
    icon: SunIcon,
    accent: "from-orange-500/25 to-amber-500/10 text-orange-400 ring-orange-500/40",
  },
  {
    href: "/estimator/battery?step=address",
    title: "Home Backup Battery",
    tagline: "Stay on when the grid goes out",
    description: "Add a battery to an existing system for whole-home or essential-load backup.",
    icon: BatteryIcon,
    accent: "from-emerald-500/25 to-teal-500/10 text-emerald-400 ring-emerald-500/40",
  },
  {
    href: "/estimator/ev-charger?step=address",
    title: "EV Charger",
    tagline: "Plug in at home",
    description: "Tesla Universal Wall Connector plus professional installation, quoted in under a minute.",
    icon: BoltIcon,
    accent: "from-cyan-500/25 to-sky-500/10 text-cyan-400 ring-cyan-500/40",
  },
  {
    href: "/estimator/system-expansion?step=address",
    title: "System Expansion",
    tagline: "Already have solar?",
    description: "Add more panels to cover an EV, a heat pump, or a growing household.",
    icon: PlusSquaresIcon,
    accent: "from-yellow-500/25 to-orange-500/10 text-yellow-400 ring-yellow-500/40",
  },
  {
    href: "/estimator/detach-reset?step=from-address",
    title: "Detach & Reset",
    tagline: "Moving or re-roofing",
    description: "Take down your system for a roof replacement or reinstall it at a new address.",
    icon: MoveIcon,
    accent: "from-purple-500/25 to-indigo-500/10 text-purple-400 ring-purple-500/40",
  },
];

export default async function EstimatorEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ embed?: string }>;
}) {
  if (process.env.NEXT_PUBLIC_ESTIMATOR_V2_ENABLED !== "true") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-t-border bg-surface p-8 shadow-card">
          <h1 className="text-2xl font-semibold tracking-tight">Coming soon</h1>
          <p className="mt-3 text-sm text-muted">
            Our updated solar estimator is on the way. In the meantime, request a free estimate at{" "}
            <a
              href="https://www.photonbrothers.com/free-solar-estimate"
              className="underline hover:text-foreground"
            >
              photonbrothers.com
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const embedSuffix = params.embed === "1" ? "&embed=1" : "";

  return (
    <div className="relative">
      {/* Ambient hero glow — warm orange radial on dark backgrounds */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[420px] opacity-80"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(249,115,22,0.18), transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-20">
        <header className="mb-10 text-center sm:mb-14">
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-orange-400">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
            Instant solar estimator
          </div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-5xl">
            Let&apos;s design your system.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            Answer a few quick questions and we&apos;ll size a system, estimate production, and
            ballpark the price — tailored to your home and utility.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <CheckGlyph /> Under 2 minutes
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckGlyph /> No credit card
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckGlyph /> Real Photon Brothers pricing
            </span>
          </div>
        </header>

        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
          What kind of project?
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {TILES.map((tile, idx) => (
            <Link
              key={tile.href}
              href={`${tile.href}${embedSuffix}`}
              className={`group relative flex items-start gap-4 overflow-hidden rounded-2xl border border-t-border bg-surface p-6 shadow-card transition-all hover:-translate-y-0.5 hover:border-orange-500/50 hover:shadow-card-lg ${
                idx === 0 ? "sm:col-span-2" : ""
              }`}
            >
              <div
                aria-hidden
                className={`absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${tile.accent}`}
                style={{ maskImage: "linear-gradient(to bottom, black, transparent 70%)" }}
              />
              <div
                className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset ${tile.accent}`}
              >
                {tile.icon}
              </div>
              <div className="relative flex flex-1 flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-lg font-semibold tracking-tight">{tile.title}</h3>
                  <span className="hidden shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted sm:inline">
                    {tile.tagline}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-muted">{tile.description}</p>
              </div>
              <span
                aria-hidden
                className="relative self-center text-muted transition group-hover:translate-x-1 group-hover:text-orange-500"
              >
                →
              </span>
            </Link>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-muted">
          Not sure which to pick?{" "}
          <a
            href="https://www.photonbrothers.com/free-solar-estimate"
            className="underline hover:text-foreground"
          >
            Talk to a real human
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 text-orange-500">
      <path
        d="M4 10l4 4 8-8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
