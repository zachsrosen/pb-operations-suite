"use client";

import Link from "next/link";
import { ReactNode, useCallback } from "react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import PhotonBrothersBadge from "./PhotonBrothersBadge";

// Maps dashboard paths to their parent suite
const SUITE_MAP: Record<string, { href: string; label: string }> = {
  // Operations Suite
  "/dashboards/scheduler": { href: "/suites/operations", label: "Operations" },
  "/dashboards/site-survey-scheduler": { href: "/suites/operations", label: "Operations" },
  "/dashboards/construction-scheduler": { href: "/suites/operations", label: "Operations" },
  "/dashboards/inspection-scheduler": { href: "/suites/operations", label: "Operations" },
  "/dashboards/timeline": { href: "/suites/operations", label: "Operations" },
  "/dashboards/equipment-backlog": { href: "/suites/operations", label: "Operations" },
  "/dashboards/inventory": { href: "/suites/operations", label: "Operations" },
  "/dashboards/bom": { href: "/suites/operations", label: "Operations" },
  "/dashboards/bom/history": { href: "/suites/operations", label: "Operations" },
  // Department Suite
  "/dashboards/site-survey": { href: "/suites/department", label: "Departments" },
  "/dashboards/design": { href: "/suites/department", label: "Departments" },
  "/dashboards/permitting": { href: "/suites/department", label: "Departments" },
  "/dashboards/inspections": { href: "/suites/department", label: "Departments" },
  "/dashboards/interconnection": { href: "/suites/department", label: "Departments" },
  "/dashboards/construction": { href: "/suites/department", label: "Departments" },
  "/dashboards/incentives": { href: "/suites/department", label: "Departments" },
  // Intelligence Suite
  "/dashboards/at-risk": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/qc": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/alerts": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/pipeline": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/optimizer": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/capacity": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/pe": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/sales": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/project-management": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/design-engineering": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/permitting-interconnection": { href: "/suites/intelligence", label: "Intelligence" },
  // Executive Suite
  "/dashboards/command-center": { href: "/suites/executive", label: "Executive" },
  "/dashboards/revenue": { href: "/suites/executive", label: "Executive" },
  "/dashboards/executive": { href: "/suites/executive", label: "Executive" },
  "/dashboards/locations": { href: "/suites/executive", label: "Executive" },
  "/dashboards/executive-calendar": { href: "/suites/executive", label: "Executive" },
  // Service + D&R Suite
  "/dashboards/service-scheduler": { href: "/suites/service", label: "Service + D&R" },
  "/dashboards/service-backlog": { href: "/suites/service", label: "Service + D&R" },
  "/dashboards/service": { href: "/suites/service", label: "Service + D&R" },
  "/dashboards/dnr-scheduler": { href: "/suites/service", label: "Service + D&R" },
  "/dashboards/dnr": { href: "/suites/service", label: "Service + D&R" },
  // Admin Suite
  "/dashboards/zuper-status-comparison": { href: "/suites/admin", label: "Admin" },
  "/dashboards/zuper-compliance": { href: "/suites/admin", label: "Admin" },
  "/dashboards/product-comparison": { href: "/suites/admin", label: "Admin" },
  "/dashboards/mobile": { href: "/suites/admin", label: "Admin" },
};

interface Breadcrumb {
  label: string;
  href?: string;
}

interface DashboardShellProps {
  title: string;
  subtitle?: string;
  accentColor?: string;
  lastUpdated?: string | null;
  headerRight?: ReactNode;
  children: ReactNode;
  /** Breadcrumb trail (e.g. [{ label: "Operations", href: "/" }, { label: "At-Risk" }]) */
  breadcrumbs?: Breadcrumb[];
  /** Use full viewport width instead of max-w-7xl container */
  fullWidth?: boolean;
  /** Data to enable CSV export button */
  exportData?: { data: Record<string, unknown>[]; filename: string };
}

export default function DashboardShell({
  title,
  subtitle,
  accentColor = "orange",
  lastUpdated,
  headerRight,
  children,
  breadcrumbs,
  fullWidth = false,
  exportData,
}: DashboardShellProps) {
  const pathname = usePathname();
  const parentSuite = SUITE_MAP[pathname] || null;
  const backHref = parentSuite?.href || "/";

  // Auto-generate breadcrumbs from suite mapping if not explicitly provided
  const effectiveBreadcrumbs = breadcrumbs || (parentSuite
    ? [{ label: parentSuite.label, href: parentSuite.href }]
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
  };

  const handleExport = useCallback(() => {
    if (!exportData) return;
    import("@/lib/export").then(({ exportToCSV }) => {
      exportToCSV(exportData.data, exportData.filename);
    });
  }, [exportData]);

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

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <Link
                href={backHref}
                className="text-muted hover:text-foreground transition-colors shrink-0"
                title={parentSuite ? `Back to ${parentSuite.label}` : "Back to Home"}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
              </Link>
              <PhotonBrothersBadge compact className="hidden sm:inline-flex" />
              <div className="min-w-0">
                <h1
                  className={`text-lg sm:text-xl font-bold truncate ${colorMap[accentColor] || "text-orange-400"}`}
                >
                  {title}
                </h1>
                {subtitle && (
                  <p className="text-xs text-muted truncate">{subtitle}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {lastUpdated && (
                <span className="text-xs text-muted hidden sm:inline">
                  Updated {lastUpdated}
                </span>
              )}
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
