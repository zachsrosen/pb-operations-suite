"use client";

import type { ReactNode } from "react";

export interface AdminBulkActionBarProps {
  visible: boolean;
  count: number;
  onCancel: () => void;
  children: ReactNode;
}

export function AdminBulkActionBar({ visible, count, onCancel, children }: AdminBulkActionBarProps) {
  if (!visible) return null;
  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="Bulk actions"
      className="sticky bottom-4 z-30 mx-auto flex max-w-4xl items-center justify-between gap-3 rounded-lg border border-t-border/60 bg-surface-elevated px-4 py-3 shadow-lg"
    >
      <div className="text-sm text-foreground">
        <span className="font-medium">{count} selected</span>
      </div>
      <div className="flex items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-t-border/60 bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
