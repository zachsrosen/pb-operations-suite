"use client";

import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

/** Relative "X ago" for the last-synced label. */
function syncTimeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Manual PE sync. "Sync now" = fast full status refresh (~15-40s, no detail
 *  sweep); the ▾ "Full sync" pulls action-item details too (~3-4 min).
 *  Shows when PE last synced (auto cron or manual) so the team doesn't re-click
 *  unnecessarily and burn the PE API daily quota. Shared across the PE tabs. */
export default function SyncNowButton() {
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "fast" | "full" | "done">("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const busy = state === "fast" || state === "full";

  // Lightweight last-sync probe (reads the run table only — no PE API call).
  const refreshLastSync = useCallback(async () => {
    try {
      const r = await fetch("/api/accounting/pe-sync-now").then((x) => x.json());
      if (r?.lastSyncedAt) setLastSyncedAt(r.lastSyncedAt);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const initial = setTimeout(refreshLastSync, 0); // defer out of the sync effect body
    const poll = setInterval(refreshLastSync, 60_000); // catch auto-syncs / other users
    const ticker = setInterval(() => setTick((t) => t + 1), 30_000); // re-render "X ago"
    return () => { clearTimeout(initial); clearInterval(poll); clearInterval(ticker); };
  }, [refreshLastSync]);

  const run = async (scope: "fast" | "full") => {
    if (busy) return;
    setState(scope);
    try {
      await fetch("/api/accounting/pe-sync-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.peDeals.list() }),
        qc.invalidateQueries({ queryKey: queryKeys.peAnalytics.list() }),
      ]);
      await refreshLastSync();
      setState("done");
      setTimeout(() => setState((s) => (s === "done" ? "idle" : s)), 2500);
    } catch {
      setState("idle");
    }
  };
  return (
    <div className="flex items-center gap-2">
    <span
      className="text-[11px] text-muted tabular-nums whitespace-nowrap"
      title={lastSyncedAt ? `PE last synced: ${new Date(lastSyncedAt).toLocaleString()}` : "No PE sync recorded yet"}
    >
      Synced {busy ? "…" : syncTimeAgo(lastSyncedAt)}
    </span>
    <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs">
      <button
        onClick={() => run("fast")}
        disabled={busy}
        className={`px-2.5 py-1 transition-colors ${busy ? "text-muted" : "text-emerald-400 hover:bg-emerald-500/10"}`}
        title="Refresh every doc's current status from PE (~15-40s)"
      >
        {state === "fast" ? "Syncing…" : state === "done" ? "Updated ✓" : "↻ Sync now"}
      </button>
      <button
        onClick={() => run("full")}
        disabled={busy}
        className={`px-2 py-1 border-l border-border transition-colors ${busy ? "text-muted" : "text-muted hover:text-foreground hover:bg-surface-2"}`}
        title="Full re-sync incl. action-item details — slower (~3-4 min)"
      >
        {state === "full" ? "Full…" : "Full"}
      </button>
    </div>
    </div>
  );
}
