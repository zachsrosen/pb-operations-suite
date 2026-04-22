import Link from "next/link";

export const dynamic = "force-dynamic";

type Tile = {
  href: string;
  title: string;
  description: string;
  icon: string;
};

const TILES: Tile[] = [
  {
    href: "/estimator/new-install?step=address",
    title: "New Installation",
    description: "Get an estimate on a complete solar system",
    icon: "☀",
  },
  {
    href: "/estimator/ev-charger?step=address",
    title: "EV Charger",
    description: "Tesla universal wall connector + install",
    icon: "⚡",
  },
  {
    href: "/estimator/battery?step=address",
    title: "Home Backup Battery",
    description: "Quote for a backup battery",
    icon: "🔋",
  },
  {
    href: "/estimator/system-expansion?step=address",
    title: "System Expansion",
    description: "Add more panels to your existing system",
    icon: "＋",
  },
  {
    href: "/estimator/detach-reset?step=from-address",
    title: "Detach & Reset",
    description: "Move your solar system to a new home",
    icon: "↔",
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
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          What kind of estimate do you need?
        </h1>
        <p className="mt-2 text-sm text-muted">
          Choose the option that fits your project.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TILES.map((tile) => (
          <Link
            key={tile.href}
            href={`${tile.href}${embedSuffix}`}
            className="group flex items-start gap-4 rounded-2xl border border-t-border bg-surface p-5 shadow-card transition hover:border-orange-500/50 hover:bg-surface-elevated"
          >
            <div
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-xl text-orange-500"
            >
              {tile.icon}
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold tracking-tight group-hover:text-foreground">
                {tile.title}
              </h2>
              <p className="text-sm text-muted">{tile.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
