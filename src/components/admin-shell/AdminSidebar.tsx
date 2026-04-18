// src/components/admin-shell/AdminSidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, findActiveAdminNavItem } from "./nav";

export interface AdminSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const ICON_PATHS: Record<string, string> = {
  users: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  shield: "M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z",
  list: "M4 6h16M4 12h16M4 18h16",
  calendar: "M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z",
  ticket: "M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 100 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 100-4V8zM13 6v12",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z",
  alert: "M12 9v4m0 4h.01M5 20h14a2 2 0 001.7-3L13.7 5a2 2 0 00-3.4 0L3.3 17A2 2 0 005 20z",
};

function NavIcon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export function AdminSidebar({ collapsed, onToggleCollapsed }: AdminSidebarProps) {
  const pathname = usePathname() ?? "/admin";
  const active = findActiveAdminNavItem(pathname);

  return (
    <aside
      aria-label="Admin navigation"
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-t-border/60 bg-surface/50 transition-[width] duration-150 ${
        collapsed ? "w-[64px]" : "w-[220px]"
      }`}
    >
      <div className="flex items-center justify-between px-3 py-4">
        <Link
          href="/admin"
          className={`text-xs font-bold tracking-wider text-foreground ${collapsed ? "hidden" : ""}`}
        >
          ADMIN
        </Link>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d={collapsed ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
          </svg>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {ADMIN_NAV.map((group) => (
          <div key={group.label} className="mt-2">
            {!collapsed && (
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted/80">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = active?.item.href === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors ${
                        isActive
                          ? "bg-surface-elevated font-medium text-foreground"
                          : "text-muted hover:bg-surface-2 hover:text-foreground"
                      }`}
                    >
                      <NavIcon name={item.iconName} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
