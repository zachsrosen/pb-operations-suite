import Link from "next/link";
import type { ReactNode, CSSProperties } from "react";
import { getSuiteSwitcherEntriesForRole, SUITE_NAV_ENTRIES } from "@/lib/suite-nav";
import { canAccessRoute, getDefaultRouteForRole, type UserRole } from "@/lib/role-permissions";
import PhotonBrothersBadge from "./PhotonBrothersBadge";

export interface SuitePageCard {
  href: string;
  title: string;
  description: string;
  tag: string;
  tagColor?: string;       // deprecated — no longer read by renderer
  icon?: string;            // emoji character, e.g. "📅"
  section?: string;
  hardNavigate?: boolean;
  disabled?: boolean;
}

interface SuitePageShellProps {
  currentSuiteHref: string;
  title: string;
  subtitle: string;
  cards: SuitePageCard[];
  role?: UserRole;
  columnsClassName?: string;
  heroContent?: ReactNode;
}

type GridRow = { cols: string; cards: SuitePageCard[] };

function getGridRows(cards: SuitePageCard[], defaultCols: string): GridRow[] {
  const n = cards.length;
  if (n === 2) return [{ cols: "grid grid-cols-1 md:grid-cols-2 gap-4", cards }];
  if (n === 4) return [{ cols: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4", cards }];
  if (n === 5) return [
    { cols: "grid grid-cols-1 md:grid-cols-3 gap-4", cards: cards.slice(0, 3) },
    { cols: "grid grid-cols-1 md:grid-cols-2 gap-4", cards: cards.slice(3) },
  ];
  if (n === 7) return [
    { cols: "grid grid-cols-1 md:grid-cols-3 gap-4", cards: cards.slice(0, 3) },
    { cols: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4", cards: cards.slice(3) },
  ];
  return [{ cols: defaultCols, cards }];
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

const SUITE_ACCENT_COLORS: Record<string, { color: string; light: string }> = {
  "/suites/operations":                 { color: "#f97316", light: "#fb923c" },
  "/suites/design-engineering":         { color: "#6366f1", light: "#818cf8" },
  "/suites/permitting-interconnection": { color: "#06b6d4", light: "#22d3ee" },
  "/suites/service":                    { color: "#06b6d4", light: "#22d3ee" },
  "/suites/dnr-roofing":                { color: "#a855f7", light: "#c084fc" },
  "/suites/intelligence":               { color: "#3b82f6", light: "#60a5fa" },
  "/suites/executive":                  { color: "#f59e0b", light: "#fbbf24" },
  "/suites/admin":                      { color: "#f97316", light: "#fb923c" },
};

const DEFAULT_ACCENT = { color: "#f97316", light: "#fb923c" };

const SECTION_COLORS: Record<string, string> = {
  "Scheduling & Planning": "#3b82f6",
  "Site Survey": "#22c55e",
  "Construction": "#f97316",
  "Inspections": "#eab308",
  "Inventory & Equipment": "#06b6d4",
  "Catalog & Inventory": "#06b6d4",
  "Design Pipeline": "#6366f1",
  "Analytics": "#8b5cf6",
  "Reference": "#64748b",
  "Tools": "#14b8a6",
  "Pipeline": "#06b6d4",
  "Tracking": "#3b82f6",
  "Programs": "#f59e0b",
  "Service": "#06b6d4",
  "D&R": "#8b5cf6",
  "Roofing": "#ec4899",
  "Risk & Quality": "#f97316",
  "Pipeline & Forecasting": "#3b82f6",
  "Management": "#22c55e",
  "Executive Views": "#f59e0b",
  "Command & Planning": "#ef4444",
  "Sales": "#06b6d4",
  "Field Performance": "#ef4444",
  "Meta": "#3b82f6",
  "Admin Tools": "#f97316",
  "Documentation": "#22c55e",
  "Prototypes": "#ec4899",
  "API Shortcuts": "#06b6d4",
  "Legacy Dashboards": "#64748b",
};

const DEFAULT_SECTION_COLOR = "#64748b";

/** Convert "#f97316" → "249, 115, 22" for use in rgba() */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

export default function SuitePageShell({
  currentSuiteHref,
  title,
  subtitle,
  cards,
  role,
  columnsClassName = "grid grid-cols-1 md:grid-cols-3 gap-4",
  heroContent,
}: SuitePageShellProps) {
  const accent = SUITE_ACCENT_COLORS[currentSuiteHref] || DEFAULT_ACCENT;
  const toRoutePath = (href: string): string | null => {
    if (!href.startsWith("/")) return null;
    return href.split("?")[0] || href;
  };

  const visibleSuites = role
    ? getSuiteSwitcherEntriesForRole(role)
    : SUITE_NAV_ENTRIES;

  const visibleCards = role
    ? cards.filter((card) => {
      const routePath = toRoutePath(card.href);
      if (!routePath) return true;
      return canAccessRoute(role, routePath);
    })
    : cards;

  const sections = groupCards(visibleCards);
  const backHref = role
    ? (canAccessRoute(role, "/") ? "/" : getDefaultRouteForRole(role))
    : "/";

  return (
    <div
      className="min-h-screen text-foreground"
      style={{
        background:
          "radial-gradient(circle at 12% -6%, rgba(6, 182, 212, 0.12), transparent 32%), radial-gradient(circle at 88% 2%, rgba(59, 130, 246, 0.08), transparent 36%), var(--background)",
      }}
    >
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-8">
          {/* Left: PB mark + title */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <PhotonBrothersBadge href={backHref} compact label="Back to Dashboard" />
            </div>
            <div className="flex items-center gap-3 mb-1">
              <h1
                className="text-2xl font-bold"
                style={{
                  background: `linear-gradient(135deg, ${accent.color}, ${accent.light})`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {title}
              </h1>
            </div>
            <p className="text-sm text-muted">{subtitle}</p>
          </div>

          {/* Right: inline suite switcher */}
          {visibleSuites.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {visibleSuites.map((suite) => {
                const isCurrent = suite.href === currentSuiteHref;
                return (
                  <Link
                    key={suite.href}
                    href={suite.href}
                    className={`text-xs px-2.5 py-1.5 rounded-md transition-colors ${
                      isCurrent ? "" : "bg-surface-elevated/50 text-muted hover:text-foreground"
                    }`}
                    style={isCurrent ? {
                      background: `rgba(${hexToRgb(accent.color)}, 0.15)`,
                      color: accent.color,
                    } : undefined}
                    title={suite.description}
                  >
                    {suite.shortLabel}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {heroContent && (
          <div className="mb-8">{heroContent}</div>
        )}

        {sections.map(({ section, cards: sectionCards }) => {
          const rows = getGridRows(sectionCards, columnsClassName);
          return (
            <section key={section} className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <div
                  className="w-1 h-4 rounded-sm"
                  style={{
                    background: `linear-gradient(to bottom, ${SECTION_COLORS[section] || DEFAULT_SECTION_COLOR}, transparent)`,
                  }}
                />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {section}
                </h2>
              </div>
              {rows.map((row, rowIdx) => (
                <div key={rowIdx} className={`${row.cols}${rowIdx > 0 ? " mt-4" : ""}`}>
                  {row.cards.map((item) => {
                    const sectionColor = SECTION_COLORS[item.section || ""] || DEFAULT_SECTION_COLOR;

                    const cardClass = item.disabled
                      ? "block rounded-xl border border-t-border/50 bg-gradient-to-br from-surface-elevated/50 via-surface/40 to-surface-2/30 p-5 shadow-card backdrop-blur-sm opacity-60 cursor-default relative overflow-hidden"
                      : "group block rounded-xl border border-t-border/80 bg-gradient-to-br from-surface-elevated/80 via-surface/70 to-surface-2/50 p-5 shadow-card backdrop-blur-sm hover:bg-surface transition-all relative overflow-hidden";

                    const content = (
                      <>
                        {/* Left accent bar */}
                        <div
                          className="absolute top-0 left-0 w-[3px] h-full"
                          style={{
                            background: `linear-gradient(to bottom, ${sectionColor}, transparent)`,
                            opacity: item.disabled ? 0.3 : 1,
                          }}
                        />
                        {/* Title row with emoji */}
                        <div className="flex items-center gap-2 mb-1">
                          {item.icon && (
                            <span
                              className="text-lg leading-none"
                              style={item.disabled ? { filter: "grayscale(1) opacity(0.5)" } : undefined}
                            >
                              {item.icon}
                            </span>
                          )}
                          <h3
                            className={`font-semibold transition-colors ${
                              item.disabled ? "text-muted" : "text-foreground"
                            }`}
                          >
                            <span className="group-hover:hidden">{item.title}</span>
                            <span
                              className="hidden group-hover:inline"
                              style={{ color: accent.color }}
                            >
                              {item.title}
                            </span>
                          </h3>
                        </div>
                        {/* Description */}
                        <p className="text-sm text-muted">{item.description}</p>
                        {/* Footer: Open → or disabled tag */}
                        <div className="mt-2 text-xs text-muted opacity-30 group-hover:opacity-60 transition-opacity">
                          {item.disabled ? item.tag : "Open \u2192"}
                        </div>
                      </>
                    );

                    // Hover border via inline CSS variable
                    const hoverStyle = !item.disabled ? {
                      "--hover-border": `rgba(${hexToRgb(accent.color)}, 0.5)`,
                    } as CSSProperties : undefined;

                    const hoverClass = !item.disabled ? "[&:hover]:border-[var(--hover-border)]" : "";

                    if (item.disabled) {
                      return (
                        <div key={item.href || item.title} className={cardClass}>
                          {content}
                        </div>
                      );
                    }

                    if (item.hardNavigate) {
                      return (
                        <a
                          key={item.href}
                          href={item.href}
                          className={`${cardClass} ${hoverClass}`}
                          style={hoverStyle}
                        >
                          {content}
                        </a>
                      );
                    }

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        prefetch={false}
                        className={`${cardClass} ${hoverClass}`}
                        style={hoverStyle}
                      >
                        {content}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </section>
          );
        })}

        {sections.length === 0 && (
          <div className="bg-gradient-to-br from-surface-elevated/85 via-surface/70 to-surface-2/55 border border-t-border/80 rounded-xl p-6 text-sm text-muted shadow-card backdrop-blur-sm">
            No pages are available for your current role in this suite.
          </div>
        )}
      </main>
    </div>
  );
}
