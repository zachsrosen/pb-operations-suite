// src/components/admin-shell/AdminShell.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AdminSidebar } from "./AdminSidebar";
import { AdminSearch } from "./AdminSearch";
import { UserMenu } from "@/components/UserMenu";

export interface AdminShellProps {
  children: ReactNode;
}

/**
 * Outer layout for every page under `/admin/*`. Provides:
 *   - Left sidebar with nav groups (People / Operations / Audit), plus a
 *     back-to-home link at the top for exiting the admin surface.
 *   - Top header bar containing the in-shell admin search and the global
 *     UserMenu (account controls + sign out).
 *   - Main content slot that children render into.
 *
 * Pages render their own `<AdminPageHeader>` at the top of their body.
 * AdminShell does not read child props — it's pure chrome.
 *
 * Auto-collapse: below 1280px viewport width the sidebar auto-collapses.
 * State is local — no persistence in phase 1.
 */
export function AdminShell({ children }: AdminShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1280px)");
    setCollapsed(!mq.matches);
    const onChange = (ev: MediaQueryListEvent) => setCollapsed(!ev.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AdminSidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-t-border/60 bg-surface/60 px-6 py-3 backdrop-blur-sm">
          <div className="min-w-0 flex-1" />
          <AdminSearch />
          <UserMenu />
        </div>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
