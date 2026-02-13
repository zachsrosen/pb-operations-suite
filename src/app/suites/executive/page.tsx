import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

const LINKS = [
  {
    href: "/dashboards/revenue",
    title: "Revenue",
    description: "Revenue by stage, backlog forecasts, location breakdowns, and milestone timelines.",
    tag: "REVENUE",
    tagColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
  {
    href: "/dashboards/executive",
    title: "Executive Summary",
    description: "High-level pipeline and stage analysis with location and monthly trends.",
    tag: "SUMMARY",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  },
  {
    href: "/dashboards/locations",
    title: "Location Comparison",
    description: "Side-by-side location performance, capacity, and pipeline breakdown.",
    tag: "LOCATIONS",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  },
];

export default async function ExecutiveSuitePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login?callbackUrl=/suites/executive");

  const user = await getUserByEmail(session.user.email);
  if (!user || (user.role !== "ADMIN" && user.role !== "OWNER")) redirect("/");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link href="/" className="text-xs text-muted hover:text-foreground transition-colors">
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold mt-3">Executive Suite</h1>
          <p className="text-sm text-muted mt-1">
            Leadership dashboards, pipeline intelligence, and executive views.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group block bg-surface/50 border border-t-border rounded-xl p-5 hover:border-orange-500/50 hover:bg-surface transition-all"
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-foreground group-hover:text-orange-400 transition-colors">
                  {item.title}
                </h3>
                <span className={`text-xs font-medium px-2 py-0.5 rounded border ${item.tagColor}`}>
                  {item.tag}
                </span>
              </div>
              <p className="text-sm text-muted">{item.description}</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
