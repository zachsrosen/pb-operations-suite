import Link from "next/link";
import { Space_Grotesk } from "next/font/google";
import { HOME_PROTOTYPES } from "./catalog";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-home-proto-space",
});

export default function HomeRefreshPrototypeHubPage() {
  return (
    <div
      className={`${spaceGrotesk.variable} min-h-screen text-slate-100`}
      style={{
        background:
          "radial-gradient(circle at 8% -4%, rgba(20, 184, 166, 0.28), transparent 35%), radial-gradient(circle at 88% 4%, rgba(251, 146, 60, 0.2), transparent 35%), linear-gradient(165deg, #040a14 0%, #0b1424 55%, #111b2f 100%)",
        fontFamily: "var(--font-home-proto-space), var(--font-geist-sans), sans-serif",
      }}
    >
      <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        <header className="rounded-3xl border border-white/15 bg-black/30 p-7 shadow-2xl shadow-black/35 backdrop-blur sm:p-8">
          <p className="text-xs uppercase tracking-[0.32em] text-cyan-100/90">Homepage Replacement Concepts</p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">10 New Home Page Prototypes</h1>
          <p className="mt-4 max-w-3xl text-sm text-slate-200 sm:text-base">
            These are 10 intentionally different directions for your landing experience. Every prototype is wired to
            your existing suite routes so you can evaluate structure and visual language quickly.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-slate-300">
            <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5">Distinct typography</span>
            <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5">Different layout systems</span>
            <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5">Mobile-ready compositions</span>
          </div>
        </header>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {HOME_PROTOTYPES.map((prototype) => (
            <Link
              key={prototype.slug}
              href={`/prototypes/home-refresh/${prototype.slug}`}
              className="group rounded-3xl border border-white/12 bg-slate-950/35 p-5 transition duration-300 hover:-translate-y-1 hover:border-cyan-200/40 hover:bg-slate-900/55"
            >
              <div className="h-24 rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-300/20 via-white/5 to-amber-300/15" />
              <p className="mt-4 text-xs uppercase tracking-[0.2em] text-cyan-100/80">{prototype.direction}</p>
              <h2 className="mt-2 text-xl font-semibold text-white">{prototype.title}</h2>
              <p className="mt-2 text-sm text-slate-300">{prototype.description}</p>
              <p className="mt-3 text-xs text-slate-400">Mood: {prototype.mood}</p>
              <p className="mt-4 text-sm font-medium text-cyan-200 group-hover:text-white">Open prototype</p>
            </Link>
          ))}
        </section>

        <div className="mt-8">
          <Link href="/" className="text-sm text-slate-300 hover:text-white">
            Back to current home
          </Link>
        </div>
      </main>
    </div>
  );
}
