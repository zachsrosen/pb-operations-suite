"use client";

/**
 * Admin Workflow — run detail page.
 *
 * Per-run drill-in: trigger context, step-by-step outputs, errors, timing.
 * Most of the structured data is rendered as pretty-printed JSON so admins
 * can inspect exactly what each action returned.
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";

import DashboardShell from "@/components/DashboardShell";

interface Run {
  id: string;
  workflowId: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  triggeredByEmail: string;
  triggerContext: Record<string, unknown>;
  result: unknown;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
  workflow: {
    id: string;
    name: string;
    triggerType: string;
    definition: { steps: Array<{ id: string; kind: string; inputs: Record<string, string> }> };
  };
}

const STATUS_COLORS: Record<string, string> = {
  RUNNING: "text-blue-400",
  SUCCEEDED: "text-green-400",
  FAILED: "text-red-400",
};

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/admin/workflows/runs/${runId}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) setRun(data.run);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId]);

  if (error) {
    return (
      <DashboardShell title="Run detail" accentColor="purple">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        </div>
      </DashboardShell>
    );
  }
  if (!run) {
    return (
      <DashboardShell title="Run detail" accentColor="purple">
        <div className="max-w-4xl mx-auto px-4 py-6 text-muted text-sm">Loading…</div>
      </DashboardShell>
    );
  }

  const resultObj = (run.result ?? {}) as {
    outputs?: Record<string, unknown>;
    stoppedEarly?: { byStepId: string; reason: string };
    dryRun?: boolean;
  };
  const outputs = resultObj.outputs ?? {};
  const isDryRun = resultObj.dryRun === true;

  return (
    <DashboardShell title={`Run: ${run.workflow.name}`} accentColor="purple">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm">
            <Link
              href="/dashboards/admin/workflows/runs"
              className="text-muted hover:text-foreground"
            >
              ← All runs
            </Link>
            <span className="text-zinc-600">·</span>
            <Link
              href={`/dashboards/admin/workflows/${run.workflowId}`}
              className="text-muted hover:text-foreground"
            >
              {run.workflow.name}
            </Link>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {isDryRun && (
              <span className="px-2 py-0.5 rounded text-xs bg-zinc-700 text-zinc-200 uppercase tracking-wide">
                Dry Run
              </span>
            )}
            <span className={`font-medium ${STATUS_COLORS[run.status]}`}>{run.status}</span>
            <span className="text-muted">
              {run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
            </span>
            {run.status === "RUNNING" && (
              <button
                onClick={async () => {
                  if (!confirm("Mark this run as FAILED? Use this for runs stuck after a known Inngest issue.")) return;
                  await fetch(`/api/admin/workflows/runs/${runId}/mark-failed`, { method: "POST" });
                  window.location.reload();
                }}
                className="text-xs text-amber-400 hover:text-amber-300 border border-amber-500/40 rounded px-2 py-1"
              >
                Mark FAILED
              </button>
            )}
          </div>
        </div>

        {/* Meta */}
        <section className="rounded-md border border-t-border bg-surface p-6 space-y-2 text-sm">
          <div className="flex">
            <div className="w-32 text-muted">Started</div>
            <div>{new Date(run.startedAt).toLocaleString()}</div>
          </div>
          <div className="flex">
            <div className="w-32 text-muted">Completed</div>
            <div>{run.completedAt ? new Date(run.completedAt).toLocaleString() : "—"}</div>
          </div>
          <div className="flex">
            <div className="w-32 text-muted">Triggered by</div>
            <div>{run.triggeredByEmail}</div>
          </div>
          <div className="flex">
            <div className="w-32 text-muted">Run ID</div>
            <div className="font-mono text-xs">{run.id}</div>
          </div>
          {resultObj.stoppedEarly && (
            <div className="flex">
              <div className="w-32 text-muted">Stopped early</div>
              <div className="text-amber-300">
                by <code>{resultObj.stoppedEarly.byStepId}</code> — {resultObj.stoppedEarly.reason}
              </div>
            </div>
          )}
        </section>

        {/* Error */}
        {run.errorMessage && (
          <section className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            <p className="font-medium mb-1">Error:</p>
            <pre className="whitespace-pre-wrap font-mono text-xs">{run.errorMessage}</pre>
          </section>
        )}

        {/* Trigger context */}
        <section className="rounded-md border border-t-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">
            Trigger context
          </h2>
          <pre className="bg-surface-2 rounded p-3 text-xs font-mono overflow-x-auto">
            {JSON.stringify(run.triggerContext, null, 2)}
          </pre>
        </section>

        {/* Step outputs */}
        <section className="rounded-md border border-t-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">
            Step outputs
          </h2>
          {run.workflow.definition.steps.length === 0 ? (
            <p className="text-xs text-muted italic">Workflow has no steps.</p>
          ) : (
            <div className="space-y-3">
              {run.workflow.definition.steps.map((step, idx) => {
                const output = (outputs as Record<string, unknown>)[step.id];
                const ran = output !== undefined;
                return (
                  <div
                    key={step.id}
                    className="rounded-md border border-t-border bg-surface-2 p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">
                        {idx + 1}. <span className="text-muted">{step.kind}</span> · <span className="font-mono text-xs">{step.id}</span>
                      </p>
                      <span className={`text-xs ${ran ? "text-green-400" : "text-zinc-500"}`}>
                        {ran ? "ran" : "not reached"}
                      </span>
                    </div>
                    {ran && (
                      <pre className="bg-background rounded p-2 text-xs font-mono overflow-x-auto border border-t-border">
                        {JSON.stringify(output, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
