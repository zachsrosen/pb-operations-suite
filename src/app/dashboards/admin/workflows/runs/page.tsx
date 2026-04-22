"use client";

/**
 * Admin Workflow — run history page.
 *
 * Cross-workflow view of the 100 most recent runs. Filter by status or
 * by specific workflow. Click a run to jump to its workflow.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import DashboardShell from "@/components/DashboardShell";

interface RunRow {
  id: string;
  workflowId: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  triggeredByEmail: string;
  durationMs: number | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  workflow: { name: string; triggerType: string };
}

const STATUS_COLORS: Record<string, string> = {
  RUNNING: "text-blue-400",
  SUCCEEDED: "text-green-400",
  FAILED: "text-red-400",
};

export default function AdminWorkflowRunsPage() {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/admin/workflows/runs?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRuns(data.runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
    // Poll every 10s for new runs
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <DashboardShell title="Workflow Runs" accentColor="purple">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Link href="/dashboards/admin/workflows" className="text-muted hover:text-foreground">
              ← Back to workflows
            </Link>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-muted">Filter:</label>
            <select
              className="rounded-md bg-surface-2 border border-t-border px-2 py-1"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="RUNNING">Running</option>
              <option value="SUCCEEDED">Succeeded</option>
              <option value="FAILED">Failed</option>
            </select>
            <button
              onClick={load}
              className="rounded-md bg-surface-2 hover:bg-surface-elevated border border-t-border px-3 py-1"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {runs == null ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : runs.length === 0 ? (
          <div className="rounded-md border border-t-border bg-surface px-6 py-10 text-center text-muted">
            <p className="text-sm">No runs match these filters.</p>
          </div>
        ) : (
          <div className="rounded-md border border-t-border bg-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="text-left px-4 py-3">Workflow</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Triggered by</th>
                  <th className="text-left px-4 py-3">Started</th>
                  <th className="text-left px-4 py-3">Duration</th>
                  <th className="text-left px-4 py-3">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-t-border">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-2 transition">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboards/admin/workflows/${r.workflowId}`}
                        className="text-foreground hover:text-purple-400"
                      >
                        {r.workflow.name}
                      </Link>
                      <p className="text-xs text-muted">{r.workflow.triggerType}</p>
                    </td>
                    <td className={`px-4 py-3 text-xs font-medium ${STATUS_COLORS[r.status]}`}>
                      {r.status}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{r.triggeredByEmail}</td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {new Date(r.startedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted truncate max-w-md">
                      <Link
                        href={`/dashboards/admin/workflows/runs/${r.id}`}
                        className="text-purple-400 hover:text-purple-300"
                      >
                        {r.errorMessage ? r.errorMessage.slice(0, 60) : "View detail"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
