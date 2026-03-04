"use client";

import { useState, useEffect, useCallback } from "react";

interface DedupRunOutcome {
  itemId: string;
  name: string;
  status: "deleted" | "skipped" | "failed";
  message?: string;
}

interface DedupRun {
  id: string;
  status: "pending" | "completed" | "failed";
  itemsDeleted: number;
  itemsSkipped: number;
  itemsFailed: number;
  executedBy: string;
  createdAt: string;
  completedAt: string | null;
  outcomes: DedupRunOutcome[] | null;
}

const STATUS_BADGE: Record<string, string> = {
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
};

export default function DedupHistory() {
  const [runs, setRuns] = useState<DedupRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/catalog/zoho-dedup/history");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
        <span className="ml-2 text-sm text-muted">Loading history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-lg bg-surface-2 p-6 text-center text-sm text-muted">
        No dedup runs found.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">Dedup History</h3>
      {runs.map((run) => {
        const expanded = expandedId === run.id;
        const outcomes = Array.isArray(run.outcomes) ? run.outcomes as DedupRunOutcome[] : null;
        return (
          <div key={run.id} className="rounded-lg border border-border bg-surface-2">
            <button
              onClick={() => setExpandedId(expanded ? null : run.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-surface transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[run.status] || ""}`}>
                  {run.status}
                </span>
                <span className="text-foreground">
                  {new Date(run.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="text-muted">by {run.executedBy}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="text-green-600 dark:text-green-400">{run.itemsDeleted} deleted</span>
                <span>{run.itemsSkipped} skipped</span>
                {run.itemsFailed > 0 && (
                  <span className="text-red-500">{run.itemsFailed} failed</span>
                )}
                <span className="text-muted">{expanded ? "▲" : "▼"}</span>
              </div>
            </button>
            {expanded && outcomes && outcomes.length > 0 && (
              <div className="border-t border-border px-4 py-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="pb-1 pr-4">Item ID</th>
                      <th className="pb-1 pr-4">Name</th>
                      <th className="pb-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outcomes.map((o, i) => (
                      <tr key={`${o.itemId}-${i}`} className="border-t border-border/50">
                        <td className="py-1.5 pr-4 font-mono text-muted">{o.itemId}</td>
                        <td className="py-1.5 pr-4 text-foreground">{o.name}</td>
                        <td className="py-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            o.status === "deleted"
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                              : o.status === "failed"
                                ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                          }`}>
                            {o.status}
                          </span>
                          {o.message && <span className="ml-2 text-muted">{o.message}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {expanded && (!outcomes || outcomes.length === 0) && (
              <div className="border-t border-border px-4 py-3 text-xs text-muted">
                No outcome details available.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
