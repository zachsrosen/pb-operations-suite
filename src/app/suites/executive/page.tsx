import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

const LINKS = [
  {
    href: "/dashboards/command-center",
    title: "Executive Suite Dashboard",
    description: "Pipeline, capacity, revenue milestones, and leadership views.",
    tag: "EXECUTIVE",
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
            Owner/Admin-only executive and leadership dashboards.
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
                <span className="text-xs font-medium px-2 py-0.5 rounded border bg-amber-500/20 text-amber-400 border-amber-500/30">
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
