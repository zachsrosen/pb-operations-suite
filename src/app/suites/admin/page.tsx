import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

const ADMIN_TOOLS = [
  {
    href: "/admin/users",
    title: "Users",
    description: "Manage user accounts, roles, and access controls.",
    tag: "ADMIN",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  {
    href: "/admin/activity",
    title: "Activity Log",
    description: "Audit user actions, dashboard views, and system events.",
    tag: "AUDIT",
    tagColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
  {
    href: "/admin/security",
    title: "Security",
    description: "Review security events, impersonation, and admin activity.",
    tag: "SECURITY",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  {
    href: "/admin/tickets",
    title: "Bug Reports",
    description: "View and manage user-submitted bug reports and issues.",
    tag: "TICKETS",
    tagColor: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  },
  {
    href: "/admin/directory",
    title: "Page Directory",
    description: "Complete page URL directory with per-role route access visibility.",
    tag: "ROUTES",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  {
    href: "/dashboards/zuper-compliance",
    title: "Zuper Compliance",
    description: "Per-user compliance scorecards and crew-composition comparisons.",
    tag: "COMPLIANCE",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  {
    href: "/dashboards/zuper-status-comparison",
    title: "Zuper Status Comparison",
    description: "Compare Zuper job statuses and schedule/completion dates with HubSpot data.",
    tag: "ZUPER",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  },
];

const DOCUMENTATION = [
  {
    href: "/updates",
    title: "Updates",
    description: "Release notes, changelog, and recent feature updates.",
    tag: "CHANGELOG",
    tagColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  },
  {
    href: "/guide",
    title: "Guide",
    description: "User guide for navigating dashboards and features.",
    tag: "GUIDE",
    tagColor: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  },
  {
    href: "/roadmap",
    title: "Roadmap",
    description: "Planned features, upcoming work, and development priorities.",
    tag: "ROADMAP",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  },
  {
    href: "/handbook",
    title: "Handbook",
    description: "Comprehensive guide to dashboards, features, and workflows.",
    tag: "HANDBOOK",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  {
    href: "/sop",
    title: "SOPs",
    description: "Standard operating procedures for operations, scheduling, and workflows.",
    tag: "SOP",
    tagColor: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  },
];

function SectionGrid({ items }: { items: typeof ADMIN_TOOLS }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {items.map((item) => (
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
  );
}

export default async function AdminSuitePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login?callbackUrl=/suites/admin");

  const user = await getUserByEmail(session.user.email);
  if (!user || user.role !== "ADMIN") redirect("/");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link href="/" className="text-xs text-muted hover:text-foreground transition-colors">
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold mt-3">Admin Suite</h1>
          <p className="text-sm text-muted mt-1">
            Admin tools and documentation.
          </p>
        </div>

        {/* Admin Tools */}
        <h2 className="text-lg font-semibold text-foreground/80 mb-4">Admin Tools</h2>
        <SectionGrid items={ADMIN_TOOLS} />

        {/* Documentation */}
        <h2 className="text-lg font-semibold text-foreground/80 mt-10 mb-4">Documentation</h2>
        <SectionGrid items={DOCUMENTATION} />

        {/* API Endpoints */}
        <h2 className="text-lg font-semibold text-foreground/80 mt-10 mb-4">
          API Endpoints
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a
            href="/api/projects?stats=true"
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-surface/50 border border-t-border rounded-xl p-5 hover:border-green-500/50 transition-all"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-green-500 font-mono text-sm">GET</span>
              <span className="font-semibold text-foreground">Projects + Stats</span>
            </div>
            <p className="text-sm text-muted">
              Full project data with statistics.
            </p>
          </a>
          <a
            href="/api/projects?context=pe"
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-surface/50 border border-t-border rounded-xl p-5 hover:border-green-500/50 transition-all"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-green-500 font-mono text-sm">GET</span>
              <span className="font-semibold text-foreground">PE Projects</span>
            </div>
            <p className="text-sm text-muted">
              Participate Energy project data.
            </p>
          </a>
          <a
            href="/api/projects?context=scheduling"
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-surface/50 border border-t-border rounded-xl p-5 hover:border-green-500/50 transition-all"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-green-500 font-mono text-sm">GET</span>
              <span className="font-semibold text-foreground">Scheduling</span>
            </div>
            <p className="text-sm text-muted">
              RTB and schedulable projects.
            </p>
          </a>
        </div>
      </main>
    </div>
  );
}
