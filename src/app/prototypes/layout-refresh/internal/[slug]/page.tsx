import Link from "next/link";
import { notFound } from "next/navigation";
import { JetBrains_Mono, Outfit, Playfair_Display } from "next/font/google";
import {
  INTERNAL_GROUP_LABELS,
  INTERNAL_PAGE_PROTOTYPES,
  getInternalPrototypeBySlug,
  type InternalPrototypeGroup,
} from "../catalog";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-page-outfit",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-page-mono",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-page-display",
});

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

function getGroupStyle(group: InternalPrototypeGroup) {
  if (group === "operations" || group === "service") {
    return {
      background:
        "radial-gradient(circle at 19% -6%, rgba(14, 165, 233, 0.24), transparent 38%), radial-gradient(circle at 86% 9%, rgba(45, 212, 191, 0.18), transparent 35%), linear-gradient(164deg, #031626 0%, #061426 48%, #0a2031 100%)",
      panel: "bg-slate-950/42 border-cyan-200/20",
      card: "bg-slate-950/34 border-white/12 hover:border-cyan-200/42",
      text: "text-slate-100",
      muted: "text-slate-300",
      accent: "text-cyan-200",
      chip: "bg-cyan-200/10 text-cyan-100 border-cyan-200/30",
    };
  }

  if (group === "department" || group === "documentation") {
    return {
      background:
        "radial-gradient(circle at 10% 4%, rgba(22, 163, 74, 0.14), transparent 36%), radial-gradient(circle at 89% 7%, rgba(250, 204, 21, 0.14), transparent 35%), linear-gradient(162deg, #f8fbfc 0%, #ecf4f3 50%, #f8f2e9 100%)",
      panel: "bg-white/78 border-slate-900/10",
      card: "bg-white/88 border-slate-900/10 hover:border-slate-900/25",
      text: "text-slate-900",
      muted: "text-slate-600",
      accent: "text-emerald-700",
      chip: "bg-emerald-700/10 text-emerald-700 border-emerald-700/25",
    };
  }

  if (group === "executive") {
    return {
      background:
        "radial-gradient(circle at 77% 0%, rgba(245, 158, 11, 0.26), transparent 40%), radial-gradient(circle at 15% 14%, rgba(30, 64, 175, 0.22), transparent 36%), linear-gradient(151deg, #130f12 0%, #17121d 48%, #1e1521 100%)",
      panel: "bg-black/28 border-amber-200/20",
      card: "bg-black/24 border-white/14 hover:border-amber-100/35",
      text: "text-[#f5f1ea]",
      muted: "text-[#efe4d2]/90",
      accent: "text-amber-100",
      chip: "bg-amber-200/10 text-amber-100 border-amber-100/35",
    };
  }

  return {
    background:
      "radial-gradient(circle at 14% 2%, rgba(59, 130, 246, 0.24), transparent 37%), radial-gradient(circle at 82% 6%, rgba(239, 68, 68, 0.2), transparent 35%), linear-gradient(160deg, #0b1220 0%, #10182a 46%, #131c30 100%)",
    panel: "bg-slate-950/42 border-white/12",
    card: "bg-slate-950/32 border-white/12 hover:border-sky-200/35",
    text: "text-slate-100",
    muted: "text-slate-300",
    accent: "text-sky-200",
    chip: "bg-sky-200/10 text-sky-100 border-sky-200/30",
  };
}

function getFocusLines(group: InternalPrototypeGroup) {
  if (group === "operations" || group === "service") {
    return ["Live queue pressure", "Crew assignment risk", "Same-day blocker clearance"];
  }
  if (group === "executive") {
    return ["KPI clarity first", "Risk-driven routing", "Decision prompts in context"];
  }
  if (group === "department") {
    return ["Phase handoff visibility", "Team ownership clarity", "Downstream bottleneck focus"];
  }
  if (group === "documentation") {
    return ["Faster policy lookup", "Version confidence", "Procedural pathing"];
  }
  return ["Role-first navigation", "Urgency signal hierarchy", "Reduced click ambiguity"];
}

