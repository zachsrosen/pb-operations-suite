"use client";

import Link from "next/link";
import { ReactNode, useCallback } from "react";
import { ThemeToggle } from "./ThemeToggle";

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
    <div className="min-h-screen bg-[#0a0a0f] dark:bg-[#0a0a0f] light:bg-[#f8fafc] text-white dashboard-bg">
      <header className="bg-[#12121a] border-b border-zinc-800 sticky top-0 z-40 dashboard-header">
        <div className={`${containerClass} py-3 sm:py-4`}>
          {/* Breadcrumbs */}
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav className="flex items-center gap-1 text-xs text-zinc-500 dashboard-text-muted mb-2">
              <Link href="/" className="hover:text-zinc-300 transition-colors">
                Home
              </Link>
              {breadcrumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-zinc-700">/</span>
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="hover:text-zinc-300 transition-colors"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-zinc-400 dashboard-text-secondary">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <Link
                href="/"
                className="text-zinc-400 hover:text-white transition-colors shrink-0"
                title="Back to Home"
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
              <div className="min-w-0">
                <h1
                  className={`text-lg sm:text-xl font-bold truncate ${colorMap[accentColor] || "text-orange-400"}`}
                >
                  {title}
                </h1>
                {subtitle && (
                  <p className="text-xs text-zinc-500 dashboard-text-muted truncate">{subtitle}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {lastUpdated && (
                <span className="text-xs text-zinc-500 dashboard-text-muted hidden sm:inline">
                  Updated {lastUpdated}
                </span>
              )}
              {exportData && (
                <button
                  onClick={handleExport}
                  className="text-zinc-400 hover:text-white transition-colors p-1.5 rounded hover:bg-zinc-800"
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
