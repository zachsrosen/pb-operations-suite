import Link from "next/link";

const LINKS = [
  {
    href: "/dashboards/site-survey",
    title: "Site Survey",
    description: "Site survey scheduling, status tracking, and completion monitoring.",
    tag: "SURVEY",
  },
  {
    href: "/dashboards/design",
    title: "Design & Engineering",
    description: "Track design progress, engineering approvals, and plan sets.",
    tag: "DESIGN",
  },
  {
    href: "/dashboards/permitting",
    title: "Permitting",
    description: "Permit status tracking, submission dates, and approval monitoring.",
    tag: "PERMITTING",
  },
  {
    href: "/dashboards/inspections",
    title: "Inspections",
    description: "Inspection scheduling, status tracking, pass rates, and AHJ analysis.",
    tag: "INSPECTIONS",
  },
  {
    href: "/dashboards/interconnection",
    title: "Interconnection",
    description: "Utility interconnection applications, approvals, and meter installations.",
    tag: "UTILITY",
  },
  {
    href: "/dashboards/construction",
    title: "Construction",
    description: "Construction status, scheduling, and progress tracking.",
    tag: "CONSTRUCTION",
  },
  {
    href: "/dashboards/incentives",
    title: "Incentives",
    description: "Rebate and incentive program tracking and application status.",
    tag: "INCENTIVES",
  },
];

export default function DepartmentSuitePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link href="/" className="text-xs text-muted hover:text-foreground transition-colors">
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold mt-3">Department Suite</h1>
          <p className="text-sm text-muted mt-1">
            Department-level dashboards grouped in one place.
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
                <span className="text-xs font-medium px-2 py-0.5 rounded border bg-green-500/20 text-green-400 border-green-500/30">
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
