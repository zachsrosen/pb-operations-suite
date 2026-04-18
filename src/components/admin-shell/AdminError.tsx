// src/components/admin-shell/AdminError.tsx
"use client";

export interface AdminErrorProps {
  error: string;
  onRetry?: () => void;
}

/**
 * Error card for admin data-fetching failures. `onRetry` wires to a React
 * Query `refetch()` or similar. Without it, the button is hidden.
 */
export function AdminError({ error, onRetry }: AdminErrorProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-8 text-center"
    >
      <p className="text-sm font-medium text-red-400">Something went wrong</p>
      <p className="text-xs text-muted">{error}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-t-border/60 bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-elevated"
        >
          Retry
        </button>
      )}
    </div>
  );
}
