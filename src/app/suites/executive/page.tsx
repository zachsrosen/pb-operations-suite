import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

const LINKS = [
  {
    href: "/dashboards/command-center",
    title: "Command Center",
    description: "Pipeline overview, revenue breakdowns, capacity planning, PE tracking, and alerts.",
    tag: "COMMAND CENTER",
    tagColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
  {
    href: "/dashboards/executive",
    title: "Executive Summary",
    description: "High-level pipeline and stage analysis with location and monthly trends.",
    tag: "SUMMARY",
    tagColor: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  },
  {
    href: "/dashboards/at-risk",
    title: "At-Risk Projects",
    description: "Projects with overdue milestones, stalled stages, and severity scoring.",
    tag: "AT-RISK",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  {
    href: "/dashboards/optimizer",
    title: "Pipeline Optimizer",
    description: "Identify scheduling opportunities and optimize project throughput.",
    tag: "OPTIMIZER",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  },
  {
    href: "/dashboards/locations",
    title: "Location Comparison",
    description: "Side-by-side location performance, capacity, and pipeline breakdown.",
    tag: "LOCATIONS",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
];

export default async function ExecutiveSuitePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login?callbackUrl=/suites/executive");

  const user = await getUserByEmail(session.user.email);
  if (!user || (user.role !== "ADMIN" && user.role !== "OWNER")) redirect("/");

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white dashboard-bg">
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold mt-3">Executive Suite</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Leadership dashboards, pipeline intelligence, and executive views.
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
                <span className={`text-xs font-medium px-2 py-0.5 rounded border ${item.tagColor}`}>
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
