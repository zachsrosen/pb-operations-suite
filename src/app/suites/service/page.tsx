import Link from "next/link";

const LINKS = [
  {
    href: "/dashboards/service-scheduler",
    title: "Service Schedule",
    description: "Calendar view of Zuper service visit and service revisit jobs.",
    tag: "SCHEDULING",
  },
  {
    href: "/dashboards/service-backlog",
    title: "Service Equipment Backlog",
    description: "Service pipeline equipment forecasting by brand, model, and stage.",
    tag: "EQUIPMENT",
  },
  {
    href: "/dashboards/service",
    title: "Service Pipeline",
    description: "Service deal tracking with stage progression and metrics.",
    tag: "PIPELINE",
  },
];

export default function ServiceSuitePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link href="/" className="text-xs text-muted hover:text-foreground transition-colors">
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold mt-3">Service Suite</h1>
          <p className="text-sm text-muted mt-1">
            Service pipeline scheduling, equipment tracking, and deal management.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group block bg-surface/50 border border-t-border rounded-xl p-5 hover:border-purple-500/50 hover:bg-surface transition-all"
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-foreground group-hover:text-purple-400 transition-colors">
                  {item.title}
                </h3>
                <span className="text-xs font-medium px-2 py-0.5 rounded border bg-purple-500/20 text-purple-400 border-purple-500/30">
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
