// src/components/admin-shell/AdminLoading.tsx

export interface AdminLoadingProps {
  label?: string;
}

/**
 * Centered spinner for admin suspense boundaries / pending states.
 * Uses the existing animate-spin utility. Role="status" keeps it accessible.
 */
export function AdminLoading({ label }: AdminLoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 py-12"
    >
      <div
        aria-hidden="true"
        className="h-6 w-6 animate-spin rounded-full border-2 border-t-border/30 border-t-foreground"
      />
      {label && <p className="text-xs text-muted">{label}</p>}
    </div>
  );
}
