"use client";

import Link from "next/link";

export interface HeaderProps {
  title?: string;
  subtitle?: string;
  lastUpdated?: string;
  loading?: boolean;
  error?: string | null;
  showBackLink?: boolean;
  rightContent?: React.ReactNode;
}

export function Header({
  title = "PB Operations Suite",
  subtitle,
  lastUpdated,
  loading = false,
  error,
  showBackLink = false,
  rightContent,
}: HeaderProps) {
  return (
    <header className="border-b border-zinc-800 px-6 py-4 bg-surface-gradient sticky top-0 z-50">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-4">
          {showBackLink && (
            <Link
              href="/"
              className="text-zinc-500 hover:text-white transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m12 19-7-7 7-7" />
                <path d="M19 12H5" />
              </svg>
            </Link>
          )}
          <div>
            <h1 className="text-xl font-bold text-gradient-accent">{title}</h1>
            {subtitle && (
              <p className="text-xs text-zinc-500">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {rightContent}
          <div className="text-sm text-zinc-500 text-right">
            {loading ? (
              "Loading..."
            ) : error ? (
              <span className="text-red-400">{error}</span>
            ) : lastUpdated ? (
              <>Last updated: {new Date(lastUpdated).toLocaleString()}</>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

export interface TabNavProps {
  tabs: Array<{
    id: string;
    label: string;
    badge?: number;
    badgeColor?: "danger" | "pe" | "warning";
  }>;
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function TabNav({ tabs, activeTab, onTabChange }: TabNavProps) {
  return (
    <div className="flex gap-1 mt-4 border-b border-zinc-800">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`nav-tab ${activeTab === tab.id ? "active" : ""}`}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span
              className={`ml-2 badge ${
                tab.badgeColor === "pe"
                  ? "badge-pe"
                  : tab.badgeColor === "warning"
                  ? "badge-warning"
                  : "badge-danger"
              }`}
            >
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
