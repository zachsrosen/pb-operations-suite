// src/components/admin-shell/AdminPageHeader.tsx
import type { ReactNode } from "react";
import { AdminBreadcrumb } from "./AdminBreadcrumb";

export interface AdminPageHeaderProps {
  title: string;
  breadcrumb?: string[];
  actions?: ReactNode;
  subtitle?: string;
}

/**
 * Per-page header block. Every admin page renders this at the top of its
 * output. AdminShell provides outer chrome; this provides the page's
 * identity (title, breadcrumb, page-local actions).
 */
export function AdminPageHeader({ title, breadcrumb, actions, subtitle }: AdminPageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-3 border-b border-t-border/60 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && <AdminBreadcrumb segments={breadcrumb} />}
        <h1 className="mt-1 text-xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
