"use client";

import Link from "next/link";
import { ReactNode, useCallback } from "react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import PhotonBrothersBadge from "./PhotonBrothersBadge";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { SUITE_ACCENT_COLORS, DEFAULT_SUITE_ACCENT } from "@/lib/suite-accents";
import LiveClock from "./LiveClock";


// Maps dashboard paths to their parent suite
const SUITE_MAP: Record<string, { href: string; label: string }> = {
  // Operations Suite
  "/dashboards/scheduler": { href: "/suites/operations", label: "Operations" },
  "/dashboards/forecast-schedule": { href: "/suites/operations", label: "Operations" },
  "/dashboards/site-survey-scheduler": { href: "/suites/operations", label: "Operations" },
  "/dashboards/construction-scheduler": { href: "/suites/operations", label: "Operations" },
  "/dashboards/inspection-scheduler": { href: "/suites/operations", label: "Operations" },
  "/dashboards/timeline": { href: "/suites/operations", label: "Operations" },
  "/dashboards/equipment-backlog": { href: "/suites/operations", label: "Operations" },
  "/dashboards/inventory": { href: "/suites/operations", label: "Operations" },
  "/dashboards/bom": { href: "/suites/operations", label: "Operations" },
  "/dashboards/bom/history": { href: "/suites/operations", label: "Operations" },
  "/dashboards/catalog/review": { href: "/suites/operations", label: "Operations" },
  "/dashboards/catalog": { href: "/suites/operations", label: "Operations" },
  "/dashboards/catalog/new": { href: "/suites/operations", label: "Operations" },
  "/dashboards/submit-product": { href: "/suites/operations", label: "Operations" },
  "/dashboards/deals": { href: "/suites/operations", label: "Operations" },
  // Field Execution (Operations Suite)
  "/dashboards/site-survey": { href: "/suites/operations", label: "Operations" },
  "/dashboards/construction": { href: "/suites/operations", label: "Operations" },
  "/dashboards/inspections": { href: "/suites/operations", label: "Operations" },
  // Legacy standalone dashboards → their new suite homes
  "/dashboards/design": { href: "/suites/design-engineering", label: "D&E" },
  "/dashboards/permitting": { href: "/suites/permitting-interconnection", label: "P&I" },
  "/dashboards/interconnection": { href: "/suites/permitting-interconnection", label: "P&I" },
  // Incentives → P&I Suite
  "/dashboards/incentives": { href: "/suites/permitting-interconnection", label: "P&I" },
  // Design & Engineering Suite
  "/dashboards/de-overview": { href: "/suites/design-engineering", label: "D&E" },
  "/dashboards/plan-review": { href: "/suites/design-engineering", label: "D&E" },
  "/dashboards/pending-approval": { href: "/suites/design-engineering", label: "D&E" },
  "/dashboards/design-revisions": { href: "/suites/design-engineering", label: "D&E" },
  "/dashboards/de-metrics": { href: "/suites/design-engineering", label: "D&E" },
  "/dashboards/clipping-analytics": { href: "/suites/design-engineering", label: "D&E" },
  "/dashboards/ahj-requirements": { href: "/suites/design-engineering", label: "D&E" },
  "/dashboards/utility-design-requirements": { href: "/suites/design-engineering", label: "D&E" },
  // solar-surveyor: breadcrumb handled via ?suite= param in SolarSurveyorShell (linked from both D&E and Service)
  // solar-designer: breadcrumb handled via ?suite= param in page.tsx (linked from both D&E and Service)
  "/dashboards/idr-meeting": { href: "/suites/design-engineering", label: "D&E" },
  // Permitting & Interconnection Suite
  "/dashboards/pi-overview": { href: "/suites/permitting-interconnection", label: "P&I" },
  "/dashboards/pi-metrics": { href: "/suites/permitting-interconnection", label: "P&I" },
  "/dashboards/pi-action-queue": { href: "/suites/permitting-interconnection", label: "P&I" },
  "/dashboards/pi-revisions": { href: "/suites/permitting-interconnection", label: "P&I" },
  "/dashboards/pi-permit-action-queue": { href: "/suites/permitting-interconnection", label: "P&I" },
  "/dashboards/pi-ic-action-queue": { href: "/suites/permitting-interconnection", label: "P&I" },
  "/dashboards/pi-permit-revisions": { href: "/suites/permitting-interconnection", label: "P&I" },
  "/dashboards/pi-ic-revisions": { href: "/suites/permitting-interconnection", label: "P&I" },
  "/dashboards/ahj-tracker": { href: "/suites/permitting-interconnection", label: "P&I" },
  "/dashboards/utility-tracker": { href: "/suites/permitting-interconnection", label: "P&I" },
  "/dashboards/pi-timeline": { href: "/suites/permitting-interconnection", label: "P&I" },
  // Intelligence Suite
  "/dashboards/at-risk": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/qc": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/alerts": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/pipeline": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/optimizer": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/pe": { href: "/suites/intelligence", label: "Intelligence" },
  // Accounting Suite
  "/dashboards/pe-deals": { href: "/suites/accounting", label: "Accounting" },
  "/dashboards/pricing-calculator": { href: "/suites/accounting", label: "Accounting" },
  "/dashboards/sales": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/project-management": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/design-engineering": { href: "/suites/design-engineering", label: "D&E" },
  "/dashboards/permitting-interconnection": { href: "/suites/permitting-interconnection", label: "P&I" },
  // Executive Suite
  "/dashboards/capacity": { href: "/suites/executive", label: "Executive" },
  "/dashboards/command-center": { href: "/suites/executive", label: "Executive" },
  "/dashboards/revenue": { href: "/suites/executive", label: "Executive" },
  "/dashboards/executive": { href: "/suites/executive", label: "Executive" },
  "/dashboards/locations": { href: "/suites/executive", label: "Executive" },
  "/dashboards/executive-calendar": { href: "/suites/executive", label: "Executive" },
  "/dashboards/forecast-accuracy": { href: "/suites/executive", label: "Executive" },
  "/dashboards/forecast-timeline": { href: "/suites/executive", label: "Executive" },
  "/dashboards/design-pipeline-funnel": { href: "/suites/executive", label: "Executive" },
  "/dashboards/territory-map": { href: "/suites/executive", label: "Executive" },
  // Service Suite dashboards
  "/dashboards/service-scheduler": { href: "/suites/service", label: "Service" },
  "/dashboards/service-backlog": { href: "/suites/service", label: "Service" },
  "/dashboards/service": { href: "/suites/service", label: "Service" },
  "/dashboards/service-overview": { href: "/suites/service", label: "Service" },
  // Future phases — add now so breadcrumbs work when these dashboards are created:
  "/dashboards/service-tickets": { href: "/suites/service", label: "Service" },
  "/dashboards/service-customers": { href: "/suites/service", label: "Service" },
  "/dashboards/service-warranty": { href: "/suites/service", label: "Service" },
  "/dashboards/service-catalog": { href: "/suites/service", label: "Service" },

  // D&R + Roofing Suite dashboards
  "/dashboards/dnr-scheduler": { href: "/suites/dnr-roofing", label: "D&R + Roofing" },
  "/dashboards/dnr": { href: "/suites/dnr-roofing", label: "D&R + Roofing" },
  "/dashboards/roofing": { href: "/suites/dnr-roofing", label: "D&R + Roofing" },
  "/dashboards/roofing-scheduler": { href: "/suites/dnr-roofing", label: "D&R + Roofing" },
  // Admin Suite
  "/dashboards/zuper-status-comparison": { href: "/admin", label: "Admin" },
  // Design Reviews (dynamic: /dashboards/reviews/:dealId)
  "/dashboards/reviews": { href: "/suites/design-engineering", label: "D&E" },
  "/dashboards/zuper-compliance": { href: "/suites/executive", label: "Executive" },
  "/dashboards/product-comparison": { href: "/suites/operations", label: "Operations" },
  "/dashboards/comms": { href: "/", label: "Home" },
  "/dashboards/mobile": { href: "/admin", label: "Admin" },
  "/dashboards/ai": { href: "/dashboards/ai", label: "AI Skills" },
};

