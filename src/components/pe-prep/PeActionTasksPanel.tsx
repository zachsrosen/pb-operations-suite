"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface ActionTask {
  id: string;
  pCode: string;
  severity: "critical" | "major" | "conditional" | "monitoring";
  category: string;
  title: string;
  message: string;
  action: string;
  status: "OPEN" | "RESOLVED_AUTO" | "RESOLVED_MANUAL" | "DISMISSED";
  manualResolvedAt: string | null;
  evidence: Record<string, unknown>;
}

interface LatestRun {
  id: string;
  completedAt: string | null;
  triggeredBy: string;
  durationMs: number | null;
}

const SEVERITY_ORDER = ["critical", "major", "conditional", "monitoring"] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  major: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  conditional: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  monitoring: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function PeActionTasksPanel({ dealId }: { dealId: string }) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["pe-crossref", "tasks", dealId],
    queryFn: async () => {
      const res = await fetch(`/api/pe-crossref/${dealId}/tasks`);
      if (!res.ok) throw new Error("Failed to load tasks");
      return res.json() as Promise<{ tasks: ActionTask[]; latestRun: LatestRun | null }>;
    },
  });

  const patchTask = useMutation({
    mutationFn: async (vars: { taskId: string; action: "resolve" | "dismiss" | "reopen"; reason?: string }) => {
      const res = await fetch(`/api/pe-crossref/tasks/${vars.taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: vars.action, reason: vars.reason }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pe-crossref", "tasks", dealId] }),
  });

  const handleRerun = async () => {
    setRunning(true);
    try {
      // Server-sent events response — we don't parse the stream here, just
      // wait for the connection to close (which happens when the server
      // closes the controller after the run completes).
      const res = await fetch(`/api/pe-crossref/${dealId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      // Drain the stream to ensure the run completes server-side.
      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } finally {
      setRunning(false);
      queryClient.invalidateQueries({ queryKey: ["pe-crossref", "tasks", dealId] });
    }
  };

  const tasks = data?.tasks ?? [];
  const open = tasks.filter((t) => t.status === "OPEN");
  const resolved = tasks.filter((t) => t.status === "RESOLVED_AUTO" || t.status === "RESOLVED_MANUAL");
  const dismissed = tasks.filter((t) => t.status === "DISMISSED");

  const byTier = (sev: Severity) => open.filter((t) => t.severity === sev);
  const counts = SEVERITY_ORDER.map((s) => byTier(s).length);

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            Action Tasks {tasks.length > 0 && `(${open.length} open / ${resolved.length} resolved)`}
          </h3>
          {data?.latestRun && (
            <p className="text-[11px] text-muted mt-0.5">
              Last computed {formatRelative(data.latestRun.completedAt)} by {data.latestRun.triggeredBy}
              {data.latestRun.durationMs && ` (${Math.round(data.latestRun.durationMs / 1000)}s)`}
              {" · "}
              <span className="text-red-400">{counts[0]} critical</span>
              {" · "}
              <span className="text-orange-400">{counts[1]} major</span>
              {" · "}
              <span className="text-yellow-400">{counts[2]} conditional</span>
              {" · "}
              <span className="text-blue-400">{counts[3]} monitoring</span>
            </p>
          )}
        </div>
        <button
          onClick={handleRerun}
          disabled={running}
          className="px-3 py-1 text-xs bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-md"
        >
          {running ? "Running…" : "↻ Re-run cross-ref"}
        </button>
      </div>

      {isLoading && <p className="text-xs text-muted">Loading…</p>}

      {!isLoading && tasks.length === 0 && (
        <p className="text-xs text-muted">
          No cross-reference has run yet for this deal. Click &quot;Re-run cross-ref&quot; to start.
        </p>
      )}

      {!isLoading && tasks.length > 0 && open.length === 0 && (
        <p className="text-xs text-green-400">✓ No open action tasks. {resolved.length > 0 && `${resolved.length} resolved.`}</p>
      )}

      {SEVERITY_ORDER.map((sev) => {
        const tier = byTier(sev);
        if (tier.length === 0) return null;
        return (
          <details key={sev} open className="mt-3">
            <summary className="text-xs font-semibold uppercase tracking-wide cursor-pointer">
              {sev} ({tier.length})
            </summary>
            <div className="space-y-2 mt-2">
              {tier.map((t) => (
                <ActionTaskCard
                  key={t.id}
                  task={t}
                  onAction={(action, reason) => patchTask.mutate({ taskId: t.id, action, reason })}
                />
              ))}
            </div>
          </details>
        );
      })}

      {resolved.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs font-semibold uppercase tracking-wide cursor-pointer text-muted">
            Resolved ({resolved.length})
          </summary>
          <div className="space-y-2 mt-2">
            {resolved.map((t) => (
              <ActionTaskCard
                key={t.id}
                task={t}
                onAction={(action, reason) => patchTask.mutate({ taskId: t.id, action, reason })}
              />
            ))}
          </div>
        </details>
      )}

      {dismissed.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs font-semibold uppercase tracking-wide cursor-pointer text-muted">
            Dismissed ({dismissed.length})
          </summary>
          <div className="space-y-2 mt-2">
            {dismissed.map((t) => (
              <ActionTaskCard
                key={t.id}
                task={t}
                onAction={(action, reason) => patchTask.mutate({ taskId: t.id, action, reason })}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ActionTaskCard({
  task,
  onAction,
}: {
  task: ActionTask;
  onAction: (action: "resolve" | "dismiss" | "reopen", reason?: string) => void;
}) {
  const sev = task.severity as Severity;
  const isResolved = task.status === "RESOLVED_AUTO" || task.status === "RESOLVED_MANUAL";
  const isDismissed = task.status === "DISMISSED";

  return (
    <div className={`rounded border border-t-border p-3 ${isResolved || isDismissed ? "bg-surface/60 opacity-70" : "bg-surface"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${SEVERITY_BADGE[sev]}`}>
              {task.pCode}
            </span>
            <span className="text-xs font-semibold text-foreground">{task.title}</span>
            {task.status === "RESOLVED_MANUAL" && task.manualResolvedAt && (
              <span className="text-[10px] text-green-400">✓ resolved manually</span>
            )}
            {task.status === "RESOLVED_AUTO" && (
              <span className="text-[10px] text-green-400">✓ auto-resolved</span>
            )}
            {task.status === "DISMISSED" && (
              <span className="text-[10px] text-muted">dismissed</span>
            )}
          </div>
          <p className="text-xs text-foreground">{task.message}</p>
          <p className="text-xs text-muted mt-1">→ {task.action}</p>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {task.status === "OPEN" ? (
            <>
              <button
                onClick={() => onAction("resolve")}
                className="text-[10px] px-2 py-0.5 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 whitespace-nowrap"
              >
                ✓ Resolve
              </button>
              <button
                onClick={() => {
                  const reason = prompt("Reason for dismissing this task?") ?? "";
                  if (reason.trim()) onAction("dismiss", reason);
                }}
                className="text-[10px] px-2 py-0.5 bg-zinc-500/20 text-zinc-400 rounded hover:bg-zinc-500/30 whitespace-nowrap"
              >
                ✗ Dismiss
              </button>
            </>
          ) : (
            <button
              onClick={() => onAction("reopen")}
              className="text-[10px] px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded hover:bg-orange-500/30 whitespace-nowrap"
            >
              ↻ Reopen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
