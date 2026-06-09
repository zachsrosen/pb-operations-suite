"use client";

/**
 * Tech Ops Bot Escalations admin review UI.
 *
 * - Filter toggle: Pending / Resolved / Dismissed / All
 * - Table of escalations (one row each)
 * - Click row → side panel with the full question + bot context
 * - Resolve / Dismiss from the panel with an optional note
 *
 * Rows with senderName "async-error" are crash diagnostics written by the
 * Google Chat webhook (not user questions); they're badged distinctly so
 * admins can tell them apart from genuine escalations.
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface EscalationRow {
  id: string;
  senderEmail: string;
  senderName: string;
  question: string;
  botContext: string | null;
  spaceId: string;
  threadId: string | null;
  status: string;
  resolvedAt: string | null;
  resolvedNote: string | null;
  createdAt: string;
}

interface Props {
  initialEscalations: EscalationRow[];
  currentFilter: "PENDING" | "RESOLVED" | "DISMISSED" | "all";
  counts: { pending: number; resolved: number; dismissed: number };
}

const isDebugRow = (e: EscalationRow) =>
  e.senderName === "async-error" || e.senderEmail === "DEBUG";

const statusBadge = (status: string) => {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    PENDING: { bg: "bg-amber-500/15", text: "text-amber-400", label: "Pending" },
    RESOLVED: { bg: "bg-green-500/15", text: "text-green-400", label: "Resolved" },
    DISMISSED: { bg: "bg-zinc-500/15", text: "text-zinc-400", label: "Dismissed" },
  };
  const m = map[status] ?? { bg: "bg-zinc-500/15", text: "text-zinc-400", label: status };
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  );
};

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

export default function TechOpsEscalationsClient({
  initialEscalations,
  currentFilter,
  counts,
}: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolvedNote, setResolvedNote] = useState("");

  const detail = initialEscalations.find((e) => e.id === selectedId) ?? null;

  const openEscalation = useCallback((id: string) => {
    setSelectedId(id);
    setActionError(null);
    setResolvedNote("");
  }, []);

  const closePanel = () => {
    setSelectedId(null);
    setActionError(null);
  };

  const handleAction = useCallback(
    async (status: "RESOLVED" | "DISMISSED") => {
      if (!detail) return;
      setActionInFlight(true);
      setActionError(null);

      const body: Record<string, unknown> = { id: detail.id, status };
      if (resolvedNote.trim()) body.resolvedNote = resolvedNote.trim();

      try {
        const res = await fetch("/api/admin/tech-ops-bot/escalations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setActionError(data.error || "Action failed");
          return;
        }
        router.refresh();
        closePanel();
      } catch {
        setActionError("Network error");
      } finally {
        setActionInFlight(false);
      }
    },
    [detail, resolvedNote, router],
  );

  const switchFilter = (f: Props["currentFilter"]) => {
    const params = new URLSearchParams();
    if (f !== "PENDING") params.set("status", f);
    router.push(`/dashboards/admin/tech-ops-escalations?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* Filter toggle */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        {(
          [
            ["PENDING", `Pending (${counts.pending})`],
            ["RESOLVED", `Resolved (${counts.resolved})`],
            ["DISMISSED", `Dismissed (${counts.dismissed})`],
            ["all", `All (${counts.pending + counts.resolved + counts.dismissed})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => switchFilter(key as Props["currentFilter"])}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
              currentFilter === key
                ? "bg-purple-500/15 border-purple-500/40 text-purple-400"
                : "bg-surface border-t-border text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {initialEscalations.length === 0 && (
        <div className="bg-surface border border-t-border rounded-lg p-12 text-center text-muted">
          No escalations in this view.
        </div>
      )}

      {/* Table */}
      {initialEscalations.length > 0 && (
        <div className="bg-surface border border-t-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Question</th>
                <th className="px-4 py-2 text-left font-medium">From</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">When</th>
                <th className="px-4 py-2 text-right font-medium">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {initialEscalations.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => openEscalation(e.id)}
                  className="border-t border-t-border cursor-pointer hover:bg-surface-2 transition-colors"
                >
                  <td className="px-4 py-3 text-foreground font-medium max-w-md truncate">
                    {e.question}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {isDebugRow(e) ? (
                      <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded bg-red-500/15 text-red-400">
                        async error
                      </span>
                    ) : (
                      e.senderName || e.senderEmail.split("@")[0]
                    )}
                  </td>
                  <td className="px-4 py-3">{statusBadge(e.status)}</td>
                  <td className="px-4 py-3 text-muted">{fmtDate(e.createdAt)}</td>
                  <td className="px-4 py-3 text-right text-muted">→</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Side panel */}
      {detail && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={closePanel}>
          <aside
            onClick={(ev) => ev.stopPropagation()}
            className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-background border-l border-t-border shadow-2xl overflow-auto z-50"
          >
            <div className="flex flex-col min-h-full">
              {/* Header */}
              <div className="border-b border-t-border bg-surface px-6 py-4 sticky top-0 z-10">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-foreground">
                      {isDebugRow(detail) ? "Async processing error" : "Escalation"}
                    </h2>
                    <div className="text-xs text-muted mt-1">
                      {isDebugRow(detail)
                        ? "Webhook crash diagnostic"
                        : `${detail.senderName || detail.senderEmail}`}{" "}
                      · {fmtDate(detail.createdAt)} · {statusBadge(detail.status)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closePanel}
                    className="text-muted hover:text-foreground text-xl leading-none"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Question / error message */}
              <div className="px-6 py-4 border-b border-t-border bg-purple-500/5">
                <div className="text-xs uppercase tracking-wide text-muted mb-1">
                  {isDebugRow(detail) ? "Message that failed" : "Question"}
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap">{detail.question}</p>
              </div>

              {/* Bot context */}
              {detail.botContext && (
                <div className="px-6 py-4 border-b border-t-border">
                  <div className="text-xs uppercase tracking-wide text-muted mb-1">
                    {isDebugRow(detail) ? "Error detail" : "Bot context"}
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{detail.botContext}</p>
                </div>
              )}

              {/* Source metadata */}
              <div className="px-6 py-4 border-b border-t-border text-sm flex-1">
                <div className="text-xs uppercase tracking-wide text-muted mb-2">Source</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-foreground">
                  <dt className="text-muted">From</dt>
                  <dd className="break-all">{detail.senderEmail}</dd>
                  <dt className="text-muted">Chat space</dt>
                  <dd className="break-all">{detail.spaceId}</dd>
                  {detail.threadId && (
                    <>
                      <dt className="text-muted">Thread</dt>
                      <dd className="break-all">{detail.threadId}</dd>
                    </>
                  )}
                </dl>
              </div>

              {/* Already-reviewed: show note */}
              {detail.status !== "PENDING" && (
                <div className="px-6 py-4 border-b border-t-border bg-surface">
                  <div className="text-xs uppercase tracking-wide text-muted mb-1">
                    {detail.status === "RESOLVED" ? "Resolved" : "Dismissed"} · {fmtDate(detail.resolvedAt)}
                  </div>
                  {detail.resolvedNote && (
                    <p className="text-sm text-foreground whitespace-pre-wrap mt-2">
                      {detail.resolvedNote}
                    </p>
                  )}
                </div>
              )}

              {/* Pending: action panel */}
              {detail.status === "PENDING" && (
                <div className="px-6 py-5 border-t border-t-border bg-surface space-y-4 sticky bottom-0">
                  {actionError && (
                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
                      {actionError}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-muted mb-1">
                      Note <span className="text-muted/70 ml-1">— optional</span>
                    </label>
                    <textarea
                      value={resolvedNote}
                      onChange={(e) => setResolvedNote(e.target.value)}
                      rows={2}
                      placeholder="What you did, or why you're dismissing it"
                      className="w-full px-3 py-2 text-sm rounded bg-surface-2 border border-t-border text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      disabled={actionInFlight}
                      onClick={() => handleAction("DISMISSED")}
                      className="px-4 py-2 text-sm font-medium rounded bg-zinc-500/15 border border-zinc-500/30 text-zinc-300 hover:bg-zinc-500/25 disabled:opacity-50"
                    >
                      {actionInFlight ? "..." : "Dismiss"}
                    </button>
                    <button
                      type="button"
                      disabled={actionInFlight}
                      onClick={() => handleAction("RESOLVED")}
                      className="px-4 py-2 text-sm font-medium rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {actionInFlight ? "..." : "Mark Resolved"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