function getParentSuiteForPath(pathname: string): { href: string; label: string } | null {
  const exact = SUITE_MAP[pathname];
  if (exact) return exact;

  // Fallback for dynamic nested routes (e.g. /dashboards/catalog/edit/:id).
  const prefixMatch = Object.entries(SUITE_MAP)
    .filter(([route]) => pathname.startsWith(`${route}/`))
    .sort((a, b) => b[0].length - a[0].length)[0];

  return prefixMatch?.[1] || null;
}

interface Breadcrumb {
  label: string;
  href?: string;
}

interface SyncMeta {
  source: string;
  lastSyncedAt: string;
  staleness: string;
}

interface DashboardShellProps {
  title: string;
  subtitle?: string;
  accentColor?: string;
  lastUpdated?: string | null;
  dealId?: string;
  headerRight?: ReactNode;
  children: ReactNode;
  /** Breadcrumb trail (e.g. [{ label: "Operations", href: "/" }, { label: "At-Risk" }]) */
  breadcrumbs?: Breadcrumb[];
  /** Use full viewport width instead of max-w-7xl container */
  fullWidth?: boolean;
  /** Data to enable CSV export button */
  exportData?: { data: Record<string, unknown>[]; filename: string };
  /** Optional sync metadata — renders a staleness indicator when provided */
  syncMeta?: SyncMeta;
}

