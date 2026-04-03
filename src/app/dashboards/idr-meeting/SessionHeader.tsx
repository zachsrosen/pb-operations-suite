"use client";

import { useState } from "react";
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
  onSessionEnded: () => void;
  creating: boolean;
  isPreview: boolean;
  previewCount: number;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-500 text-white",
  ACTIVE: "bg-orange-500 text-white",
  COMPLETED: "bg-emerald-500 text-white",
};

export function SessionHeader({
  session,
  sessions,
  onSelectSession,
  onNewSession,
  onOpenAddDialog,
  onViewPreview,
  onSessionEnded,
  creating,
  isPreview,
  previewCount,
}: Props) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const updateStatus = useMutation({
    mutationFn: async (newStatus: string) => {
      if (!session) return;
      const res = await fetch(`/api/idr-meeting/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: (_, newStatus) => {
      if (session) {
        queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.session(session.id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.sessions() });
      }
      if (newStatus === "COMPLETED") {
        addToast({ type: "success", title: "Session ended" });
        onSessionEnded();
      }
    },
    onError: () => {
      addToast({ type: "error", title: "Failed to update session status" });
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

  const isActive = session && session.status !== "COMPLETED";
  const syncedCount = items.filter((i) => i.hubspotSyncStatus === "SYNCED").length;
  const unsyncedCount = items.length - syncedCount;

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
            {s.status === "COMPLETED" ? " \u2713" : ""}
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

        {/* Status badge */}
        {session && !isPreview && (
          <span
            className={`rounded-full px-3 py-0.5 text-xs font-semibold ${STATUS_COLORS[session.status] ?? "bg-zinc-500 text-white"}`}
          >
            {session.status}
          </span>
        )}

        {/* Add Project — only in active sessions */}
        {isActive && !isPreview && (
          <button
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface transition-colors border border-t-border"
            onClick={onOpenAddDialog}
          >
            + Add Project
          </button>
        )}

        {/* End Session — active sessions only */}
        {isActive && !isPreview && (
          <>
            {!showEndConfirm ? (
              <button
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-500 hover:bg-red-500/20 transition-colors"
                onClick={() => setShowEndConfirm(true)}
              >
                End Session
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                {unsyncedCount > 0 && (
                  <span className="text-[10px] text-orange-500">
                    {unsyncedCount} unsynced
                  </span>
                )}
                <button
                  className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                  onClick={() => {
                    updateStatus.mutate("COMPLETED");
                    setShowEndConfirm(false);
                  }}
                  disabled={updateStatus.isPending}
                >
                  {updateStatus.isPending ? "Ending..." : "Confirm End"}
                </button>
                <button
                  className="rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                  onClick={() => setShowEndConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}

        {/* Start Session — from preview */}
        {isPreview && (
          <button
            className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
            onClick={onNewSession}
            disabled={creating}
          >
            {creating ? "Creating..." : "Start Session"}
          </button>
        )}
      </div>
    </div>
  );
}
