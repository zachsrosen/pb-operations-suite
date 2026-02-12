import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

const LINKS = [
  {
    href: "/dashboards/zuper-status-comparison",
    title: "Zuper Status Comparison",
    description: "Compare Zuper job statuses and dates with HubSpot deal data.",
    tag: "ZUPER",
  },
  {
    href: "/dashboards/mobile",
    title: "Mobile Dashboard",
    description: "Touch-optimized view for field teams and fast project lookup.",
    tag: "MOBILE",
  },
  {
    href: "/dashboards/pe",
    title: "PE Dashboard",
    description: "Participate Energy milestone tracking and compliance monitoring.",
    tag: "PE",
  },
  {
    href: "/admin/users",
    title: "Users",
    description: "Manage user accounts, roles, and access controls.",
    tag: "ADMIN",
  },
  {
    href: "/admin/activity",
    title: "Activity Log",
    description: "Audit user actions, dashboard views, and system events.",
    tag: "AUDIT",
  },
  {
    href: "/admin/security",
    title: "Security",
    description: "Review security events, impersonation, and admin activity.",
    tag: "SECURITY",
  },
  {
    href: "/handbook",
    title: "Handbook",
    description: "Comprehensive guide to dashboards, features, and workflows.",
    tag: "GUIDE",
  },
];

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
            Admin-only tools and in-progress dashboards.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                <span className="text-xs font-medium px-2 py-0.5 rounded border bg-zinc-500/20 text-foreground/80 border-muted/30">
                  {item.tag}
                </span>
              </div>
              <p className="text-sm text-muted">{item.description}</p>
            </Link>
          ))}
        </div>

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
