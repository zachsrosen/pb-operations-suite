import Link from "next/link";
import { Space_Grotesk } from "next/font/google";
import {
  INTERNAL_GROUP_LABELS,
  INTERNAL_GROUP_ORDER,
  INTERNAL_PAGE_PROTOTYPES,
} from "./catalog";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-internal-space",
});

export default function InternalPagePrototypeIndexPage() {
  return (
    <div
      className={`${spaceGrotesk.variable} min-h-screen text-slate-100`}
      style={{
        background:
          "radial-gradient(circle at 18% 3%, rgba(14, 165, 233, 0.22), transparent 34%), radial-gradient(circle at 84% 5%, rgba(251, 191, 36, 0.2), transparent 36%), linear-gradient(158deg, #07111f 0%, #0b1220 48%, #101827 100%)",
        fontFamily: "var(--font-internal-space), var(--font-geist-sans), sans-serif",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        <header className="rounded-3xl border border-white/10 bg-slate-950/35 p-6 shadow-2xl shadow-slate-950/40 backdrop-blur-sm sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/85">Full Coverage</p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">
            Internal Page Prototypes
          </h1>
          <p className="mt-4 max-w-3xl text-sm text-slate-300 sm:text-base">
            Prototype replacements for every page linked inside your suites.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full border border-cyan-200/30 bg-cyan-200/10 px-3 py-1 text-xs text-cyan-100">
              {INTERNAL_PAGE_PROTOTYPES.length} page prototypes
            </span>
            <Link href="/prototypes/layout-refresh" className="rounded-full border border-white/25 px-3 py-1 text-xs text-slate-200 hover:border-white/40 hover:text-white">
              Back to prototype hub
            </Link>
          </div>
        </header>

        <section className="mt-8 space-y-8">
          {INTERNAL_GROUP_ORDER.map((group) => {
            const items = INTERNAL_PAGE_PROTOTYPES.filter((item) => item.group === group);
            if (items.length === 0) return null;

            return (
              <div key={group}>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-white">{INTERNAL_GROUP_LABELS[group]}</h2>
                  <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-300">
                    {items.length} prototypes
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((item) => (
                    <Link
                      key={item.slug}
                      href={`/prototypes/layout-refresh/internal/${item.slug}`}
                      className="group rounded-3xl border border-white/10 bg-slate-950/28 p-5 transition duration-300 hover:-translate-y-1 hover:border-white/30 hover:bg-slate-900/45"
                    >
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        {item.targetHref}
                      </p>
                      <h3 className="mt-2 text-base font-semibold text-white">{item.title}</h3>
                      <p className="mt-2 text-sm text-slate-300">{item.description}</p>
                      <div className="mt-4 flex flex-wrap gap-1">
                        {item.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-cyan-200/20 bg-cyan-200/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-cyan-100"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
