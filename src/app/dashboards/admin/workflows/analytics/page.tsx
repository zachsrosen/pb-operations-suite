"use client";

/**
 * Admin Workflows — analytics dashboard.
 *
 * High-level view: overall totals + top-workflow table + daily bar chart.
 * Queries /api/admin/workflows/analytics which aggregates on the server
 * so this page stays fast.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import DashboardShell from "@/components/DashboardShell";

interface Analytics {
  window: { days: number; since: string };
  totals: {
    total: number;
    succeeded: number;
    failed: number;
    running: number;
    successRate: number;
    avgDurationMs: number | null;
    p50DurationMs: number | null;
    p95DurationMs: number | null;
  };
  topWorkflows: Array<{
    workflowId: string;
    name: string;
    total: number;
    succeeded: number;
    failed: number;
    running: number;
    avgDurationMs: number | null;
  }>;
  dailySeries: Array<{
    day: string;
    total: number;
    succeeded: number;
    failed: number;
    running: number;
  }>;
}

const WINDOWS = [1, 7, 30, 90];

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/admin/workflows/analytics?days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [days]);

  const maxDaily = data?.dailySeries.reduce((m, d) => Math.max(m, d.total), 0) ?? 1;

  return (
    <DashboardShell title="Workflow Analytics" accentColor="purple">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <Link href="/dashboards/admin/workflows" className="text-sm text-muted hover:text-foreground">
            ← Back to workflows
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Window:</span>
            {WINDOWS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 rounded ${
                  days === d
                    ? "bg-purple-600 text-white"
                    : "bg-surface-2 text-muted hover:text-foreground"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!data ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Total runs" value={String(data.totals.total)} />
              <Stat
                label="Success rate"
                value={fmtPct(data.totals.successRate)}
                sub={`${data.totals.succeeded} of ${data.totals.total}`}
              />
              <Stat label="Avg duration" value={fmtMs(data.totals.avgDurationMs)} />
              <Stat
                label="p50 / p95"
                value={`${fmtMs(data.totals.p50DurationMs)} / ${fmtMs(data.totals.p95DurationMs)}`}
              />
            </div>

            <section className="rounded-md border border-t-border bg-surface p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-4">Runs per day</h2>
              {data.dailySeries.length === 0 ? (
                <p className="text-muted text-sm">No runs in this window.</p>
              ) : (
                <div className="flex items-end gap-2 h-40">
                  {data.dailySeries.map((d) => {
                    const succeededHeight = maxDaily > 0 ? (d.succeeded / maxDaily) * 100 : 0;
                    const failedHeight = maxDaily > 0 ? (d.failed / maxDaily) * 100 : 0;
                    const runningHeight = maxDaily > 0 ? (d.running / maxDaily) * 100 : 0;
                    return (
                      <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-[20px]" title={`${d.day}: ${d.total} runs`}>
                        <div className="w-full flex flex-col justify-end gap-0.5 h-32">
                          <div style={{ height: `${failedHeight}%` }} className="w-full bg-red-500/60" />
                          <div style={{ height: `${runningHeight}%` }} className="w-full bg-blue-500/60" />
                          <div style={{ height: `${succeededHeight}%` }} className="w-full bg-green-500/60" />
                        </div>
                        <span className="text-xs text-muted rotate-45 origin-top-left translate-y-1">
                          {d.day.slice(5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center gap-4 text-xs text-muted mt-4">
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500/60" /> Succeeded</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500/60" /> Running</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500/60" /> Failed</span>
              </div>
            </section>

            <section className="rounded-md border border-t-border bg-surface overflow-hidden">
              <div className="px-6 py-4 border-b border-t-border">
                <h2 className="text-sm font-semibold uppercase tracking-wide">Top workflows</h2>
              </div>
              {data.topWorkflows.length === 0 ? (
                <p className="p-6 text-muted text-sm">No runs in this window.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="text-left px-4 py-3">Workflow</th>
                      <th className="text-right px-4 py-3">Runs</th>
                      <th className="text-right px-4 py-3">Succeeded</th>
                      <th className="text-right px-4 py-3">Failed</th>
                      <th className="text-right px-4 py-3">Avg duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-t-border">
                    {data.topWorkflows.map((wf) => (
                      <tr key={wf.workflowId} className="hover:bg-surface-2 transition">
                        <td className="px-4 py-3">
                          <Link
                            href={`/dashboards/admin/workflows/${wf.workflowId}`}
                            className="text-foreground hover:text-purple-400"
                          >
                            {wf.name}
                          </Link>
                        </td>
                        <td className="text-right px-4 py-3">{wf.total}</td>
                        <td className="text-right px-4 py-3 text-green-400">{wf.succeeded}</td>
                        <td className={`text-right px-4 py-3 ${wf.failed > 0 ? "text-red-400" : ""}`}>{wf.failed}</td>
                        <td className="text-right px-4 py-3 text-muted">{fmtMs(wf.avgDurationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </DashboardShell>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-t-border bg-surface p-4">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted mt-1">{sub}</p>}
    </div>
  );
}
