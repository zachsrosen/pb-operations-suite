"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

/**
 * Admin "Build / Re-sync the map" button.
 *
 * POSTs `/api/workflow-map/refresh` (ADMIN-gated, rate-limited to one refresh
 * per 5 min). The first backfill is ~870 HubSpot calls / several minutes; the
 * route runs with `maxDuration = 300` and the sync persists detail-cache
 * progress incrementally, so a timeout is recoverable — re-clicking continues
 * where it left off rather than starting over.
 *
 * On success we invalidate the shared workflow-map query so the snapshot
 * re-fetches and the page re-renders with fresh data.
 *
 * Rendered only when the user is an admin (`canEditSop` doubles as the admin
 * signal on the page). Two presentations:
 *   - variant="cta"   — prominent build button for the empty state.
 *   - variant="inline" — small Re-sync button shown next to the last-synced line.
 */
export default function RefreshButton({
  variant = "cta",
}: {
  variant?: "cta" | "inline";
}) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch("/api/workflow-map/refresh", { method: "POST" });

      if (!res.ok) {
        if (res.status === 429) {
          setError("A refresh ran recently — try again shortly.");
        } else if (res.status === 403) {
          setError("Admin only.");
        } else {
          let message = "Refresh failed.";
          try {
            const data = await res.json();
            if (data?.error) message = data.error;
          } catch {
            // non-JSON error body — keep generic message
          }
          setError(message);
          setHint(
            "The first build can take a few minutes — if it timed out, click again to continue (it picks up where it left off).",
          );
        }
        return;
      }

      // Success — re-fetch the shared snapshot so the page re-renders.
      await queryClient.invalidateQueries({ queryKey: queryKeys.workflowMap() });
    } catch {
      setError("Network error — the build may still be running.");
      setHint(
        "The first build can take a few minutes — if it timed out, click again to continue (it picks up where it left off).",
      );
    } finally {
      setLoading(false);
    }
  }, [queryClient]);

  const label = variant === "cta" ? "Build the map" : "Re-sync";
  const loadingLabel =
    variant === "cta" ? "Building the map…" : "Re-syncing…";

  const buttonClass =
    variant === "cta"
      ? "px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      : "px-2.5 py-1 text-xs font-medium rounded bg-surface-2 text-foreground hover:bg-surface border border-t-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

  if (variant === "inline") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className={buttonClass}
          title="Re-sync the workflow map from HubSpot"
        >
          {loading ? loadingLabel : label}
        </button>
        {loading && (
          <span className="text-xs text-muted">
            this can take a few minutes
          </span>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className={buttonClass}
      >
        {loading ? loadingLabel : label}
      </button>
      {loading && (
        <p className="text-xs text-muted">
          Building the map… this can take a few minutes.
        </p>
      )}
      {error && (
        <div className="rounded border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400 max-w-md">
          <p>{error}</p>
          {hint && <p className="mt-1 text-muted">{hint}</p>}
        </div>
      )}
    </div>
  );
}
