// src/components/admin-shell/AdminEmpty.tsx
import type { ReactNode } from "react";

export interface AdminEmptyProps {
  label: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

/**
 * Standardized empty-state card for admin pages. Replaces ad-hoc "no results"
 * UI across the 9 admin pages. Theme-token colors only — no hardcoded greys.
 */
export function AdminEmpty({ label, description, action, icon }: AdminEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-t-border/60 bg-surface p-8 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
