import Link from "next/link";
import { SUITE_NAV_ENTRIES } from "@/lib/suite-nav";
import { canAccessRoute, type UserRole } from "@/lib/role-permissions";

export interface SuitePageCard {
  href: string;
  title: string;
  description: string;
  tag: string;
  tagColor?: string;
  section?: string;
}

interface SuitePageShellProps {
  currentSuiteHref: string;
  title: string;
  subtitle: string;
  cards: SuitePageCard[];
  role?: UserRole;
  hoverBorderClass?: string;
  tagColorClass?: string;
  columnsClassName?: string;
}

function groupCards(cards: SuitePageCard[]): Array<{ section: string; cards: SuitePageCard[] }> {
  const order: string[] = [];
  const bySection = new Map<string, SuitePageCard[]>();

  for (const card of cards) {
    const section = card.section || "Dashboards";
    if (!bySection.has(section)) {
      bySection.set(section, []);
      order.push(section);
    }
    bySection.get(section)!.push(card);
  }

  return order.map((section) => ({ section, cards: bySection.get(section) || [] }));
}

export default function SuitePageShell({
  currentSuiteHref,
  title,
  subtitle,
  cards,
  role,
  hoverBorderClass = "hover:border-orange-500/50",
  tagColorClass = "bg-blue-500/20 text-blue-400 border-blue-500/30",
  columnsClassName = "grid grid-cols-1 md:grid-cols-3 gap-4",
}: SuitePageShellProps) {
  const toRoutePath = (href: string): string | null => {
    if (!href.startsWith("/")) return null;
    return href.split("?")[0] || href;
  };

  const visibleSuites = role
    ? SUITE_NAV_ENTRIES.filter((suite) => canAccessRoute(role, suite.href))
    : SUITE_NAV_ENTRIES;

  const visibleCards = role
    ? cards.filter((card) => {
      const routePath = toRoutePath(card.href);
      if (!routePath) return true;
      return canAccessRoute(role, routePath);
    })
    : cards;

  const sections = groupCards(visibleCards);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link href="/" className="text-xs text-muted hover:text-foreground transition-colors">
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold mt-3">{title}</h1>
          <p className="text-sm text-muted mt-1">{subtitle}</p>
        </div>

        {visibleSuites.length > 0 && (
          <div className="bg-surface/40 border border-t-border rounded-xl p-4 mb-6">
            <h2 className="text-xs uppercase tracking-wide text-muted mb-3">
              Suite Switcher
            </h2>
            <div className="flex flex-wrap gap-2">
              {visibleSuites.map((suite) => {
                const isCurrent = suite.href === currentSuiteHref;
                return (
                  <Link
                    key={suite.href}
                    href={suite.href}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                      isCurrent
                        ? "border-orange-500/50 bg-orange-500/15 text-orange-300"
                        : "border-t-border bg-surface/60 text-muted hover:text-foreground hover:border-orange-500/40"
                    }`}
                    title={suite.description}
                  >
                    {suite.shortLabel}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {sections.map(({ section, cards: sectionCards }) => (
          <section key={section} className="mb-8">
            <h2 className="text-lg font-semibold text-foreground/80 mb-4">{section}</h2>
            <div className={columnsClassName}>
              {sectionCards.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group block bg-surface/50 border border-t-border rounded-xl p-5 ${hoverBorderClass} hover:bg-surface transition-all`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-foreground group-hover:text-orange-400 transition-colors">
                      {item.title}
                    </h3>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${item.tagColor || tagColorClass}`}>
                      {item.tag}
                    </span>
                  </div>
                  <p className="text-sm text-muted">{item.description}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}

        {sections.length === 0 && (
          <div className="bg-surface/40 border border-t-border rounded-xl p-6 text-sm text-muted">
            No pages are available for your current role in this suite.
          </div>
        )}
      </main>
    </div>
  );
}
