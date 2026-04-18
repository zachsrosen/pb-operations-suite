"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface PipelineHealth {
  pipeline: string;
  dealCount: number;
  lastSyncAt: string | null;
  lastSyncDurationMs: number | null;
  recentErrors: number;
  watermark: string | null;
}

interface HealthResponse {
  pipelines: PipelineHealth[];
  timestamp: string;
}

function StatusDot({ lastSyncAt, recentErrors }: { lastSyncAt: string | null; recentErrors: number }) {
  if (!lastSyncAt) {
    return <span className="inline-block w-2 h-2 rounded-full bg-zinc-500" title="Never synced" />;
  }
  const minutesAgo = Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / 60000);

  if (recentErrors > 2) {
    return <span className="inline-block w-2 h-2 rounded-full bg-red-400" title={`${recentErrors} errors in last hour`} />;
  }
  if (minutesAgo > 30) {
    return <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" title={`Last sync ${minutesAgo}m ago`} />;
  }
  return <span className="inline-block w-2 h-2 rounded-full bg-green-400" title={`Last sync ${minutesAgo}m ago`} />;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "--";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function SyncStatusCard() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<HealthResponse>({
    queryKey: ["admin", "deal-sync", "health"],
    queryFn: async () => {
      const res = await fetch("/api/admin/deal-sync/health");
      if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/deal-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
      const result = await res.json();
      const totalUpserted = result.results?.reduce(
        (sum: number, r: { upserted?: number }) => sum + (r.upserted || 0),
        0
      ) ?? 0;
      setSyncResult(`Synced ${totalUpserted} deals`);
      queryClient.invalidateQueries({ queryKey: ["admin", "deal-sync", "health"] });
    } catch (err) {
      setSyncResult(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="bg-surface rounded-lg border border-t-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Deal Mirror Status</h3>
        <button
          onClick={handleSyncNow}
          disabled={syncing}
          className="text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {syncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      {syncResult && (
        <p className="text-xs text-muted mb-3 bg-surface-2 rounded px-2 py-1">{syncResult}</p>
      )}

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-skeleton rounded animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400">
          Failed to load sync status: {(error as Error).message}
        </p>
      )}

      {data && (
        <div className="space-y-2">
          {data.pipelines.map((p) => (
            <div
              key={p.pipeline}
              className="flex items-center gap-3 text-xs bg-surface-2 rounded px-3 py-2"
            >
              <StatusDot lastSyncAt={p.lastSyncAt} recentErrors={p.recentErrors} />
              <span className="font-medium text-foreground w-16">{p.pipeline}</span>
              <span className="text-muted tabular-nums">
                {p.dealCount.toLocaleString()} deals
              </span>
              <span className="text-muted ml-auto">
                {formatTimeAgo(p.lastSyncAt)}
              </span>
              <span className="text-muted tabular-nums w-14 text-right">
                {formatDuration(p.lastSyncDurationMs)}
              </span>
              {p.recentErrors > 0 && (
                <span className="text-red-400 tabular-nums">
                  {p.recentErrors} err
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