function StalenessIndicator({ syncMeta }: { syncMeta: SyncMeta }) {
  const minutesAgo = Math.floor(
    (Date.now() - new Date(syncMeta.lastSyncedAt).getTime()) / 60000
  );

  let dotColor: string;
  let label: string | null = null;

  if (minutesAgo < 15) {
    dotColor = "bg-green-400";
  } else if (minutesAgo < 30) {
    dotColor = "bg-yellow-400";
    label = `Synced ${syncMeta.staleness}`;
  } else {
    dotColor = "bg-red-400";
    label = `Data may be stale — last synced ${syncMeta.staleness}`;
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted" title={`Source: ${syncMeta.source}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
      {label && <span>{label}</span>}
    </span>
  );
}

export default function DashboardShell({
  title,
  subtitle,
  accentColor = "orange",
  dealId,
  headerRight,
  children,
  breadcrumbs,
  fullWidth = false,
  exportData,
  syncMeta,
}: DashboardShellProps) {
  const pathname = usePathname();
  const { trackExport } = useActivityTracking();
  const parentSuite = getParentSuiteForPath(pathname);

  const isValidParent = (parentSuite?.href?.startsWith("/suites/") || parentSuite?.href === "/") ?? false;
  const effectiveParent = isValidParent ? parentSuite : null;
  const suiteAccent = effectiveParent
    ? (SUITE_ACCENT_COLORS[effectiveParent.href] || DEFAULT_SUITE_ACCENT)
    : DEFAULT_SUITE_ACCENT;

  // Auto-generate breadcrumbs from suite mapping if not explicitly provided
  const effectiveBreadcrumbs = breadcrumbs || (effectiveParent
    ? [{ label: effectiveParent.label, href: effectiveParent.href }]
    : undefined);

  const colorMap: Record<string, string> = {
    orange: "text-orange-400",
    green: "text-green-400",
    red: "text-red-400",
    blue: "text-blue-400",
    purple: "text-purple-400",
    emerald: "text-emerald-400",
    cyan: "text-cyan-400",
    yellow: "text-yellow-400",
    indigo: "text-indigo-400",
    teal: "text-teal-400",
  };

  const handleExport = useCallback(() => {
    if (!exportData) return;
    trackExport("csv", exportData.data.length, title, undefined);
    import("@/lib/export").then(({ exportToCSV }) => {
      exportToCSV(exportData.data, exportData.filename);
    });
  }, [exportData, trackExport, title]);

  const containerClass = fullWidth
    ? "px-4 sm:px-6"
    : "max-w-7xl mx-auto px-4 sm:px-6";

  return (
    <div
      className="min-h-screen text-foreground"
      style={{
        background:
          "radial-gradient(circle at 12% -6%, rgba(6, 182, 212, 0.12), transparent 32%), radial-gradient(circle at 88% 2%, rgba(59, 130, 246, 0.08), transparent 36%), var(--background)",
      }}
    >
      <header className="bg-surface-elevated/80 backdrop-blur-sm border-b border-t-border/80 sticky top-0 z-40">
        <div className={`${containerClass} py-3 sm:py-4`}>
          {/* Breadcrumbs */}
          {effectiveBreadcrumbs && effectiveBreadcrumbs.length > 0 && (
            <nav className="flex items-center gap-1 text-xs text-muted mb-2">
              <Link href="/" className="hover:text-foreground transition-colors">
                Home
              </Link>
              {effectiveBreadcrumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-muted/50">/</span>
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="hover:text-foreground transition-colors"
                      style={
                        SUITE_ACCENT_COLORS[crumb.href]
                          ? { color: SUITE_ACCENT_COLORS[crumb.href].color }
                          : undefined
                      }
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-foreground/70">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0 w-full sm:w-auto">
              <PhotonBrothersBadge
                href={effectiveParent?.href ?? "/"}
                compact
                label={effectiveParent ? (effectiveParent.href === "/" ? "Back to Home" : `Back to ${effectiveParent.label} Suite`) : "Back to Dashboard"}
              />
              <div
                className="min-w-0 pl-3 border-l-[3px]"
                style={{ borderColor: suiteAccent.color }}
              >
                <h1
                  className={`text-lg sm:text-xl font-bold truncate ${colorMap[accentColor] || "text-orange-400"}`}
                >
                  {title}
                </h1>
                {subtitle && (
                  <p className="text-xs text-muted truncate">{subtitle}</p>
                )}
                {syncMeta && <StalenessIndicator syncMeta={syncMeta} />}
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
              <LiveClock className="text-xs text-muted hidden sm:inline tabular-nums" />
              {exportData && (
                <button
                  onClick={handleExport}
                  className="text-muted hover:text-foreground transition-colors p-1.5 rounded hover:bg-surface-2"
                  title="Export to CSV"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </button>
              )}
              <ThemeToggle />
              {headerRight}
            </div>
          </div>
        </div>
      </header>
      <main className={`${containerClass} py-6`}>{children}</main>
    </div>
  );
}
