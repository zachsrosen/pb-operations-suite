"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { DetailSignal, Team } from "@/lib/pi-hub/types";
import type { SharedInboxThreadMessage } from "@/lib/gmail-shared-inbox";
import { signalLabel } from "../signal-ui";

function formatReceived(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/**
 * Inline evidence viewer — fetches the thread through the same endpoint (and
 * React Query key) the Correspondence panel uses, so opening it here warms the
 * cache there and vice versa. Shows only the evidence message when it can be
 * found in the thread; Gmail bundles other projects' chatter into the same
 * thread, so rendering everything would bury the sentence that flagged.
 */
function EvidenceMessage({
  team,
  threadId,
  inbox,
  messageId,
}: {
  team: Team;
  threadId: string;
  inbox: string;
  messageId: string;
}) {
  const query = useQuery<{ messages: SharedInboxThreadMessage[] }>({
    queryKey: queryKeys.piHub.thread(team, threadId),
    queryFn: async () => {
      const r = await fetch(
        `/api/pi-hub/thread/${encodeURIComponent(threadId)}?team=${team}&inbox=${encodeURIComponent(inbox)}`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (query.isPending) {
    return <div className="text-muted mt-2 text-xs">Loading email…</div>;
  }
  const messages = query.data?.messages ?? [];
  if (query.isError || messages.length === 0) {
    return (
      <div className="text-muted mt-2 text-xs">
        Couldn&apos;t load this email — see the Correspondence section below.
      </div>
    );
  }
  const shown = messages.filter((m) => m.id === messageId);
  const list = shown.length > 0 ? shown : messages;

  return (
    <div className="border-t-border mt-2 space-y-3 border-t pt-2">
      {list.map((m) => (
        <div key={m.id} className="text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{m.from ?? "—"}</span>
            <span className="text-muted shrink-0">{formatReceived(m.date)}</span>
          </div>
          {m.to && <div className="text-muted">to {m.to}</div>}
          <pre className="text-foreground/90 mt-1.5 max-h-72 overflow-y-auto font-sans whitespace-pre-wrap break-words">
            {m.bodyText || "(no readable body)"}
          </pre>
        </div>
      ))}
    </div>
  );
}

/**
 * Approval-signal callout at the top of the project detail. Suggestion-only
 * by decision (Zach 2026-07-20): shows the evidence and proposed status but
 * offers NO status write — the human uses the normal StatusDropdown, and the
 * server auto-resolves the signal when the deal leaves its waiting statuses.
 * Dismiss strikes the evidence messageId (3rd distinct dismissal mutes).
 */
export function SignalPanel({
  team,
  dealId,
  signal,
}: {
  team: Team;
  dealId: string;
  signal: DetailSignal;
}) {
  const queryClient = useQueryClient();
  const [showEmail, setShowEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { evidence } = signal;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: queryKeys.piHub.queue(team) });
    queryClient.invalidateQueries({
      queryKey: queryKeys.piHub.project(team, dealId),
    });
  }

  const dismissMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/pi-hub/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team,
          dealId,
          signalType: signal.signalType,
          action: "dismiss",
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Failed to dismiss");
      return data;
    },
    onSuccess: invalidate,
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to dismiss");
    },
  });

  const busy = dismissMutation.isPending;

  return (
    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          {signalLabel(signal.signalType)}
        </span>
        <span className="text-muted text-xs">
          Suggested status: {signal.proposedStatusLabel || signal.proposedStatus}
          {signal.confidence === "medium" ? " · AI-classified" : ""}
        </span>
      </div>

      <blockquote className="mt-3 border-l-2 border-emerald-500 pl-3 text-sm italic">
        &ldquo;{evidence.quote || evidence.subject || "(no quote captured)"}&rdquo;
      </blockquote>
      <div className="text-muted mt-1.5 text-xs">
        Received {formatReceived(evidence.receivedAt)} in{" "}
        <span className="font-medium">{evidence.mailbox || "shared inbox"}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {evidence.threadId && evidence.mailbox && (
          <button
            type="button"
            onClick={() => setShowEmail((v) => !v)}
            aria-expanded={showEmail}
            className="bg-surface-2 text-foreground hover:bg-surface-elevated rounded-md px-3 py-1 text-xs font-medium transition-colors"
          >
            {showEmail ? "Hide email" : "View email"}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setError(null);
            dismissMutation.mutate();
          }}
          disabled={busy}
          className="text-muted hover:text-foreground rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60"
        >
          {dismissMutation.isPending ? "Dismissing…" : "Dismiss"}
        </button>
      </div>

      {error && (
        <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>
      )}

      {showEmail && (
        <EvidenceMessage
          team={team}
          threadId={evidence.threadId}
          inbox={evidence.mailbox}
          messageId={evidence.messageId}
        />
      )}

    </div>
  );
}