export default async function InternalPrototypeDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const prototype = getInternalPrototypeBySlug(slug);
  if (!prototype) notFound();

  const style = getGroupStyle(prototype.group);
  const scoreSeed = hashString(slug);
  const firstMetric = 72 + (scoreSeed % 21);
  const secondMetric = 4 + (scoreSeed % 7);
  const thirdMetric = 10 + (scoreSeed % 14);
  const fourthMetric = 80 + (scoreSeed % 15);

  const groupItems = INTERNAL_PAGE_PROTOTYPES.filter((item) => item.group === prototype.group);
  const indexInGroup = groupItems.findIndex((item) => item.slug === prototype.slug);
  const previous = groupItems[(indexInGroup - 1 + groupItems.length) % groupItems.length];
  const next = groupItems[(indexInGroup + 1) % groupItems.length];
  const globalPosition = INTERNAL_PAGE_PROTOTYPES.findIndex((item) => item.slug === prototype.slug) + 1;
  const focusLines = getFocusLines(prototype.group);

  return (
    <div
      className={`${outfit.variable} ${mono.variable} ${playfair.variable} min-h-screen ${style.text}`}
      style={{
        background: style.background,
        fontFamily: "var(--font-page-outfit), var(--font-geist-sans), sans-serif",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <header className={`rounded-3xl border p-6 shadow-2xl backdrop-blur-sm sm:p-8 ${style.panel}`}>
          <p className={`text-xs uppercase tracking-[0.28em] ${style.muted}`}>
            {INTERNAL_GROUP_LABELS[prototype.group]} Prototype
          </p>
          <h1
            className="mt-3 text-3xl font-bold leading-tight sm:text-4xl"
            style={{ fontFamily: "var(--font-page-display), serif" }}
          >
            {prototype.title}
          </h1>
          <p className={`mt-4 max-w-3xl text-sm sm:text-base ${style.muted}`}>{prototype.description}</p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full border px-3 py-1 ${style.chip}`}>
              Prototype {globalPosition}/{INTERNAL_PAGE_PROTOTYPES.length}
            </span>
            <span className={`rounded-full border px-3 py-1 ${style.chip}`}>{prototype.targetHref}</span>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <Link href="/prototypes/layout-refresh/internal" className={`rounded-full border px-3 py-1.5 transition ${style.card}`}>
              Back to all internal prototypes
            </Link>
            <Link href={prototype.targetHref} className={`rounded-full border px-3 py-1.5 transition ${style.chip}`}>
              Open current page
            </Link>
          </div>
        </header>

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          <article className={`rounded-2xl border p-4 ${style.panel}`}>
            <p className={`text-xs uppercase tracking-[0.2em] ${style.muted}`}>Scan Efficiency</p>
            <p className={`mt-2 text-2xl font-bold ${style.accent}`}>{firstMetric}%</p>
          </article>
          <article className={`rounded-2xl border p-4 ${style.panel}`}>
            <p className={`text-xs uppercase tracking-[0.2em] ${style.muted}`}>Priority Lanes</p>
            <p className={`mt-2 text-2xl font-bold ${style.accent}`}>{secondMetric}</p>
          </article>
          <article className={`rounded-2xl border p-4 ${style.panel}`}>
            <p className={`text-xs uppercase tracking-[0.2em] ${style.muted}`}>Decision Prompts</p>
            <p className={`mt-2 text-2xl font-bold ${style.accent}`}>{thirdMetric}</p>
          </article>
          <article className={`rounded-2xl border p-4 ${style.panel}`}>
            <p className={`text-xs uppercase tracking-[0.2em] ${style.muted}`}>Mobile Readability</p>
            <p className={`mt-2 text-2xl font-bold ${style.accent}`}>{fourthMetric}%</p>
          </article>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_1.85fr]">
          <aside className={`rounded-3xl border p-5 backdrop-blur ${style.panel}`}>
            <p className={`text-xs uppercase tracking-[0.24em] ${style.muted}`}>Prototype Intent</p>
            <ul className="mt-4 space-y-3">
              {focusLines.map((line) => (
                <li key={line} className={`rounded-2xl border p-4 ${style.card}`}>
                  <p className="text-sm">{line}</p>
                </li>
              ))}
            </ul>
          </aside>

          <div className="grid gap-4 sm:grid-cols-2">
            {groupItems.slice(0, 6).map((item, idx) => (
              <Link
                key={item.slug}
                href={`/prototypes/layout-refresh/internal/${item.slug}`}
                className={`animate-slideUp rounded-3xl border p-5 transition ${style.card}`}
                style={{ animationDelay: `${idx * 45}ms` }}
              >
                <p
                  className={`text-[10px] uppercase tracking-[0.18em] ${style.muted}`}
                  style={{ fontFamily: "var(--font-page-mono), monospace" }}
                >
                  {item.targetHref}
                </p>
                <h2 className="mt-2 text-base font-semibold">{item.title}</h2>
                <p className={`mt-2 text-sm ${style.muted}`}>{item.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/prototypes/layout-refresh/internal/${previous.slug}`}
            className={`rounded-full border px-4 py-2 text-sm transition ${style.card}`}
          >
            Previous: {previous.title}
          </Link>
          <Link
            href={`/prototypes/layout-refresh/internal/${next.slug}`}
            className={`rounded-full border px-4 py-2 text-sm transition ${style.card}`}
          >
            Next: {next.title}
          </Link>
        </section>
      </main>
    </div>
  );
}
