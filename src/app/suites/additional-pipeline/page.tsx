import Link from "next/link";

const LINKS = [
  {
    href: "/dashboards/sales",
    title: "Sales Pipeline",
    description: "Active deals, funnel visualization, and proposal tracking.",
    tag: "SALES",
  },
  {
    href: "/dashboards/service",
    title: "Service Pipeline",
    description: "Service jobs, scheduling, and work-in-progress tracking.",
    tag: "SERVICE",
  },
  {
    href: "/dashboards/dnr",
    title: "D&R Pipeline",
    description: "Detach & Reset projects with phase tracking.",
    tag: "D&R",
  },
];

export default function AdditionalPipelineSuitePage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white dashboard-bg">
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold mt-3">Additional Pipeline Suite</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Supplemental pipeline dashboards grouped for a cleaner main page.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group block bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 hover:border-orange-500/50 hover:bg-zinc-900 transition-all"
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-white group-hover:text-orange-400 transition-colors">
                  {item.title}
                </h3>
                <span className="text-xs font-medium px-2 py-0.5 rounded border bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
                  {item.tag}
                </span>
              </div>
              <p className="text-sm text-zinc-500">{item.description}</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
