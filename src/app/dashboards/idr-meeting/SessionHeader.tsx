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
        addToast({ type: "success", title: "Meeting ended" });
        onSessionEnded();
      }
    },
    onError: () => {
      addToast({ type: "error", title: "Failed to update meeting status" });
    },
  });

  const items = session?.items ?? [];
  const regionCounts = new Map<string, number>();
  for (const item of items) {
    regionCounts.set(item.region, (regionCounts.get(item.region) ?? 0) + 1);
  }

  const isActive = session && session.status !== "COMPLETED";
  const syncedCount = items.filter((i) => i.hubspotSyncStatus === "SYNCED").length;
  const unsyncedCount = items.length - syncedCount;

  return (
    <>
      {/* ── Mode banner ── */}
      {isPreview ? (
        <div className="rounded-xl border-2 border-dashed border-blue-500/40 bg-blue-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-blue-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                Prep Mode
              </span>
              <span className="text-sm font-medium text-foreground">
                {previewCount} projects ready for review
              </span>
            </div>
            <span className="text-xs text-muted">
              Fill in planning fields now — everything carries over when you start a meeting.
            </span>

            <div className="ml-auto flex items-center gap-2">
              {/* Past meetings dropdown */}
              <select
                className="rounded-lg border border-t-border bg-surface-2 px-2 py-1 text-xs text-muted"
                value=""
                onChange={(e) => {
                  if (e.target.value) onSelectSession(e.target.value);
                }}
              >
                <option value="">Past meetings...</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.date).toLocaleDateString()} ({s._count.items})
                    {s.status === "COMPLETED" ? " \u2713" : ""}
                  </option>
                ))}
              </select>

              <button
                className="rounded-lg bg-surface-2 border border-t-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface transition-colors"
                onClick={onOpenAddDialog}
              >
                + Add Project
              </button>

              <button
                className="rounded-lg bg-orange-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
                onClick={onNewSession}
                disabled={creating}
              >
                {creating ? "Starting..." : "Start Meeting"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className={`rounded-xl border-2 px-4 py-3 ${
          session?.status === "COMPLETED"
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-orange-500/40 bg-orange-500/5"
        }`}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white ${
                session?.status === "COMPLETED" ? "bg-emerald-500" : "bg-orange-500"
              }`}>
                {session?.status === "COMPLETED" ? "Completed" : "Live Meeting"}
              </span>
              <span className="text-sm font-medium text-foreground">
                {session ? new Date(session.date).toLocaleDateString() : ""} — {items.length} projects
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-muted">
              {[...regionCounts.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([region, count]) => (
                  <span key={region}>{count} {region}</span>
                ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {/* Back to prep */}
              <button
                className="rounded-lg border border-t-border bg-surface-2 px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                onClick={onViewPreview}
              >
                &#8592; Prep Mode
              </button>

              {/* Add Project — during meeting */}
              {isActive && (
                <button
                  className="rounded-lg bg-surface-2 border border-t-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface transition-colors"
                  onClick={onOpenAddDialog}
                >
                  + Add Project
                </button>
              )}

              {/* End Meeting */}
              {isActive && (
                <>
                  {!showEndConfirm ? (
                    <button
                      className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/20 transition-colors"
                      onClick={() => setShowEndConfirm(true)}
                    >
                      End Meeting
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {unsyncedCount > 0 && (
                        <span className="text-[10px] text-orange-500">
                          {unsyncedCount} unsynced
                        </span>
                      )}
                      <button
                        className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                        onClick={() => {
                          updateStatus.mutate("COMPLETED");
                          setShowEndConfirm(false);
                        }}
                        disabled={updateStatus.isPending}
                      >
                        Confirm End
                      </button>
                      <button
                        className="text-xs text-muted hover:text-foreground"
                        onClick={() => setShowEndConfirm(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
