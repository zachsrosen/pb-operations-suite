"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";
import type { IdrSession } from "./IdrMeetingClient";

interface SessionListItem {
  id: string;
  date: string;
  status: "DRAFT" | "ACTIVE" | "COMPLETED";
  createdBy: string;
  _count: { items: number };
}

interface Props {
  session: IdrSession | null;
  sessions: SessionListItem[];
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onOpenAddDialog: () => void;
  onViewPreview: () => void;
  creating: boolean;
  isPreview: boolean;
  previewCount: number;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-500 text-white",
  ACTIVE: "bg-orange-500 text-white",
  COMPLETED: "bg-emerald-500 text-white",
};

const STATUS_NEXT: Record<string, string> = {
  DRAFT: "ACTIVE",
  ACTIVE: "COMPLETED",
};

export function SessionHeader({
  session,
  sessions,
  onSelectSession,
  onNewSession,
  onOpenAddDialog,
  onViewPreview,
  creating,
  isPreview,
  previewCount,
}: Props) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const advanceStatus = useMutation({
    mutationFn: async () => {
      if (!session) return;
      const next = STATUS_NEXT[session.status];
      if (!next) return;
      const res = await fetch(`/api/idr-meeting/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      if (session) {
        queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.session(session.id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.sessions() });
      }
    },
    onError: () => {
      addToast({ type: "error", title: "Failed to advance session status" });
    },
  });

  // Compute stats from items
  const items = session?.items ?? [];
  const regionCounts = new Map<string, number>();
  for (const item of items) {
    regionCounts.set(item.region, (regionCounts.get(item.region) ?? 0) + 1);
  }
  const statsLine = [
    `${items.length} project${items.length !== 1 ? "s" : ""}`,
    ...[...regionCounts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([region, count]) => `${count} ${region}`),
  ].join(" \u00B7 ");

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-t-border bg-surface px-4 py-3">
      {/* Session selector / preview toggle */}
      <select
        className="rounded-lg border border-t-border bg-surface-2 px-3 py-1.5 text-sm text-foreground"
        value={isPreview ? "__preview__" : (session?.id ?? "")}
        onChange={(e) => {
          if (e.target.value === "__preview__") {
            onViewPreview();
          } else {
            onSelectSession(e.target.value);
          }
        }}
      >
        <option value="__preview__">
          Live Preview ({previewCount} projects)
        </option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {new Date(s.date).toLocaleDateString()} ({s._count.items} projects)
          </option>
        ))}
      </select>

      {/* Stats */}
      {isPreview ? (
        <span className="text-sm text-muted">
          Live from HubSpot — start a session to edit
        </span>
      ) : (
        <span className="text-sm text-muted">{statsLine}</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Preview badge */}
        {isPreview && (
          <span className="rounded-full bg-blue-500 px-3 py-0.5 text-xs font-semibold text-white">
            PREVIEW
          </span>
        )}

        {/* Status badge (clickable to advance) */}
        {session && !isPreview && (
          <button
            className={`rounded-full px-3 py-0.5 text-xs font-semibold ${STATUS_COLORS[session.status] ?? "bg-zinc-500 text-white"}`}
            onClick={() => advanceStatus.mutate()}
            disabled={!STATUS_NEXT[session.status] || advanceStatus.isPending}
            title={
              STATUS_NEXT[session.status]
                ? `Click to advance to ${STATUS_NEXT[session.status]}`
                : "Session completed"
            }
          >
            {session.status}
          </button>
        )}

        {/* Add Project */}
        {session && session.status !== "COMPLETED" && !isPreview && (
          <button
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface transition-colors border border-t-border"
            onClick={onOpenAddDialog}
          >
            + Add Project
          </button>
        )}

        {/* Start / New Session */}
        <button
          className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
          onClick={onNewSession}
          disabled={creating}
        >
          {creating ? "Creating..." : isPreview ? "Start Session" : "New Session"}
        </button>
      </div>
    </div>
  );
}
